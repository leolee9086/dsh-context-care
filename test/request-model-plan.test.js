import { createRequestPlanCache, requestImpact, createTemplates, normalizeRuleV2, detectRulesV2, applyBlockPatchesV2 } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionCache } from '../lib/session-cache.js'

import { modelRequestBlocks, projectRequestMessage } from '../src/request-blocks.js'

import { planRequestV2 } from '../src/request-plan.js'

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

test('multiple argument edits preserve full snapshots, binding baseline, conflicts and dependent skips', () => {
  const request = { messages: [{ role: 'assistant', content: [{ type: 'tool-call', id: 'one', name: 'inspect', arguments: '{"nested":{"x":1,"y":2},"list":[1,2],"a/b":3}' }] },
    { role: 'tool', toolCallId: 'one', content: [{ type: 'text', text: 'RESULT' }] }] }
  const before = structuredClone(request), blocks = modelRequestBlocks('args', request, 'one', { byId: new Map() }, 'turn')
  const edit = (id, path, value, dependsOn = []) => ({ id, kind: 'replace', stage: 'request.assemble', enabledDefault: true, patch: { kind: 'tool-arguments', path, value }, dependsOn })
  const rule = normalizeRuleV2({ schemaVersion: 2, sourceId: 'test', id: 'args-many', revision: 1, title: 'Arguments', on: ['request.assemble'],
    select: { view: 'model', roles: ['assistant'], blockTypes: ['tool-call'] }, match: { kind: 'always' }, actions: [
      edit('first', '/nested/x', 9), edit('bound', '/nested/y', { bind: 'tool.arguments.nested.x' }),
      edit('overlap', '/nested', {}), { id: 'child', kind: 'notify', stage: 'request.assemble', enabledDefault: true, template: 'NO', dependsOn: ['overlap'] },
      edit('list', '/list/0', 7), edit('escaped', '/a~1b', 4), edit('again', '/list/0', 99),
    ] })
  const events = detectRulesV2({ rules: [rule], blocks, stage: 'request.assemble' })
  const input = { request, blocks, rules: [rule], events, templates: createTemplates(), snapshot: {}, decision: () => ({ enabled: true }) }
  const planned = planRequestV2(input), records = planned.records
  assert.deepEqual(records.map(row => row.status), ['planned', 'planned', 'skipped', 'skipped', 'planned', 'planned', 'skipped'])
  assert.equal(records[2].reason, 'overlapping-argument-patch'); assert.equal(records[3].reason, 'dependency-not-planned')
  assert.equal(records[0].before, request.messages[0].content[0].arguments)
  assert.equal(records[1].before, records[0].after); assert.equal(records[4].before, records[1].after); assert.equal(records[5].before, records[4].after)
  assert.deepEqual(JSON.parse(planned.request.messages[0].content[0].arguments), { nested: { x: 9, y: 1 }, list: [7, 2], 'a/b': 4 })
  assert.equal(planned.scheduled.length, 0); assert.deepEqual(request, before)
  const missingBinding = { ...rule, actions: [edit('bad', '/__proto__/x', { bind: 'tool.arguments.missing' })] }
  assert.throws(() => planRequestV2({ ...input, rules: [missingBinding] }), /missing binding/)
  assert.throws(() => planRequestV2({ ...input, rules: [{ ...rule, actions: [edit('bad', '/__proto__/x', 1)] }] }), /unsafe-path/)
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

test('request text batches match original patch decisions and final text without replaying old blocks', () => {
  const request = { system: 'SYSTEM🙂', messages: Array.from({ length: 20 }, (_, index) => ({ role: 'user', content: [{ type: 'text', text: `0123456789🙂ABCDE:${index}` }] })) }
  const original = structuredClone(request), blocks = modelRequestBlocks('batch', request, 'one', { byId: new Map() }, 'turn')
  const actions = [{ id: 'z-first', kind: 'replace', stage: 'request.assemble', dependsOn: [], template: 'ONE' },
    { id: 'a-second', kind: 'replace', stage: 'request.assemble', dependsOn: ['z-first'], template: 'TWO🙂' },
    { id: 'z-third', kind: 'replace', stage: 'request.assemble', dependsOn: ['a-second'], template: 'THREE' },
    { id: 'notice', kind: 'notify', stage: 'request.assemble', dependsOn: ['z-third'], template: 'NOTICE' }]
  const rules = [{ sourceId: 's', id: 'r', priority: 3, actions }]
  const events = blocks.filter(block => block.messageIndex >= 0).flatMap((block, index) => [
    { sourceId: 's', ruleId: 'r', ruleRevision: 1, occurrenceId: `e:${index}`, stage: 'request.assemble', blockId: block.id, block, ranges: [[0, 3], [8, 8]], captures: [] },
    { sourceId: 's', ruleId: 'r', ruleRevision: 1, occurrenceId: `f:${index}`, stage: 'request.assemble', blockId: block.id, block, ranges: [[4, 5]], captures: [] }])
  const committed = [], statuses = [], scheduled = []
  for (const event of events) {
    const outcomes = new Map()
    for (const action of actions) {
      if (action.dependsOn.some(id => outcomes.get(id) === false)) { statuses.push('skipped'); outcomes.set(action.id, false); continue }
      if (action.kind === 'replace') {
        const candidates = event.ranges.map(range => ({ blockId: event.blockId, actionId: `${event.occurrenceId}:${action.id}`, priority: 3, range, text: action.template }))
        if (!applyBlockPatchesV2(blocks, [...committed, ...candidates]).results.some(row => row.actionId === candidates[0].actionId && row.status === 'planned')) { statuses.push('skipped'); outcomes.set(action.id, false); continue }
        committed.push(...candidates)
      } else scheduled.push(event.occurrenceId)
      statuses.push('planned'); outcomes.set(action.id, true)
    }
  }
  const expected = applyBlockPatchesV2(blocks, committed)
  let rawReads = 0
  for (const block of blocks) { const raw = block.raw; Object.defineProperty(block, 'raw', { get() { rawReads++; return raw }, enumerable: true }) }
  const result = planRequestV2({ request, blocks, rules, events, templates: { render: value => value }, snapshot: {}, decision: () => ({ enabled: true }) })
  assert.deepEqual(result.records.slice(0, statuses.length).map(row => row.status), statuses)
  assert.deepEqual(result.records.slice(statuses.length), expected.results)
  assert.deepEqual(result.request.messages.map(message => message.content[0].text), expected.blocks.slice(1).map(block => block.text))
  assert.deepEqual(result.scheduled.map(row => row.event.occurrenceId), scheduled)
  assert.equal(result.request.system, request.system); assert.deepEqual(request, original)
  assert.ok(rawReads < events.length * actions.length * 4, `request planning reads ${rawReads} raw bodies, not every body per candidate`)
})

test('request injection merge retains system and message order, identities, filtering and byte budget', () => {
  const request = { system: 'BASE', messages: [{ id: 'one', role: 'user', content: [{ type: 'text', text: 'ONE' }] },
    { id: 'two', role: 'user', content: [{ type: 'text', text: 'TWO' }] }] }
  const original = structuredClone(request), blocks = modelRequestBlocks('inject', request, 'one', { byId: new Map() }, 'turn')
  const targets = [{ role: 'system', anchor: 'start' }, { role: 'system', anchor: 'end' }, { role: 'user', anchor: 'start' },
    { role: 'user', anchor: 'end' }, { role: 'assistant', anchor: 'depth', depth: 1 }, { role: 'user', anchor: blocks[2].id, position: 'before' }]
  const actions = targets.map((target, index) => ({ id: `a:${index}`, kind: 'inject', stage: 'request.assemble', dependsOn: [], template: `INJECT_${index}`, target: { view: 'model', ...target } }))
  actions.push({ id: 'filter', kind: 'filter', stage: 'request.assemble', dependsOn: [] })
  const rule = { sourceId: 's', id: 'r', priority: 2, actions }, event = { sourceId: 's', ruleId: 'r', ruleRevision: 1, occurrenceId: 'e', stage: 'request.assemble', blockId: blocks[1].id, block: blocks[1], ranges: [], captures: [] }
  const input = { request, blocks, rules: [rule], events: [event], templates: { render: value => value }, snapshot: {}, decision: () => ({ enabled: true }) }
  const result = planRequestV2(input)
  assert.equal(result.request.system, 'INJECT_0\nBASE\nINJECT_1')
  assert.deepEqual(result.request.messages.map(message => message.content[0].text), ['INJECT_2', 'INJECT_4', 'INJECT_5', 'TWO', 'INJECT_3'])
  for (const message of result.request.messages.filter(message => message.id.startsWith('context-care:'))) {
    assert.match(message.id, /^context-care:[a-f0-9]{64}$/); assert.equal(message.source.kind, 'plugin:dsh-context-care:workbench')
  }
  assert.deepEqual(planRequestV2(input).request, result.request); assert.deepEqual(request, original)
  assert.deepEqual(planRequestV2({ ...input, maxRequestBytes: result.impact.afterBytes }).request, result.request)
  assert.throws(() => planRequestV2({ ...input, maxRequestBytes: result.impact.afterBytes - 1 }), /request-byte-budget-exceeded/)
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
