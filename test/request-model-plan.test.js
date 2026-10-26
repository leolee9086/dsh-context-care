import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionCache } from '../lib/session-cache.js'
import { createRequestPlanCache } from '../lib/request-plan-cache.js'
import { modelRequestBlocks, projectRequestMessage } from '../src/request-blocks.js'
import { requestImpact } from '../src/request-impact.js'
import { planRequestV2 } from '../src/request-plan.js'
import { createTemplates } from '../src/templates.js'
import { normalizeRuleV2, detectRulesV2 } from '@leolee9086/dsh-rule-engine'

test('explicit model anchors keep first-match placement and unavailable anchors skip dependent actions', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache, projectRequestMessage); t.after(() => analysis.close())
  const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'MATCH' }] }, { role: 'user', content: [{ type: 'text', text: 'END' }] }] }
  const blocks = modelRequestBlocks('s', request, 'anchors', { byId: new Map() }, 'turn', analysis.modelProjection)
  const anchor = blocks[1].id
  const rule = normalizeRuleV2({ schemaVersion: 2, sourceId: 'test', id: 'anchor', revision: 1, title: 'Anchor', on: ['request.assemble'],
    select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '^MATCH$' },
    actions: [{ id: 'inject', kind: 'inject', stage: 'request.assemble', enabledDefault: true, template: 'PIN',
      target: { view: 'model', role: 'user', anchor, position: 'before' } },
    { id: 'dependent', kind: 'notify', stage: 'request.assemble', enabledDefault: true, template: 'NOTICE', dependsOn: ['inject'] }] })
  const events = detectRulesV2({ rules: [rule], blocks, stage: 'request.assemble' })
  const input = { request, blocks, rules: [rule], events, templates: createTemplates(), snapshot: {}, decision: () => ({ enabled: true }) }
  for (const scoped of [undefined, analysis]) {
    const placed = planRequestV2({ ...input, analysis: scoped })
    assert.deepEqual(placed.request.messages.map(message => message.content[0].text), ['MATCH', 'PIN', 'END'])
    // Duplicate-id precedence is covered by the index test. Here use a real
    // synthetic-position anchor so patch merging is not the behavior under test.
    const first = { ...blocks[1], id: 'synthetic-anchor', messageIndex: -1 }
    const unavailable = { ...rule, actions: rule.actions.map(action => action.id === 'inject'
      ? { ...action, target: { ...action.target, anchor: first.id } } : action) }
    const skipped = planRequestV2({ ...input, rules: [unavailable], blocks: [first, ...blocks], analysis: scoped })
    assert.equal(skipped.request, request)
    assert.deepEqual(skipped.records.map(record => record.reason), ['injection-anchor-unavailable', 'dependency-not-planned'])
    const missing = planRequestV2({ ...input, blocks: blocks.slice(0, 1), analysis: scoped })
    assert.equal(missing.request, request); assert.equal(missing.records[0].reason, 'injection-anchor-unavailable')
  }
  assert.equal(request.messages.length, 2)
})

test('cached tool arguments invalidate only their message and paired filtering preserves old cuts', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache, projectRequestMessage); t.after(() => analysis.close())
  const request = { messages: [
    { role: 'assistant', content: [{ type: 'tool-call', id: 'one', name: 'inspect', arguments: '{"nested":{"x":1}}' }] },
    { role: 'tool', toolCallId: 'one', content: [{ type: 'text', text: 'RESULT' }] },
    { role: 'user', content: [{ type: 'text', text: 'KEEP' }] },
  ] }, shared = { byId: new Map() }
  const blocks = modelRequestBlocks('s', request, 'one', shared, 'turn', analysis.modelProjection)
  const rule = normalizeRuleV2({ schemaVersion: 2, sourceId: 'test', id: 'args', revision: 1, title: 'Arguments', on: ['request.assemble'],
    select: { view: 'model', roles: ['assistant'], blockTypes: ['tool-call'] }, match: { kind: 'always' },
    actions: [{ id: 'args', kind: 'replace', stage: 'request.assemble', enabledDefault: true, patch: { kind: 'tool-arguments', path: '/nested/x', value: 2 } }] })
  const events = detectRulesV2({ rules: [rule], blocks, stage: 'request.assemble' })
  const planned = planRequestV2({ request, blocks, rules: [rule], events, templates: createTemplates(), snapshot: {}, decision: () => ({ enabled: true }), analysis })
  const next = modelRequestBlocks('s', planned.request, 'two', shared, 'turn', analysis.modelProjection)
  assert.deepEqual(next[0].arguments, { nested: { x: 2 } }); assert.deepEqual(blocks[0].arguments, { nested: { x: 1 } })
  assert.equal(next[1].raw, blocks[1].raw); assert.equal(next[3].raw, blocks[3].raw)
  assert.equal(cache.report().find(row => row.name === 'request-model-projection')?.work, 4)
  const filter = normalizeRuleV2({ schemaVersion: 2, sourceId: 'test', id: 'filter', revision: 1, title: 'Filter', on: ['request.assemble'],
    select: { view: 'model', roles: ['tool'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'RESULT' },
    actions: [{ id: 'filter', kind: 'filter', stage: 'request.assemble', enabledDefault: true }] })
  const filtered = planRequestV2({ request: planned.request, blocks: next, rules: [filter],
    events: detectRulesV2({ rules: [filter], blocks: next, stage: 'request.assemble' }), templates: createTemplates(), snapshot: {}, decision: () => ({ enabled: true }), analysis })
  assert.equal(filtered.request.messages.length, 1)
  const remaining = modelRequestBlocks('s', filtered.request, 'three', shared, 'turn', analysis.modelProjection)
  assert.equal(remaining[0].raw, blocks[3].raw); assert.equal(remaining[0].messageIndex, 0)
  assert.equal(cache.report().find(row => row.name === 'request-model-projection')?.work, 4)
  filtered.request.messages[0].content[0].text = 'INDEPENDENT'
  assert.equal(request.messages[2].content[0].text, 'KEEP'); assert.equal(planned.request.messages[2].content[0].text, 'KEEP')
})

test('cache-budget replanning does not reproject unchanged messages or leak mutated request bodies', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache, projectRequestMessage); t.after(() => analysis.close())
  const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'START' }] }] }
  const blocks = modelRequestBlocks('s', request, 'one', { byId: new Map() }, 'turn', analysis.modelProjection)
  const rule = normalizeRuleV2({ schemaVersion: 2, sourceId: 'test', id: 'budget', revision: 1, title: 'Budget', on: ['request.assemble'],
    select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'always' },
    actions: [{ id: 'inject', kind: 'inject', stage: 'request.assemble', enabledDefault: true, template: 'NEW',
      target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } }] })
  const events = detectRulesV2({ rules: [rule], blocks, stage: 'request.assemble' })
  const result = planRequestV2({ request, blocks, rules: [rule], events, templates: createTemplates(), snapshot: {},
    decision: () => ({ enabled: true }), analysis, maxCacheChangedBytes: 0 })
  assert.equal(result.request, request); assert.ok(result.records.some(row => row.reason === 'request-cache-change-budget-exceeded'))
  assert.equal(cache.report().find(row => row.name === 'request-plan-actions')?.work, 1, 'budget replanning shares only the immutable action structure')
  assert.equal(cache.report().find(row => row.name === 'request-plan-pairs')?.work, 3, 'one baseline and one final two-message candidate are indexed, not every retry')
  assert.equal(cache.report().find(row => row.name === 'request-model-projection')?.work, 1)
})

test('real request replacement invalidates only its message and keeps patched results writable', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache, projectRequestMessage); t.after(() => analysis.close())
  const request = { system: 'SYSTEM', messages: Array.from({ length: 1000 }, (_, index) => ({ role: 'user',
    content: [{ type: 'text', text: `BODY ${index} ` + 'x'.repeat(2048) }] })) }
  const shared = { byId: new Map() }, blocks = modelRequestBlocks('s', request, 'one', shared, 'turn', analysis.modelProjection)
  const rule = normalizeRuleV2({ schemaVersion: 2, sourceId: 'test', id: 'patch', revision: 1, title: 'Patch', on: ['request.assemble'],
    select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '^BODY 99 ' },
    actions: [{ id: 'replace', kind: 'replace', stage: 'request.assemble', enabledDefault: true, template: 'EDITED ' }] })
  const events = detectRulesV2({ rules: [rule], blocks, stage: 'request.assemble' })
  const planned = planRequestV2({ request, blocks, rules: [rule], events, templates: createTemplates(), snapshot: {}, decision: () => ({ enabled: true }), analysis })
  const next = modelRequestBlocks('s', planned.request, 'two', shared, 'turn', analysis.modelProjection)
  assert.match(next[100].text, /^EDITED /); assert.notEqual(next[100].raw, blocks[100].raw)
  assert.equal(next[101].raw, blocks[101].raw)
  assert.equal(cache.report().find(row => row.name === 'request-model-projection')?.work, 1002)
  planned.request.messages[99].content[0].text = 'Writable patched result'
  planned.request.messages[100].content[0].text = 'Writable unchanged result'
  assert.match(request.messages[99].content[0].text, /^BODY 99 /)
  assert.match(request.messages[100].content[0].text, /^BODY 100 /)
  assert.match(next[100].text, /^EDITED /)
  analysis.close(); assert.ok(!cache.report().some(row => row.name.startsWith('request-model-') || row.name.startsWith('request-plan-')))
})
