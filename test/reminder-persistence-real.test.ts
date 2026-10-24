import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JudgeParams, readTrace, waitForTrace } from './fixtures/reminder-execution-real.ts'
import { rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { createReminderRuntime } from '../src/reminder-runtime/runtime.ts'
import { SessionState } from '../src/reminder-runtime/state.ts'
import { PersistenceTimeoutError } from '../src/reminder-runtime/persistence.ts'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { openRealReminderStorage, obstructRecord, occupyIoWorker } from './fixtures/reminder-persistence-real.ts'
import type { TestContext } from 'node:test'
import type { ReminderRuleInput } from '../src/reminder-runtime/runtime.ts'

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown }
const observe = <T>(task: Promise<T>): Promise<Outcome<T>> => task.then(
  value => ({ ok: true, value }), error => ({ ok: false, error }),
)
const event = (callId: string) => ({ type: 'tool.succeeded', sessionId: 's', callId, rootCallId: callId,
  name: 'probe', arguments: {} })
const sharedRule: ReminderRuleInput = {
  format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'Actual durable reservation',
  when: { tool: 'probe' },
  effect: { kind: 'remind', deliver: { model: { once: 'surface',
    shared: { reset: 'lifetime', lifetime: 'task-2', limit: 1 } } } },
}

/** No fake execute/save/claim service: every operation reaches a worker or the real JSON domain. */
async function fixture(t: TestContext, storageTimeoutMs = 1000) {
  const store = await openRealReminderStorage()
  const matcher = createBoundedMatcher({ timeoutMs: 2000, maxIdle: 1 })
  await matcher.warmup()
  const runtime = createReminderRuntime({ config: { storageTimeoutMs, ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    save: (id, state) => store.sessions.put(id, state),
    updateClaims: change => store.claims.update('global', change),
    dispatches: true, execute: (input, signal, timing) => matcher.detect(input, signal, timing) })
  runtime.registerSource({ sourceId: 'real-persistence', plugin: 'task-2', revision: 1, rules: [sharedRule] })
  t.after(async () => {
    await runtime.close()
    await matcher.close()
    await store.close()
    await rm(store.root, { recursive: true })
  })
  return { store, matcher, runtime }
}

/** UI metadata is not stored; compare all five durable session fields unchanged. */
function durableSnapshot(runtime: ReturnType<typeof createReminderRuntime>) {
  const snapshot = runtime.snapshot('s')
  return { seen: snapshot.seen, candidates: snapshot.candidates, diagnostics: snapshot.diagnostics,
    windows: snapshot.windows, stickies: snapshot.stickies }
}

/** The same failure may be EPERM/EISDIR/EEXIST depending on the native rename implementation. */
function assertRenameFailure(error: unknown) {
  assert.ok(error instanceof Error)
  assert.ok('syscall' in error && error.syscall === 'rename', String(error))
  assert.ok('code' in error && ['EPERM', 'EISDIR', 'EEXIST', 'ENOTEMPTY', 'EACCES'].includes(String(error.code)), String(error))
}

// This is a host integration suite: it needs the source Host selected by DSH_TEST_CHECKOUT.
// Run pressure cases in a fresh process with UV_THREADPOOL_SIZE=1, never change it after Node starts.
test('real OS rename failure rejects collection and compensates only the new shared reservation', async t => {
  const { store, runtime } = await fixture(t)
  await runtime.submit(event('seed'))
  assert.equal(runtime.snapshot('s').candidates.length, 1)
  const original = await store.readDisk('s')
  const restore = await obstructRecord(store.recordPath('s'))
  let result: Outcome<Awaited<ReturnType<typeof runtime.collect>>>
  try { result = await observe(runtime.collect({ sessionId: 's', visible: [] })) }
  finally { await restore() }
  assert.equal(result.ok, false, 'a failed real reservation cannot return a message')
  if (result.ok) return
  assertRenameFailure(result.error)
  assert.deepEqual(await store.readDisk('s'), original)
  assert.deepEqual(store.claims.get('global'), { buckets: [] })
  assert.equal(runtime.snapshot('s').candidates[0]?.status, 'pending')

  // A failed state transition was compensated. close must not resurrect its abandoned messageId.
  await runtime.close()
  const afterClose = await store.readDisk('s')
  assert.equal(afterClose.candidates[0]?.status, 'pending', 'close must not save a compensated reservation')
  assert.equal(afterClose.candidates[0]?.messageId, undefined)
})

test('real OS rename failure leaves rollback reservation and shared claim intact', async t => {
  const { store, runtime } = await fixture(t)
  await runtime.submit(event('seed'))
  const messages = await runtime.collect({ sessionId: 's', visible: [] })
  assert.equal(messages.length, 1)
  const beforeClaim = structuredClone(store.claims.get('global'))
  const beforeSession = await store.readDisk('s')
  const restore = await obstructRecord(store.recordPath('s'))
  let result: Outcome<void>
  try { result = await observe(runtime.rollback('s', messages)) }
  finally { await restore() }
  assert.equal(result.ok, false, 'failed durable rollback must not report success')
  if (result.ok) return
  assertRenameFailure(result.error)
  assert.deepEqual(store.claims.get('global'), beforeClaim)
  assert.deepEqual(await store.readDisk('s'), beforeSession)
})

test('collection waits for actual session ACK while real libuv work holds filesystem I/O', async t => {
  const { store, runtime } = await fixture(t, 20)
  await runtime.submit(event('seed'))
  const pendingBytes = readFileSync(store.recordPath('s'), 'utf8')
  let pressure: ReturnType<typeof occupyIoWorker> | undefined
  // domain/changed is a real post-ACK notification. Begin contention after the shared claim
  // is durable but before collect can enqueue its session reservation, without replacing a method.
  const remove = store.ctx.on('domain/changed', change => {
    if (pressure || change.domain !== 'context_care_reminder_claims' || change.operation !== 'put') return
    pressure = occupyIoWorker()
  })
  let collected = false
  const task = observe(runtime.collect({ sessionId: 's', visible: [] }).then(messages => {
    collected = true
    return messages
  }))
  const until = performance.now() + 3000
  while (!pressure && performance.now() < until) await delay(1)
  assert.ok(pressure, 'real shared reservation emitted its durable notification')
  remove()
  let publishedBeforeAck = false
  let retainedBeforeAck: string | undefined
  try {
    await delay(80)
    assert.equal(pressure.active(), true, 'resource pressure must still be active at the observation')
    assert.equal(readFileSync(store.recordPath('s'), 'utf8'), pendingBytes, 'actual disk still has pending state')
    assert.equal(SessionState.parse(store.sessions.get('s')).candidates[0]?.status, 'pending', 'domain publishes only after real ACK')
    publishedBeforeAck = collected
    retainedBeforeAck = runtime.snapshot('s').candidates[0]?.status
    t.diagnostic(JSON.stringify({ pressureActive: true, disk: 'pending', domain: 'pending',
      runtime: retainedBeforeAck, returnedMessages: collected, observedMs: pressure.elapsed() }))
  } finally { await pressure.done; await task; await runtime.drainPersistence('s') }
  const outcome = await task
  assert.equal(outcome.ok, false, 'the timed-out caller must never receive the late reservation')
  if (outcome.ok) throw new Error('collection unexpectedly succeeded under active pressure')
  assert.ok(outcome.error instanceof PersistenceTimeoutError)
  assert.equal(publishedBeforeAck, false, 'collect may not expose a message before its reservation is durable')
  assert.equal(retainedBeforeAck, 'pending', 'unacknowledged reservation must not be published as committed runtime state')
  assert.equal(runtime.snapshot('s').candidates[0]?.status, 'pending', 'late ACK must roll back undelivered messages')
  assert.deepEqual(await store.readDisk('s'), durableSnapshot(runtime), 'compensation must reach disk before drain returns')
  assert.deepEqual(store.claims.get('global'), { buckets: [] }, 'release shared quota only after rollback ACK')
  assert.deepEqual(runtime.pendingPersistence(), [])
})

test('late real rename failure cannot turn rollback into a successful shared-quota release', async t => {
  const { store, runtime } = await fixture(t, 20)
  await runtime.submit(event('seed'))
  const messages = await runtime.collect({ sessionId: 's', visible: [] })
  const claim = structuredClone(store.claims.get('global'))
  const reserved = await store.readDisk('s')
  const restore = await obstructRecord(store.recordPath('s'))
  const pressure = occupyIoWorker()
  const task = observe(runtime.rollback('s', messages))
  let result: Outcome<void>
  let actualWrite: Outcome<void> | undefined
  try {
    await delay(80)
    assert.equal(pressure.active(), true)
    // Capture the actual owner's completion while the failed rename is still pending.
    // The caller's timeout is not a storage completion barrier.
    const draining = observe(runtime.drainPersistence('s'))
    await pressure.done
    result = await task
    actualWrite = await draining
  } finally { await pressure.done; await task; await runtime.drainPersistence('s').catch(() => {}); await restore() }
  assert.ok(actualWrite && !actualWrite.ok, 'the real obstructed rename must finish before removing its obstacle')
  assert.ok(actualWrite.error instanceof AggregateError)
  assertRenameFailure(actualWrite.error.errors[0])
  t.diagnostic(JSON.stringify({ rollbackReportedSuccess: result.ok,
    sharedClaimsAfter: store.claims.get('global')?.buckets.flatMap(bucket => bucket.claims).length,
    durableSessionStatus: SessionState.parse(store.sessions.get('s')).candidates[0]?.status, pressureMs: pressure.elapsed() }))
  assert.equal(result.ok, false, 'real delayed storage failure must reach rollback caller')
  assert.deepEqual(store.claims.get('global'), claim, 'failed/unknown session rollback cannot free its shared quota')
  assert.deepEqual(await store.readDisk('s'), reserved)
})

test('close cannot discard newer states acknowledged while real filesystem work was queued', async t => {
  const { store, runtime } = await fixture(t, 20)
  await runtime.submit(event('seed'))
  const pressure = occupyIoWorker()
  const first = await observe(runtime.submit(event('later-one')))
  const second = await observe(runtime.submit(event('later-two')))
  const published = runtime.snapshot('s')
  let closeReturnedWhileBlocked = false
  try {
    assert.equal(pressure.active(), true)
    const closing = await observe(runtime.close())
    closeReturnedWhileBlocked = pressure.active()
    assert.equal(closing.ok, false, 'bounded close must report unresolved I/O, not pretend success')
    if (closing.ok) throw new Error('close silently discarded its owned write')
    assert.ok(closing.error instanceof PersistenceTimeoutError)
    assert.equal(closeReturnedWhileBlocked, true, 'close reports its deadline while the real write remains blocked')
    assert.ok(runtime.pendingPersistence().some(entry => entry.sessionId === 's'), 'timed-out close must retain the actual write')
    await pressure.done
    await runtime.drainPersistence('s')
    assert.deepEqual(runtime.pendingPersistence(), [])
    assert.ok(runtime.snapshot('s').seen.includes(JSON.stringify(['tool.succeeded', 'later-one'])), 'late ACK must still publish after close timed out')
    assert.equal(runtime.snapshot('s').seen.includes(JSON.stringify(['tool.succeeded', 'later-two'])), false, 'queued work whose wait expired must not run later')
    await runtime.close()
  } finally { await pressure.done; await runtime.drainPersistence('s') }
  // Reopen only after the runtime's real resource barrier, not an assumed timeout.
  const afterDrain = durableSnapshot(runtime)
  await store.close()
  const reopened = await openRealReminderStorage(store.root)
  let restored: ReturnType<typeof SessionState.parse>
  try { restored = SessionState.parse(reopened.sessions.get('s')) }
  finally { await reopened.close() }
  assert.deepEqual(restored, afterDrain, 'a fresh domain must recover the entire final acknowledged state')
  t.diagnostic(JSON.stringify({ firstAcknowledged: first.ok, secondAcknowledged: second.ok,
    closeReturnedWhileBlocked, publishedSeen: published.seen, reopenedSeen: restored.seen, pressureMs: pressure.elapsed() }))
  for (const acknowledged of published.seen) {
    assert.ok(restored.seen.includes(acknowledged), `close lost acknowledged call ${acknowledged}`)
  }
})

test('failure of an older real write cannot replace the newest acknowledged dirty snapshot', async t => {
  const { store, runtime } = await fixture(t, 20)
  await runtime.submit(event('seed'))
  const restore = await obstructRecord(store.recordPath('s'))
  const pressure = occupyIoWorker()
  const first = await observe(runtime.submit(event('later-one')))
  const second = await observe(runtime.submit(event('later-two')))
  const published = runtime.snapshot('s')
  try {
    assert.equal(pressure.active(), true)
    const draining = observe(runtime.drainPersistence('s'))
    await pressure.done
    const failure = await draining
    assert.equal(failure.ok, false, 'the first real rename must fail while its obstacle remains')
    if (failure.ok) throw new Error('obstructed write unexpectedly succeeded')
    assert.ok(failure.error instanceof AggregateError)
    assertRenameFailure(failure.error.errors[0])
  } finally { await pressure.done; await runtime.drainPersistence('s').catch(() => {}); await restore() }
  await runtime.submit(event('recovered'))
  const recovered = durableSnapshot(runtime)
  assert.ok(recovered.seen.includes(JSON.stringify(['tool.succeeded', 'recovered'])), 'a definite precommit failure must permit a later real write')
  assert.equal(recovered.seen.includes(JSON.stringify(['tool.succeeded', 'later-one'])), false)
  assert.equal(recovered.seen.includes(JSON.stringify(['tool.succeeded', 'later-two'])), false)
  await runtime.close()
  const disk = await store.readDisk('s')
  assert.deepEqual(disk, recovered, 'the recovered ACK must not be replaced by an older failed snapshot')
  t.diagnostic(JSON.stringify({ firstAcknowledged: first.ok, secondAcknowledged: second.ok,
    publishedSeen: published.seen, diskSeen: disk.seen, pressureMs: pressure.elapsed() }))
  for (const acknowledged of published.seen) {
    assert.ok(disk.seen.includes(acknowledged), `late failed write replaced newer acknowledged call ${acknowledged}`)
  }
})

for (const denied of [false, true]) {
  test('real policy: ' + (denied ? 'denial' : 'permission') + ' ignores blocked persistence and does not repeat its judge',
    { timeout: 20000 }, async t => {
      const { store, runtime } = await fixture(t, 20)
      const tracePath = join(store.root, 'policy-trace.jsonl')
      const detector = { ref: 'policy-observer', revision: 1,
        module: new URL('./fixtures/reminder-execution-real.ts', import.meta.url).href, exportName: 'judge' }
      runtime.registerDetector(detector)
      runtime.registerSource({ sourceId: 'real-policy', plugin: 'test', revision: 1, rules: [{
        format: 'reminder/v4', id: 'policy', on: 'tool.before-execute', text: 'Policy evidence', when: { tool: 'probe' },
        judge: { ref: detector.ref, revision: 1, params: JudgeParams.parse({
          label: 'policy', tracePath, mode: 'quick', ok: denied, value: { denied },
        }) },
        effect: { kind: 'deny-tool', dangerous: true, reason: 'Explicit real policy denial',
          deliver: { model: { once: 'surface' } } },
      }] })
      const prepare = (key: object, callId: string) => runtime.prepareToolExecution({
        key, sessionId: 's', name: 'probe', arguments: {}, callId, rootCallId: callId,
      })
      // Prime the real worker's dynamic import before filesystem contention begins.
      const prime = {}
      await prepare(prime, 'prime-policy')
      await runtime.settle('s')
      await runtime.drainPersistence('s')
      runtime.settleToolExecution(prime)
      const bytes = readFileSync(store.recordPath('s'), 'utf8')
      const pressure = occupyIoWorker()
      try {
        const key = {}
        await prepare(key, 'policy-under-pressure')
        assert.equal(pressure.active(), true, 'policy must complete while real filesystem I/O is still blocked')
        const verdict = runtime.decideToolExecution(key)
        assert.equal(verdict.kind, denied ? 'deny' : 'allow')
        if (verdict.kind === 'deny') assert.equal(verdict.reason, 'Explicit real policy denial')
        assert.equal(readFileSync(store.recordPath('s'), 'utf8'), bytes, 'no durable policy state has ACKed yet')
        assert.equal(runtime.snapshot('s').seen.includes(JSON.stringify(['tool.before-execute', 'policy-under-pressure'])), false)
        const duplicate = {}
        await prepare(duplicate, 'policy-under-pressure')
        const repeatVerdict = runtime.decideToolExecution(duplicate)
        assert.equal(repeatVerdict.kind, 'deny', 'a new ticket must not inherit a repeated call id verdict')
        if (repeatVerdict.kind === 'deny') assert.match(repeatVerdict.reason, /同一调用/)
        assert.equal(readTrace(tracePath).filter(item => item.eventId === 'policy-under-pressure' && item.phase === 'start').length, 1)
        t.diagnostic(JSON.stringify({ verdict, repeatVerdict, pressureActive: pressure.active(), trace: readTrace(tracePath) }))
        runtime.settleToolExecution(key)
        runtime.settleToolExecution(duplicate)
      } finally {
        await pressure.done
        await runtime.settle('s')
        await runtime.drainPersistence('s')
      }
      assert.ok((await store.readDisk('s')).seen.includes(JSON.stringify(['tool.before-execute', 'policy-under-pressure'])), 'late ACK still records the evaluated call')
    })
}

test('real policy: a pure reminder CPU loop cannot hold tool preparation open', { timeout: 20000 }, async t => {
  const { store, runtime } = await fixture(t)
  const tracePath = join(store.root, 'reminder-trace.jsonl')
  const heartbeatPath = join(store.root, 'reminder-heartbeat')
  const detector = { ref: 'reminder-cpu', revision: 1,
    module: new URL('./fixtures/reminder-execution-real.ts', import.meta.url).href, exportName: 'judge' }
  runtime.registerDetector(detector)
  runtime.registerSource({ sourceId: 'pure-reminder', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'cpu', on: 'tool.before-execute', text: 'Nonblocking reminder', when: { tool: 'probe' },
    judge: { ref: detector.ref, revision: 1, params: JudgeParams.parse({
      label: 'pure-cpu', tracePath, heartbeatPath, mode: 'cpu', ok: true, value: null,
    }) }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] })
  const controller = new AbortController()
  const key = {}
  try {
    await runtime.prepareToolExecution({ key, sessionId: 's', name: 'probe', arguments: {},
      callId: 'cpu-reminder', rootCallId: 'cpu-reminder', signal: controller.signal })
    await waitForTrace(tracePath, item => item.label === 'pure-cpu' && item.phase === 'start')
    const until = performance.now() + 1000
    while (!existsSync(heartbeatPath) && performance.now() < until) await delay(5)
    assert.ok(existsSync(heartbeatPath), 'the actual worker must enter its noncooperative CPU loop')
    assert.deepEqual(runtime.decideToolExecution(key), { kind: 'allow' })
    controller.abort(new Error('stop-real-reminder'))
    await runtime.settle('s')
    const stoppedBeat = readFileSync(heartbeatPath, 'utf8')
    await delay(100)
    assert.equal(readFileSync(heartbeatPath, 'utf8'), stoppedBeat, 'cancellation settlement must stop physical work')
  } finally {
    controller.abort(new Error('test-cleanup'))
    await runtime.settle('s')
    await runtime.drainPersistence('s')
  }
})
