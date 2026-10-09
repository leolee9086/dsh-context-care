import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRuleV2, detectRulesV2 } from '@leolee9086/dsh-rule-engine'
import { planRequestV2 } from '../src/request-plan.js'
import { requestImpact } from '../src/request-impact.js'
import { createTemplates } from '../src/templates.js'

const request = { provider: 'test', model: 'test', system: '固定说明', temperature: 0,
  tools: [{ name: 'inspect', description: '检查', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
  messages: [{ id: 'original', role: 'user', content: [{ type: 'text', text: 'START' }] }] }
const blocks = [{ id: 'block', view: 'model', sessionId: 'session', seq: 1, messageIndex: 0, messageId: 'original',
  path: '0', role: 'user', type: 'text', text: 'START', raw: request.messages[0].content[0] }]
const injection = (id, template, extra = {}) => ({ id, kind: 'inject', stage: 'request.assemble', enabledDefault: true, template,
  target: { view: 'model', role: 'user', anchor: 'end', position: 'after' }, ...extra })
const rule = (id, priority, actions) => normalizeRuleV2({ schemaVersion: 2, sourceId: 'producer', id, revision: 1, title: id,
  priority, on: ['request.assemble'], select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'always' }, actions })
const price = message => 4 + message.content.reduce((sum, block) => sum + [...block.text].length, 0)
function plan(rules, options = {}) {
  const events = detectRulesV2({ rules, blocks, stage: 'request.assemble' })
  return planRequestV2({ request, blocks, rules, events, templates: createTemplates(), snapshot: {}, decision: () => ({ enabled: true }), estimateMessage: price, ...options })
}

test('token budget keeps higher priority whole injections and excludes skipped parents and dependent jobs', () => {
  const low = rule('low', 0, [injection('inject', 'LOW'), { id: 'notice', kind: 'notify', stage: 'request.assemble', template: 'NEVER', enabledDefault: true, dependsOn: ['inject'] }])
  const high = rule('high', 10, [injection('inject', 'HIGH')])
  const planned = plan([low, high], { maxInjectedTokens: 8 })
  assert.deepEqual(planned.request.messages.slice(1).map(message => message.content[0].text), ['HIGH'])
  assert.deepEqual(planned.injectionBudget, { kind: 'estimate', tokens: 8, limit: 8 })
  assert.equal(planned.injectedChars, 4)
  assert.deepEqual(planned.applied.map(item => item.event.ruleId), ['high'])
  assert.equal(planned.scheduled.length, 0)
  assert.equal(planned.records.find(record => record.ruleId === 'low' && record.actionId === 'inject').reason, 'injection-token-budget-exceeded')
  assert.equal(planned.records.find(record => record.actionId === 'notice').reason, 'dependency-not-planned')
  assert.equal(request.messages.length, 1)
})

test('character errors stop planning even when token or cache admission would exclude the action', () => {
  const over = rule('over', 0, [injection('inject', '12345', { maxChars: 4 })])
  assert.throws(() => plan([over], { maxInjectedTokens: 0, maxCacheChangedBytes: 0 }), /action-output-budget-exceeded/)
  const combined = [rule('first', 10, [injection('inject', '123')]), rule('second', 0, [injection('inject', '456')])]
  assert.throws(() => plan(combined, { maxInjectedChars: 5 }), /total-injection-budget-exceeded/)
  assert.throws(() => plan(combined, { maxInjectedChars: 5, maxCacheChangedBytes: 0 }), /total-injection-budget-exceeded/)
})

test('missing token measurement reports unknown and refuses bounded injections with visible evidence', () => {
  const rules = [rule('entry', 0, [injection('inject', 'TEXT')])]
  const unknown = plan(rules, { estimateMessage: undefined })
  assert.deepEqual(unknown.injectionBudget, { kind: 'unknown', tokens: null, limit: null })
  const bounded = plan(rules, { estimateMessage: undefined, maxInjectedTokens: 10 })
  assert.equal(bounded.records[0].reason, 'injection-token-estimate-unavailable')
  assert.equal(bounded.applied.length, 0)
  assert.deepEqual(bounded.request, request)
  assert.throws(() => plan(rules, { estimateMessage: () => NaN }), /injection-token-estimate-invalid/)
})

test('complete UTF8 request byte budget includes tools, system and call configuration, with exact boundaries', () => {
  const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8')
  assert.equal(plan([], { maxRequestBytes: bytes }).impact.afterBytes, bytes)
  assert.throws(() => plan([], { maxRequestBytes: bytes - 1 }), /request-byte-budget-exceeded/)
  const toolsChanged = requestImpact(request, { ...request, tools: [] })
  assert.notEqual(toolsChanged.firstChangedByte, null)
  assert.ok(toolsChanged.changedSuffixBytes > 0)
  const routeChanged = requestImpact(request, { ...request, model: 'other' })
  assert.notEqual(routeChanged.firstChangedByte, null)
  assert.equal(routeChanged.providerSerialization, 'unknown')
  assert.equal(routeChanged.cacheHitTokens, null)
})

test('cache estimate excludes lower priority actions and replans dependent jobs without mutating the original', () => {
  const high = rule('high', 10, [injection('inject', 'HIGH')])
  const low = rule('low', 0, [injection('inject', 'LOW'), { id: 'notice', kind: 'notify', stage: 'request.assemble', enabledDefault: true, template: 'NEVER', dependsOn: ['inject'] }])
  const single = plan([high]); const maximum = single.impact.changedSuffixBytes
  const bounded = plan([low, high], { maxCacheChangedBytes: maximum })
  assert.deepEqual(bounded.request, single.request)
  assert.equal(bounded.records.find(record => record.ruleId === 'low' && record.actionId === 'inject').reason, 'request-cache-change-budget-exceeded')
  assert.equal(bounded.scheduled.length, 0)
  assert.deepEqual(plan([high]).request, single.request)
  const none = plan([high], { maxCacheChangedBytes: 0 })
  assert.deepEqual(none.request, request)
  assert.equal(none.impact.changedSuffixBytes, 0)
})

test('missing view anchors skip complete injections and dependents without relocating or hiding character errors', () => {
  for (const target of [{ view: 'model', role: 'user', anchor: 'removed-block', position: 'after' },
    { view: 'model', role: 'user', anchor: 'depth', depth: 2, position: 'after' }]) {
    const anchored = rule('anchored', 0, [injection('inject', 'TEXT', { target }),
      { id: 'notice', kind: 'notify', stage: 'request.assemble', template: 'NEVER', enabledDefault: true, dependsOn: ['inject'] }])
    const planned = plan([anchored])
    assert.deepEqual(planned.request, request)
    assert.equal(planned.applied.length, 0); assert.equal(planned.scheduled.length, 0)
    assert.equal(planned.records[0].reason, target.anchor === 'depth' ? 'injection-depth-anchor-unavailable' : 'injection-anchor-unavailable')
    assert.equal(planned.records[1].reason, 'dependency-not-planned')
    assert.throws(() => plan([rule('over', 0, [injection('inject', 'TOO LONG', { target, maxChars: 1 })])]), /action-output-budget-exceeded/)
  }
})

test('cascade compares the complete final request to its original baseline instead of resetting the cache budget', () => {
  const high = rule('high', 10, [injection('inject', 'HIGH')])
  const previous = plan([high]).request
  const unchanged = plan([], { request: previous, impactBaseline: request })
  assert.deepEqual(unchanged.impact, requestImpact(request, previous))
  assert.throws(() => plan([], { request: previous, impactBaseline: request, maxCacheChangedBytes: 0 }), /request-cache-change-budget-exceeded/)
})
