import test from 'node:test'
import assert from 'node:assert/strict'
import { ReminderRule, ReminderScope, Source } from '../src/reminder-runtime/schema.js'

const baseRule = {
  format: 'reminder/v4', id: 'scoped', on: 'tool.succeeded', text: '提醒',
  when: { tool: 'example' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
}

test('rule and source schemas preserve normalized recipient scopes', () => {
  const rule = ReminderRule.parse({ ...baseRule, scope: { sessionIds: ['s1', 's1'], agentPresets: ['p1'] } })
  assert.deepEqual(rule.scope, { sessionIds: ['s1'], agentPresets: ['p1'] })

  const source = Source.parse({ sourceId: 'source', plugin: 'plugin', sessionId: 'legacy',
    scope: { agentPresets: ['p1', 'p1'] }, revision: 1, rules: [baseRule] })
  assert.equal(source.sessionId, 'legacy')
  assert.deepEqual(source.scope, { agentPresets: ['p1'] })
})

test('tool failure rules require an exact error code', () => {
  const failure = ReminderRule.parse({ ...baseRule, on: 'tool.failed', when: { tool: 'example', error: { code: 'TOOL_TIMEOUT' } } })
  assert.equal(failure.when.error.code, 'TOOL_TIMEOUT')
  assert.throws(() => ReminderRule.parse({ ...baseRule, when: { tool: 'example', error: { code: 'TOOL_TIMEOUT' } } }), /cannot declare/)
  assert.throws(() => ReminderRule.parse({ ...baseRule, on: 'tool.failed' }), /requires/)
})

test('the single public format rejects unknown top-level fields', () => {
  for (const declaration of [baseRule,
    { ...baseRule, on: 'request.before', when: {} },
    { ...baseRule, on: 'assistant.output', when: { blockTypes: ['text'], pattern: { kind: 'literal', text: 'marker' } } },
    { ...baseRule, on: 'tool.before-execute', when: { tool: 'example' }, effect: { kind: 'deny-tool', deliver: { model: { once: 'surface' } } } },
  ]) {
    assert.ok(ReminderRule.safeParse(declaration).success)
    assert.equal(ReminderRule.safeParse({ ...declaration, typo: true }).success, false)
  }
  // An old format number is no longer a public format at all.
  assert.equal(ReminderRule.safeParse({ ...baseRule, format: 'reminder/v3' }).success, false)
})

test('scope schema rejects empty dimensions and unknown fields', () => {
  assert.throws(() => ReminderScope.parse({ sessionIds: [] }), /Too small/)
  assert.throws(() => ReminderScope.parse({ other: ['value'] }), /Unrecognized key/)
  assert.throws(() => ReminderRule.parse({ ...baseRule, scope: { agentPresets: [] } }), /Too small/)
})
