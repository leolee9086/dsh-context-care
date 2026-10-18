import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreReminderEntries, restoreReminderState } from '../lib/reminder-runtime/restore.js'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { SessionState } from '../lib/reminder-runtime/state.js'
import { preV4State } from './fixtures/reminder-upgrade.ts'

for (const format of ['reminder/v1', 'reminder/v2', 'reminder/v3']) {
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
      rules: [input.candidates[0]!.rule] }), /reminder\/v4/)
    // Reopening the saved record has no more retirement work or duplicate audit.
    const reopened = await restoreReminderEntries(writes, () => { assert.fail('upgrade wrote twice') }, 200)
    assert.deepEqual(reopened, entries)
  })
}

test('mixed state preserves v4 pending candidates and sticky clocks', () => {
  const old = preV4State()
  const current = SessionState.parse({ seen: [], diagnostics: [], candidates: [{ ...old.candidates[0], id: 'current',
    rule: { format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', when: { tool: 'probe' },
      text: 'CURRENT_NOTICE', effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } } }],
    stickies: [{ key: 'sticky', activationId: 'activation', sourceId: 'source', ruleId: 'notice',
      sessionId: 'upgrade-session', text: 'STICKY', title: 'Sticky', clock: 'human-turn',
      remaining: 2, cooldown: 3, charged: true, lastHumanId: 'human-1' }] })
  const mixed = { ...old, candidates: [...old.candidates, ...current.candidates], stickies: current.stickies }
  const { state } = restoreReminderState(mixed, 100)
  assert.deepEqual(state.candidates, current.candidates)
  assert.deepEqual(state.stickies, current.stickies)
})

test('corrupt v4 and unknown formats reject without saving other records', async () => {
  for (const format of ['reminder/v4', 'reminder/v5', 'broken']) {
    await assert.rejects(restoreReminderEntries([
      ['legacy', preV4State()], ['corrupt-session', preV4State(format)],
    ], () => { assert.fail('validation failure must precede writes') }), /reminder-state-restore-failed: corrupt-session/)
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
