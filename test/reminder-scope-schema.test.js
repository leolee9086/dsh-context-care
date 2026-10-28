import { EventRule as ReminderRule, Recipient as ReminderScope, EventSource as Source } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

import { eventRule } from './event-rule.js'

const baseRule = eventRule('tool.succeeded', { id: 'scoped', event: { tool: 'example' } }, { template: '提醒' })

test('rule and source schemas preserve normalized recipient scopes', () => {
  const rule = ReminderRule.parse({ ...baseRule, recipient: { sessionIds: ['s1', 's1'], agentPresets: ['p1'] } })
  assert.deepEqual(rule.recipient, { sessionIds: ['s1'], agentPresets: ['p1'] })
  const source = Source.parse({ sourceId: 'source', plugin: 'plugin', sessionId: 'legacy',
    scope: { agentPresets: ['p1', 'p1'] }, revision: 1, rules: [baseRule] })
  assert.equal(source.sessionId, 'legacy')
  assert.deepEqual(source.scope, { agentPresets: ['p1'] })
})

test('tool failure rules require an exact error code', () => {
  const failure = eventRule('tool.failed', { event: { tool: 'example', error: { code: 'TOOL_TIMEOUT' } } })
  assert.equal(ReminderRule.parse(failure).event.error.code, 'TOOL_TIMEOUT')
  // Registration validates phase-specific event facts; parsing owns structure.
  return import('./reminder-runtime-fixture.ts').then(({ createReminderRuntime }) => {
    const runtime = createReminderRuntime()
    try {
      assert.throws(() => runtime.validateRule({ ...baseRule, event: { tool: 'example', error: { code: 'TOOL_TIMEOUT' } } }), /cannot declare/)
      assert.throws(() => runtime.validateRule({ ...failure, event: { tool: 'example' } }), /requires/)
    } finally { return runtime.close() }
  })
})

test('the single public format rejects unknown top-level fields', () => {
  for (const declaration of [baseRule,
    eventRule('request.before', { event: {} }),
    eventRule('assistant.output', { event: { blockTypes: ['text'], pattern: { kind: 'literal', text: 'marker' } } }),
    eventRule('tool.before-execute', { event: { tool: 'example' } }, { deny: { dangerous: true, reason: '示例' } }),
  ]) {
    assert.ok(ReminderRule.safeParse(declaration).success)
    assert.equal(ReminderRule.safeParse({ ...declaration, typo: true }).success, false)
  }
  for (const version of [1, 2, 3, 4]) assert.equal(ReminderRule.safeParse({ ...baseRule, format: `reminder/v${version}` }).success, false)
})

test('scope schema rejects empty dimensions and unknown fields', () => {
  assert.throws(() => ReminderScope.parse({ sessionIds: [] }), /Too small/)
  assert.throws(() => ReminderScope.parse({ other: ['value'] }), /Unrecognized key/)
  assert.throws(() => ReminderRule.parse({ ...baseRule, recipient: { agentPresets: [] } }), /Too small/)
})

test('能真的拦住工具调用的规则必须自带危险标签和拒绝理由', () => {
  const deny = value => eventRule('tool.before-execute', { event: { tool: 'example' } }, { deny: value })
  assert.throws(() => ReminderRule.parse(deny({})), /dangerous/)
  assert.throws(() => ReminderRule.parse(deny({ dangerous: false })), /dangerous/)
  assert.throws(() => ReminderRule.parse(deny({ dangerous: true })), /reason/)
  const parsed = ReminderRule.parse(deny({ dangerous: true, reason: '示例' }))
  assert.equal(parsed.actions[0].kind, 'notify')
  assert.equal(parsed.actions[0].deny.dangerous, true)
})
