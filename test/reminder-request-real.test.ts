import type { RuleDeclaration as ReminderRuleInput } from '@leolee9086/dsh-rule-engine'
import { isDefiniteStorageFailure, createBoundedMatcher } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { createReminderRuntime } from './reminder-runtime-fixture.ts'

import { openRealReminderStorage, obstructRecord } from './fixtures/reminder-persistence-real.ts'

test('real request: unrelated scopes do not extend the current presence lookback', async t => {
  const matcher = createBoundedMatcher({ timeoutMs: 2000, maxIdle: 1 }), at = Date.now()
  const runtime = createReminderRuntime({ sessionAuthoritative: true, wallNow: () => at, dispatches: true,
    config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: (input, signal, timing) => matcher.detect(input, signal, timing) })
  t.after(async () => { await runtime.close(); await matcher.close() })
  const rule = eventRule('request.before', { id: 'presence', event: { humanActivity: { withinSeconds: 1 } } }, { template: 'RECENT' })
  runtime.registerSource({ sourceId: 'here', plugin: 'test', revision: 1, rules: [rule] })
  runtime.registerSource({ sourceId: 'elsewhere', plugin: 'test', revision: 1, scope: { sessionIds: ['other'] },
    rules: [{ ...rule, event: { humanActivity: { withinSeconds: 300 } } }] })
  const reads: number[] = []
  const recent = { length: 1000000, at(index: number) {
    reads.push(index)
    if (index < 999999) throw new Error('presence read beyond the applicable one-second window')
    return { type: 'assistant/message', seq: index, time: at - 2000, data: {} }
  } }
  await runtime.prepareRequest({ sessionId: 's', events: recent })
  assert.deepEqual(reads, [999999])
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  const human = { id: 'now', source: { kind: 'user' } }
  await runtime.prepareRequest({ sessionId: 's', events: [{ type: 'agent/inbox/spliced', seq: 0, time: at,
    data: { inserted: [human] } }] })
  assert.equal((await runtime.collect({ sessionId: 's', visible: [] })).length, 1, 'current presence still reaches the real Worker matcher')
})

// This replaces the old Map-backed failed-claim/snooze and failed-reservation
// cases. The native writer, matcher, and rollback all run; only event data is made up.
test('real request: failed claim and snooze cannot suppress delivery; acknowledged rollback permits recollection',
  { timeout: 30000 }, async t => {
    const store = await openRealReminderStorage()
    const matcher = createBoundedMatcher({ timeoutMs: 2000, maxIdle: 1 })
    const at = new Date(2026, 9, 14, 23).getTime()
    const runtime = createReminderRuntime({
      config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000, storageTimeoutMs: 2000 },
      wallNow: () => at,
      save: (id, state) => store.sessions.put(id, state),
      updateClaims: change => store.claims.update('global', change),
      dispatches: true,
      execute: (input, signal, timing) => matcher.detect(input, signal, timing),
    })
    t.after(async () => {
      await runtime.close()
      await matcher.close()
      await store.close()
      await rm(store.root, { recursive: true })
    })
    const rule: ReminderRuleInput = eventRule('request.before', { id: 'night', event: { timeWindow: { start: '23:00', end: '06:00', timeZone: 'local' }, humanActivity: { withinSeconds: 300 } } },
      { template: 'A real request reminder', delivery: { model: { once: 'window' } } })
    runtime.registerSource({ sourceId: 'real-request', plugin: 'test', revision: 1, rules: [rule] })
    const human = { id: 'human', role: 'user', content: [{ type: 'text', text: 'Continue' }], source: { kind: 'user' } }
    await matcher.warmup()
    await runtime.prepareRequest({ sessionId: 's', accepted: [human],
      events: [{ type: 'agent/inbox/spliced', seq: 0, time: at, data: { inserted: [human] } }] })
    assert.equal(runtime.snapshot('s').candidates.length, 1)
    const before = await store.readDisk('s')
    const restore = await obstructRecord(store.recordPath('s'))
    try {
      await assert.rejects(runtime.collect({ sessionId: 's', visible: [] }), isDefiniteStorageFailure)
      await assert.rejects(runtime.snooze({ sessionId: 's' }), isDefiniteStorageFailure)
    } finally { await restore() }
    assert.deepEqual(await store.readDisk('s'), before, 'both real pre-commit failures leave disk unchanged')
    assert.deepEqual(runtime.snapshot('s').windows, before.windows, 'no failed snooze or delivery window may be published')
    assert.equal(runtime.snapshot('s').candidates[0]?.status, 'pending')
    const first = await runtime.collect({ sessionId: 's', visible: [] })
    assert.equal(first.length, 1, 'failed persistence did not suppress the reminder')
    assert.equal((await store.readDisk('s')).candidates[0]?.status, 'reserved')
    await runtime.rollback('s', first)
    assert.equal((await store.readDisk('s')).candidates[0]?.status, 'pending', 'rollback is durable before it returns')
    const again = await runtime.collect({ sessionId: 's', visible: [] })
    assert.equal(again.length, 1, 'an acknowledged rollback permits recollection')
    const final = await store.readDisk('s')
    assert.equal(final.candidates[0]?.messageId, again[0]?.id)
    assert.deepEqual(final.windows, runtime.snapshot('s').windows)
    t.diagnostic(JSON.stringify({ before: before.candidates[0]?.status,
      afterRecovery: final.candidates[0]?.status, windows: final.windows }))
  })
