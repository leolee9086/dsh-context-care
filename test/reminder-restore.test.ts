import { restoreDeliveryEntries as restoreReminderEntries, restoreDeliveryState as restoreReminderState, DeliveryState as SessionState } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'

import { createReminderRuntime } from './reminder-runtime-fixture.ts'

import { preV4State } from './fixtures/reminder-upgrade.ts'

for (const format of ['reminder/v1', 'reminder/v2', 'reminder/v3', 'reminder/v4']) {
  test(`upgrade retires ${format} candidates without replaying or erasing receipts`, async t => {
    const input = preV4State(format), original = structuredClone(input)
    const writes = new Map<string, ReturnType<typeof restoreReminderState>['state']>()
    const entries = await restoreReminderEntries([['upgrade-session', input]], (id, state) => { writes.set(id, state) }, 100)
    const state = writes.get('upgrade-session')
    assert.ok(state)
    assert.deepEqual(input, original)
    assert.deepEqual(state.candidates, [])
    assert.deepEqual(state.seen, input.seen)
    assert.deepEqual(state.windows, input.windows)
    assert.deepEqual(state.diagnostics[0], input.diagnostics[0])
    assert.deepEqual(state.diagnostics[1]?.candidates, input.candidates.map(candidate => ({
      id: candidate.id, sourceId: candidate.sourceId, ruleId: candidate.ruleId,
      status: candidate.status, ...(candidate.messageId ? { messageId: candidate.messageId } : {}), format,
    })))
    const runtime = createReminderRuntime({ entries })
    t.after(() => runtime.close())
    assert.deepEqual(await runtime.collect({ sessionId: 'upgrade-session', visible: [] }), [])
    assert.throws(() => runtime.registerSource({ sourceId: 'old', plugin: 'test', revision: 1,
      rules: [input.candidates[0]!.rule] }), /schema|order|unknown field/)
    // Reopening the saved record has no more retirement work or duplicate audit.
    const reopened = await restoreReminderEntries(writes, () => { assert.fail('upgrade wrote twice') }, 200)
    assert.deepEqual(reopened, entries)
  })
}

test('mixed state preserves canonical pending candidates and sticky clocks', () => {
  const old = preV4State()
  const current = SessionState.parse({ seen: [], diagnostics: [], candidates: [{ ...old.candidates[0], id: 'current',
    rule: eventRule('tool.succeeded', { event: { tool: 'probe' } }, { template: 'CURRENT_NOTICE' }) }],
    stickies: [{ key: 'sticky', activationId: 'activation', sourceId: 'source', ruleId: 'notice',
      sessionId: 'upgrade-session', text: 'STICKY', title: 'Sticky', clock: 'human-turn',
      remaining: 2, cooldown: 3, charged: true, lastHumanId: 'human-1' }] })
  const mixed = { ...old, candidates: [...old.candidates, ...current.candidates], stickies: current.stickies }
  const { state } = restoreReminderState(mixed, 100)
  assert.deepEqual(state.candidates, current.candidates)
  assert.deepEqual(state.stickies, current.stickies)
})

test('corrupt canonical records and malformed receipts reject before saving other records', async () => {
  for (const fault of [
    { ...preV4State(), candidates: [{ ...preV4State().candidates[0], rule: { schemaVersion: 2 } }] },
    { ...preV4State(), candidates: [{ id: 'missing-identity' }] },
    null,
  ]) {
    await assert.rejects(restoreReminderEntries([['legacy', preV4State()], ['corrupt-session', fault]],
      () => { assert.fail('validation failure must precede writes') }), /reminder-state-restore-failed: corrupt-session/)
  }
})

test('startup waits for the retirement save and propagates its failure', async () => {
  const failure = new Error('disk-full')
  await assert.rejects(restoreReminderEntries([['upgrade-session', preV4State()]], async () => { throw failure }), error => error === failure)
  let acknowledge: (() => void) | undefined
  const ack = new Promise<void>(resolve => { acknowledge = resolve })
  let entered: (() => void) | undefined
  const saving = new Promise<void>(resolve => { entered = resolve })
  let finished = false
  const restoring = restoreReminderEntries([['upgrade-session', preV4State()]], () => { entered!(); return ack })
    .then(value => { finished = true; return value })
  await saving
  assert.equal(finished, false)
  acknowledge!()
  assert.equal((await restoring)[0]?.[1].candidates.length, 0)
})
