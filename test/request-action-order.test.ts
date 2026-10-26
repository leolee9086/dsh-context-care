import test from 'node:test'
import assert from 'node:assert/strict'
import { indexRequestActions, type RequestActionDependency } from '../lib/request-action-order.js'
import { createSessionCache } from '../lib/session-cache.js'
import { createRequestPlanCache } from '../lib/request-plan-cache.js'
import { requestImpact } from '../src/request-impact.js'
import { planRequestV2 } from '../src/request-plan.js'

function legacy<A extends RequestActionDependency>(all: readonly A[], stage: string) {
  const actions = all.filter(action => action.stage === stage), pending = new Set(actions), order: A[] = []
  while (pending.size) {
    const action = [...pending].find(action => action.dependsOn.every(id => !pending.has(actions.find(item => item.id === id)!)))
    if (!action) return { order, cycle: true }
    pending.delete(action); order.push(action)
  }
  return { order, cycle: false }
}

test('action dependency index exactly matches first-ready legacy order including cycles duplicates missing and cross-stage dependencies', () => {
  let seed = 42
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let sample = 0; sample < 300; sample++) {
    const actions: RequestActionDependency[] = Array.from({ length: 1 + next() % 25 }, (_, index) => ({
      id: `action-${next() % 12}`, stage: index % 3 ? 'request.assemble' : 'output.complete',
      dependsOn: Array.from({ length: next() % 4 }, () => `action-${next() % 15}`),
    }))
    if (sample % 4 === 0) actions.push(actions[0])
    const before = actions.slice(), indexed = indexRequestActions(actions)
    for (const stage of ['request.assemble', 'output.complete', 'missing']) {
      const expected = legacy(actions, stage), actual = indexed.get(stage) ?? { order: [], cycle: false }
      assert.equal(actual.cycle, expected.cycle, `cycle ${sample}:${stage}`)
      assert.equal(actual.order.length, expected.order.length)
      actual.order.forEach((action, index) => assert.equal(action, expected.order[index], `identity/order ${sample}:${stage}:${index}`))
    }
    assert.deepEqual(actions, before); assert.equal(Object.isFrozen(actions[0]), false)
  }
  const actions = [
    { id: 'early', stage: 'one', dependsOn: ['parent'] }, { id: 'parent', stage: 'one', dependsOn: [] }, { id: 'later', stage: 'one', dependsOn: [] },
  ]
  assert.deepEqual(indexRequestActions(actions).get('one')?.order.map(action => action.id), ['parent', 'early', 'later'])
})

test('one operation builds immutable action structure once and releases it without retaining evidence outcomes', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache); t.after(() => analysis.close())
  let dependencyReads = 0
  const actions = Array.from({ length: 128 }, (_, index) => ({ id: `action-${index}`, stage: 'request.assemble',
    get dependsOn() { dependencyReads++; return index ? [`action-${index - 1}`] : [] } }))
  const first = analysis.actionIndex(actions)
  assert.equal(first.get('request.assemble')?.order.length, 128); assert.equal(dependencyReads, 128)
  for (let occurrence = 0; occurrence < 500; occurrence++) assert.equal(analysis.actionIndex(actions), first)
  assert.equal(dependencyReads, 128); assert.equal(cache.report().find(row => row.name === 'request-plan-actions')?.work, 128)
  analysis.close(); assert.equal(cache.report().length, 0)
  assert.throws(() => analysis.actionIndex(actions), /cache-closed/)
  const fresh = createRequestPlanCache(requestImpact, cache); t.after(() => fresh.close())
  assert.notEqual(fresh.actionIndex(actions), first); assert.equal(dependencyReads, 256)
})

const action = (id: string, dependsOn: string[] = []) => ({ id, stage: 'request.assemble', dependsOn, kind: 'notify', template: id })
const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'KEEP' }] }] }
const event = (occurrenceId: string) => ({ sourceId: 's', ruleId: 'r', ruleRevision: 1, stage: 'request.assemble', occurrenceId, blockId: 'b',
  ranges: [], captures: [], block: { raw: {}, seq: 0 } })

test('dependency outcomes and decisions remain per evidence and decision/render errors precede the same cycle boundary', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache); t.after(() => analysis.close())
  const actions = [action('child', ['parent']), action('parent'), action('free'), action('other-stage', ['parent'])]
  actions[3].stage = 'output.complete'
  const visited: string[] = []
  const options = { request, blocks: [], rules: [{ sourceId: 's', id: 'r', priority: 0, actions }], events: [event('denied'), event('allowed')],
    snapshot: {}, templates: { render: (value: string) => value }, analysis, decision: (ev: ReturnType<typeof event>, act: ReturnType<typeof action>) => {
      visited.push(`${ev.occurrenceId}:${act.id}`); return { enabled: ev.occurrenceId !== 'denied' || act.id !== 'parent', reason: 'parent-disabled' }
    } }
  const planned = planRequestV2(options)
  assert.deepEqual(visited, ['denied:parent', 'denied:child', 'denied:free', 'allowed:parent', 'allowed:child', 'allowed:free'])
  assert.equal(planned.records.find(row => row.occurrenceId === 'denied' && row.actionId === 'child')?.reason, 'dependency-not-planned')
  assert.deepEqual(planned.applied.map(item => `${item.event.occurrenceId}:${item.action.id}`), ['denied:free', 'allowed:parent', 'allowed:child', 'allowed:free'])
  const cycle = [action('prefix'), action('x', ['y']), action('y', ['x'])]
  const seen: string[] = [], cycleOptions = { ...options, rules: [{ sourceId: 's', id: 'r', priority: 0, actions: cycle }], events: [event('cycle')],
    decision: (_event: unknown, act: ReturnType<typeof action>) => { seen.push(act.id); return { enabled: true } } }
  assert.throws(() => planRequestV2(cycleOptions), /request-plan-dependency-cycle/); assert.deepEqual(seen, ['prefix'])
  assert.throws(() => planRequestV2({ ...cycleOptions, templates: { render: () => { throw new Error('earlier-render-error') } } }), /earlier-render-error/)
  assert.throws(() => planRequestV2({ ...cycleOptions, decision: () => { throw new Error('earlier-decision-error') } }), /earlier-decision-error/)
})

test('failed action structure compilation is not published and explicit retry repairs the same array', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache); t.after(() => analysis.close())
  let broken = true
  const actions = [{ id: 'one', stage: 'request.assemble', get dependsOn(): string[] { if (broken) throw new Error('dependency-read-failed'); return [] } }]
  assert.throws(() => analysis.actionIndex(actions), /dependency-read-failed/)
  assert.equal(cache.report().find(row => row.name === 'request-plan-actions')?.work, 0)
  broken = false; assert.equal(analysis.actionIndex(actions).get('request.assemble')?.order[0], actions[0])
  assert.equal(cache.report().find(row => row.name === 'request-plan-actions')?.work, 1)
})
