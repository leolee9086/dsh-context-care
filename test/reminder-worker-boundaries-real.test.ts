import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { createBoundedMatcher, MatcherFailure } from '../src/bounded-matcher.js'
import type { MatcherTiming } from '../lib/matcher/pool.js'
import { compileReminderCondition, CountLimits } from '../lib/reminder-runtime/conditions.js'
import { BatchAnswer, BatchResult, Event, MatchResult, type Work } from '../lib/reminder-runtime/state.js'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { JudgeParams, readTrace, type JudgeParamsValue } from './fixtures/reminder-execution-real.ts'
import { openRealReminderStorage } from './fixtures/reminder-persistence-real.ts'

const detector = { ref: 'boundary-observer', revision: 1,
  module: new URL('./fixtures/reminder-execution-real.ts', import.meta.url).href, exportName: 'judge' }
const condition = compileReminderCondition({ kind: 'always' })
const countLimits = CountLimits.parse(undefined)
const event = (callId: string) => Event.parse({ type: 'tool.before-execute', sessionId: 'boundary',
  callId, rootCallId: callId, name: 'probe', arguments: {}, facts: {} })
const work = (callId: string, params: JudgeParamsValue): Work => ({ reminder: {
  condition, event: event(callId), maxBytes: 1_000_000, countLimits, judge: detector, params,
} })
type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown }
const observe = (pending: Promise<unknown>): Promise<Outcome> => pending.then(
  value => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }))
function failed(result: Outcome): Error {
  assert.equal(result.ok, false, 'the failing real operation must reject')
  if (result.ok || !(result.error instanceof Error)) throw new Error('operation did not reject with an Error')
  return result.error
}
function matched(result: Outcome): void {
  assert.equal(result.ok, true)
  assert.equal(MatchResult.parse(result.value).status, 'matched')
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'care-worker-boundaries-'))
  const matcher = createBoundedMatcher({ maxIdle: 1, maxPending: 8, startupMs: 10000, timeoutMs: 2000 })
  t.after(async () => { await matcher.close(); await rm(root, { recursive: true, force: true }) })
  await matcher.warmup()
  const tracePath = join(root, 'judge.jsonl')
  const params = (label: string, mode: JudgeParamsValue['mode'] = 'quick') => JudgeParams.parse({
    label, mode, tracePath, ok: true, value: { label },
  })
  return { root, matcher, tracePath, params }
}

/** A watchdog is cleanup only: if it fires, the business assertion MUST fail. */
async function bounded(operation: (signal: AbortSignal) => Promise<unknown>) {
  const controller = new AbortController()
  let watchdog = false
  const timer = setTimeout(() => {
    watchdog = true
    controller.abort(new Error('boundary-watchdog'))
  }, 3000)
  try { return { outcome: await observe(operation(controller.signal)), watchdog: () => watchdog } }
  finally { clearTimeout(timer) }
}

test('real worker transport: an uncloneable dispatch rejects and releases the actual thread before recovery',
  { timeout: 20000 }, async t => {
    const { matcher, tracePath, params } = await fixture(t)
    // JSON sizing accepts an omitted function; Node's actual structured clone rejects it.
    const outcome = await observe(matcher.detect({ warmup: true, uncloneable: () => undefined }))
    const error = failed(outcome)
    assert.ok(error instanceof MatcherFailure)
    assert.ok(error.cause instanceof Error)
    assert.equal(error.cause.name, 'DataCloneError')
    assert.equal(matcher.getStats().active, 0)
    assert.equal(matcher.getStats().threads, 0, 'rejection waits for the real worker exit')
    matched(await observe(matcher.detect(work('after-dispatch-failure', params('after-dispatch-failure')))))
    assert.deepEqual(readTrace(tracePath).filter(item => item.phase === 'start').map(item => item.label), ['after-dispatch-failure'])
    t.diagnostic(JSON.stringify({ cause: error.cause.name, phase: error.diagnostic.phase, stats: matcher.getStats() }))
  })

for (const route of ['solo', 'batch'] as const) {
  test(`real worker transport: ${route} judge error with uncloneable fields settles without poisoning the queue`,
    { timeout: 20000 }, async t => {
      const { matcher, tracePath, params } = await fixture(t)
      const bad = params('bad-error', 'uncloneable-error')
      const payload: Work = route === 'solo' ? work('bad-error', bad) : { reminderBatch: {
        event: event('bad-batch'), countLimits, maxBytes: 1_000_000, budgetMs: 4000,
        rules: [{ key: 'bad', condition, judge: detector, params: bad },
          { key: 'good', condition, judge: detector, params: params('same-batch-good') }],
      } }
      const observed = await bounded(signal => matcher.detect(payload, signal))
      const statsAfterFault = matcher.getStats()
      const recovery = await observe(matcher.detect(work('after-error', params('after-error'))))
      const starts = readTrace(tracePath).filter(item => item.phase === 'start')
      t.diagnostic(JSON.stringify({ route, watchdog: observed.watchdog(), statsAfterFault,
        outcome: observed.outcome.ok ? observed.outcome : { ok: false, error: failed(observed.outcome).message }, starts }))
      assert.equal(observed.watchdog(), false, 'a failed error reply must not leave its task waiting forever')
      if (route === 'solo') {
        assert.match(failed(observed.outcome).message, /matcher-error-serialization-failed/)
      } else {
        assert.equal(observed.outcome.ok, true, 'one malformed exception is a per-rule failure, not loss of the rest of a batch')
        const batch = BatchResult.parse(observed.outcome.value)
        const answers = batch.items.map(item => BatchAnswer.parse(item))
        assert.deepEqual(answers.map(item => item.key), ['bad', 'good'])
        assert.ok(answers[0] && 'error' in answers[0])
        assert.match(answers[0].error.message, /matcher-error-serialization-failed/)
        assert.ok(answers[1] && 'match' in answers[1])
        assert.equal(MatchResult.parse(answers[1].match).ok, true)
      }
      matched(recovery)
      assert.equal(statsAfterFault.active, 0)
      assert.equal(new Set(starts.map(item => item.threadId)).size, 1, 'a reportable rule failure must keep the real healthy worker usable')
      assert.deepEqual(starts.map(item => item.label), route === 'solo'
        ? ['bad-error', 'after-error'] : ['bad-error', 'same-batch-good', 'after-error'])
    })
}

for (const callback of ['onDispatch', 'onItem', 'onTiming'] as const) {
  test(`real worker completion: throwing ${callback} settles and releases the next operation`,
    { timeout: 20000 }, async t => {
      const { matcher, tracePath, params } = await fixture(t)
      let callbacks = 0
      const timing: MatcherTiming = { workTimeoutMs: 2000, [callback]: () => {
        callbacks++
        throw new Error(`actual-${callback}-failure`)
      } }
      const payload: Work = { reminderBatch: { event: event(callback), countLimits, maxBytes: 1_000_000,
        rules: [{ key: 'observed', condition, judge: detector, params: params(callback) }] } }
      const observed = await bounded(signal => matcher.detect(payload, signal, timing))
      const next = await observe(matcher.detect(work('after-callback', params('after-callback'))))
      assert.equal(observed.watchdog(), false)
      assert.match(failed(observed.outcome).message, new RegExp(`actual-${callback}-failure`))
      assert.equal(callbacks, 1)
      matched(next)
      assert.equal(matcher.getStats().active, 0)
      assert.equal(readTrace(tracePath).filter(item => item.phase === 'start' && item.label === 'after-callback').length, 1)
      t.diagnostic(JSON.stringify({ callback, stats: matcher.getStats(), trace: readTrace(tracePath) }))
    })
}

test('real worker startup: a cold startup deadline is not a rule execution timeout', { timeout: 20000 }, async t => {
  const matcher = createBoundedMatcher({ maxIdle: 1, maxPending: 1, startupMs: 1, timeoutMs: 2000 })
  t.after(() => matcher.close())
  const outcome = await observe(matcher.detect({ warmup: true }))
  const error = failed(outcome)
  assert.ok(error instanceof MatcherFailure)
  assert.match(error.message, /matcher-startup-timeout/)
  assert.equal(error.diagnostic.phase, 'startup')
  assert.equal(error.diagnostic.processingElapsedMs, null)
  assert.equal(matcher.getStats().active, 0)
  assert.equal(matcher.getStats().threads, 0)
  t.diagnostic(JSON.stringify({ message: error.message, diagnostic: error.diagnostic, stats: matcher.getStats() }))
})

test('real worker startup: closing during a claimed warmup releases its waiting and queued operations',
  { timeout: 20000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'care-closed-acquire-'))
    const matcher = createBoundedMatcher({ maxIdle: 1, maxPending: 4, startupMs: 10000 })
    t.after(async () => { await matcher.close(); await rm(root, { recursive: true, force: true }) })
    const tracePath = join(root, 'judge.jsonl')
    const params = JudgeParams.parse({ label: 'never-started', tracePath, mode: 'quick', ok: true, value: null })
    // No await until close: the real worker may be starting, but its ready
    // event cannot have been dispatched on this Host turn. One task owns that
    // starting entry and the other remains in the actual Host queue.
    const warming = observe(matcher.warmup())
    const claimed = observe(matcher.detect(work('claimed', params)))
    const queued = observe(matcher.detect(work('queued', params)))
    const before = matcher.getStats()
    assert.equal(before.preparing, 1)
    assert.equal(before.active, 2)
    const closing = matcher.close()
    assert.equal(matcher.close(), closing)
    await closing
    const outcomes = await Promise.all([warming, claimed, queued])
    for (const outcome of outcomes) assert.match(failed(outcome).message, /matcher-closed/)
    assert.deepEqual(readTrace(tracePath), [])
    assert.deepEqual(matcher.getStats(), { active: 0, idle: 0, preparing: 0, threads: 0,
      workersStarted: 1, completed: 0, failed: 0, closed: true })
    await assert.rejects(matcher.detect(work('after-close', params)), /matcher-closed/)
    t.diagnostic(JSON.stringify({ before, after: matcher.getStats() }))
  })

test('real runtime startup: a missing installed worker reports startup failure and recovers after the entry is restored',
  { timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'care-missing-worker-'))
    const copied = join(root, 'lib', 'matcher')
    await mkdir(copied, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    // Copy the shipped pool bytes unchanged, but leave its worker entry genuinely absent.
    // The failure comes from Node's real module loader, not an injected executor.
    for (const name of ['pool.js', 'progress.js']) {
      await copyFile(new URL(`../lib/matcher/${name}`, import.meta.url), join(copied, name))
    }
    const loaded: unknown = await import(pathToFileURL(join(copied, 'pool.js')).href)
    if (loaded === null || typeof loaded !== 'object' || !('createBoundedMatcher' in loaded)
      || typeof loaded.createBoundedMatcher !== 'function') throw new Error('copied production matcher export missing')
    const createCopiedMatcher = loaded.createBoundedMatcher as typeof createBoundedMatcher
    const matcher = createCopiedMatcher({ maxIdle: 1, startupMs: 5000, timeoutMs: 2000 })
    const store = await openRealReminderStorage(join(root, 'storage'))
    const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }, dispatches: true,
      execute: (input, signal, timing) => matcher.detect(input, signal, timing),
      save: (id, state) => store.sessions.put(id, state) })
    t.after(async () => {
      await runtime.close(); await matcher.close(); await store.close()
      await rm(root, { recursive: true, force: true })
    })
    const tracePath = join(root, 'judge.jsonl')
    runtime.registerDetector(detector)
    runtime.registerSource({ sourceId: 'startup-policy', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'policy', on: 'tool.before-execute', text: 'Real startup boundary', when: { tool: 'probe' },
      judge: { ref: detector.ref, revision: 1, params: JudgeParams.parse({
        label: 'after-restore', tracePath, mode: 'quick', ok: false, value: null,
      }) }, effect: { kind: 'deny-tool', dangerous: true, reason: 'A real policy match', deliver: { model: { once: 'surface' } } },
    }] })
    const prepare = async (callId: string) => {
      const key = {}
      await runtime.prepareToolExecution({ key, sessionId: 'boundary', callId, rootCallId: callId, name: 'probe', arguments: {} })
      const verdict = runtime.decideToolExecution(key)
      runtime.settleToolExecution(key)
      await runtime.settle('boundary'); await runtime.drainPersistence('boundary')
      return verdict
    }
    const broken = await prepare('worker-missing')
    const failedDisk = await store.readDisk('boundary')
    assert.deepEqual(readTrace(tracePath), [], 'a missing worker cannot have invoked the judge')
    // A real source junction repairs the installation layout without patching any code.
    await symlink(fileURLToPath(new URL('../src/', import.meta.url)), join(root, 'src'), 'junction')
    const recovered = await prepare('worker-restored')
    t.diagnostic(JSON.stringify({ broken, recovered, diagnostics: failedDisk.diagnostics, stats: matcher.getStats() }))
    assert.deepEqual(broken, { kind: 'deny', reason: '提醒匹配线程未能启动，本次调用未执行' })
    assert.deepEqual(recovered, { kind: 'allow' })
    assert.equal(readTrace(tracePath).filter(item => item.phase === 'start').length, 1)
    const diagnostic = failedDisk.diagnostics.find(item => item.eventId === 'worker-missing' && item.ruleId === 'policy')
    assert.ok(diagnostic)
    const evidence = z.object({ message: z.string(), diagnostic: z.object({ phase: z.literal('startup'),
      processingElapsedMs: z.null() }) }).parse(diagnostic)
    assert.match(evidence.message, /matcher-worker-startup-failed/)
    const disk = await store.readDisk('boundary')
    assert.ok(disk.seen.includes(JSON.stringify(['tool.before-execute', 'worker-restored'])))
  })
