import { matchesScope, normalizeScope } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

test('an empty scope accepts identities with or without a preset', () => {
  const scope = normalizeScope()
  assert.deepEqual(scope, {})
  assert.equal(matchesScope({ sessionId: 'session-a' }, scope), true)
  assert.equal(matchesScope({ sessionId: 'session-a', agentPreset: 'preset-a' }, scope), true)
})

test('session and preset dimensions each match one of their declared values', () => {
  const scope = normalizeScope({ sessionIds: ['session-a', 'session-b'], agentPresets: ['preset-a', 'preset-b'] })
  assert.equal(matchesScope({ sessionId: 'session-a', agentPreset: 'preset-a' }, scope), true)
  assert.equal(matchesScope({ sessionId: 'session-b', agentPreset: 'preset-b' }, scope), true)
  assert.equal(matchesScope({ sessionId: 'session-c', agentPreset: 'preset-a' }, scope), false)
  assert.equal(matchesScope({ sessionId: 'session-a', agentPreset: 'preset-c' }, scope), false)
})

test('a declared preset dimension requires a matching session preset', () => {
  const scope = normalizeScope({ agentPresets: ['preset-a'] })
  assert.equal(matchesScope({ sessionId: 'session-a' }, scope), false)
  assert.equal(matchesScope({ sessionId: 'session-a', agentPreset: 'preset-b' }, scope), false)
  assert.equal(matchesScope({ sessionId: 'session-a', agentPreset: 'preset-a' }, scope), true)
})

test('normalization removes duplicate values and rejects malformed scopes', () => {
  assert.deepEqual(normalizeScope({ sessionIds: ['session-a', 'session-a'] }), { sessionIds: ['session-a'] })
  assert.throws(() => normalizeScope({ sessionIds: [] }), /non-empty array/)
  assert.throws(() => normalizeScope({ agentPresets: [''] }), /non-empty strings/)
  assert.throws(() => normalizeScope({ other: ['value'] }), /unknown reminder scope field/)
})
