import { createBoundedMatcher, compileSnapshotCondition as compileReminderCondition, CountLimits, RuleEventInput as Event, EventMatchResult as MatchResult, BatchResult, BatchAnswer } from '@leolee9086/dsh-rule-engine'
import type { EventWork as Work, RuleDeclaration as ReminderRuleInput, EventRuntimeOptions as RuntimeOptions } from '@leolee9086/dsh-rule-engine'
import test, { type TestContext } from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

import { JudgeParams, readTrace, waitForTrace, burnCpu, type JudgeParamsValue } from './fixtures/reminder-execution-real.ts'
import { createReminderRuntime } from './reminder-runtime-fixture.ts'
import { openRealReminderStorage } from './fixtures/reminder-persistence-real.ts'

const moduleUrl = new URL('./fixtures/reminder-execution-real.ts', import.meta.url).href
const detector = { ref: 'real-observer', revision: 1, module: moduleUrl, exportName: 'judge' }
const limits = CountLimits.parse(undefined)
const condition = compileReminderCondition({ kind: 'always' })
const makeEvent = (callId: string) => Event.parse({ type: 'tool.succeeded', sessionId: 'real-worker',
  callId, rootCallId: callId, name: 'read', arguments: { file_path: 'input.ts' }, facts: { original: 'preserved' } })
const work = (callId: string, params: JudgeParamsValue): Work => ({ reminder: {
  condition, event: makeEvent(callId), maxBytes: 1_000_000, countLimits: limits, judge: detector, params,
} })
const timing = (workTimeoutMs: number) => ({ workTimeoutMs, onDispatch: () => {} })

type Outcome = { status: 'fulfilled'; value: unknown } | { status: 'rejected'; error: unknown }
/** Attach rejection handling at dispatch, including failures before we release a gate. */
async function capture(pending: Promise<unknown>): Promise<Outcome> {
  try { return { status: 'fulfilled', value: await pending } }
  catch (error: unknown) { return { status: 'rejected', error } }
}
function describe(outcome: Outcome): unknown {
  if (outcome.status === 'fulfilled') return { status: outcome.status, value: outcome.value }
  const error = outcome.error
  return { status: outcome.status, name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    diagnostic: error !== null && typeof error === 'object' && 'diagnostic' in error ? error.diagnostic : null }
}
function matched(outcome: Outcome, message: string) {
  assert.equal(outcome.status, 'fulfilled', `${message}: ${JSON.stringify(describe(outcome))}`)
  if (outcome.status !== 'fulfilled') throw new Error(message)
  const result = MatchResult.parse(outcome.value)
  assert.equal(result.status, 'matched', message)
  return result
}
async function setup(t: TestContext, maxIdle = 1, warm = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-execution-real-'))
  const matcher = createBoundedMatcher({ maxIdle, maxPending: 16, startupMs: 10000, timeoutMs: 5000 })
  t.after(async () => { await matcher.close(); await rm(root, { recursive: true, force: true }) })
  if (warm) await matcher.warmup()
  const tracePath = join(root, 'judge.jsonl')
  const params = (label: string, extra: Partial<JudgeParamsValue> = {}) => JudgeParams.parse({
    label, tracePath, mode: 'quick', ok: true, value: { label }, ...extra,
  })
  return { root, matcher, tracePath, params }
}

// The first judge is demonstrably running before the second is dispatched.
// A real file gate keeps it there beyond the second task's execution allowance.
test('real worker: queued task retains its execution budget while another judge owns the thread',
  { timeout: 20000 }, async t => {
    const { root, matcher, tracePath, params } = await setup(t)
    const gatePath = join(root, 'release')
    const first = capture(matcher.detect(work('owner', params('owner', { mode: 'gate', gatePath })),
      undefined, timing(5000)))
    await waitForTrace(tracePath, item => item.phase === 'start' && item.label === 'owner')
    const began = performance.now()
    const second = capture(matcher.detect(work('queued', params('queued')), undefined, timing(150)))
    await delay(450)
    const beforeRelease = readTrace(tracePath)
    await writeFile(gatePath, 'release')
    const results = await Promise.all([first, second])
    t.diagnostic(JSON.stringify({ queuedForMs: performance.now() - began,
      beforeRelease, outcomes: results.map(describe), stats: matcher.getStats() }))
    assert.equal(beforeRelease.some(item => item.label === 'queued'), false, 'queued judge must not run before its owner releases')
    matched(results[0]!, 'the admitted owner must not inherit a queued task timeout')
    matched(results[1]!, 'queue residence must not consume the later task execution budget')
    const starts = readTrace(tracePath).filter(item => item.phase === 'start')
    assert.deepEqual(starts.map(item => item.label), ['owner', 'queued'])
    assert.equal(new Set(starts.map(item => item.threadId)).size, 1, 'healthy serial work reuses the actual worker')
  })

test('real worker: aborting CPU work stops its heartbeat and subsequent work succeeds',
  { timeout: 20000 }, async t => {
    const { root, matcher, tracePath, params } = await setup(t)
    const heartbeatPath = join(root, 'heartbeat')
    const controller = new AbortController()
    const pending = capture(matcher.detect(work('cpu', params('cpu', { mode: 'cpu', heartbeatPath })),
      controller.signal, timing(5000)))
    const started = await waitForTrace(tracePath, item => item.phase === 'start' && item.label === 'cpu')
    // Judge start precedes the first heartbeat; observe that file before aborting.
    const deadline = performance.now() + 10000
    while (!existsSync(heartbeatPath) && performance.now() < deadline) await delay(5)
    assert.ok(existsSync(heartbeatPath), 'CPU judge must actually enter its loop')
    controller.abort(new Error('test-request-cancelled'))
    const cancelled = await pending
    assert.equal(cancelled.status, 'rejected')
    const heartbeatAfterSettlement = readFileSync(heartbeatPath, 'utf8')
    await delay(120)
    const heartbeatLater = readFileSync(heartbeatPath, 'utf8')
    // Run the recovery check even when heartbeat continued, to expose both facts.
    const next = await capture(matcher.detect(work('after-cancel', params('after-cancel')),
      undefined, timing(800)))
    t.diagnostic(JSON.stringify({ cancelled: describe(cancelled), started,
      heartbeatAfterSettlement, heartbeatLater, next: describe(next), stats: matcher.getStats(), trace: readTrace(tracePath) }))
    assert.equal(heartbeatLater, heartbeatAfterSettlement, 'abort settlement must mean the CPU worker has actually stopped')
    matched(next, 'independent work after cancellation must complete')
    const nextStart = readTrace(tracePath).find(item => item.phase === 'start' && item.label === 'after-cancel')
    assert.ok(nextStart, 'success must have a real judge invocation')
    assert.notEqual(nextStart.threadId, started.threadId, 'CPU cancellation must retire the old worker')
  })

test('real worker: a throwing judge reports failure and the same worker still evaluates valid params and facts',
  { timeout: 20000 }, async t => {
    const { matcher, tracePath, params } = await setup(t)
    const bad = await capture(matcher.detect(work('bad', params('bad', { mode: 'throw' })), undefined, timing(2000)))
    assert.equal(bad.status, 'rejected')
    if (bad.status !== 'rejected') throw new Error('judge should throw')
    assert.ok(bad.error instanceof Error)
    assert.match(bad.error.message, /real-judge-failure:bad/)
    const goodParams = params('good', { value: { nested: ['specific', 7, false, null] } })
    const good = matched(await capture(matcher.detect(work('good', goodParams), undefined, timing(2000))), 'later judge')
    assert.deepEqual(good.facts, { label: 'good', value: goodParams.value,
      eventId: 'good', eventFacts: { original: 'preserved' } })
    const starts = readTrace(tracePath).filter(item => item.phase === 'start')
    assert.equal(starts.length, 2)
    assert.equal(starts[0]!.threadId, starts[1]!.threadId)
    assert.deepEqual(starts[1]!.params, goodParams)
    t.diagnostic(JSON.stringify({ bad: describe(bad), good, starts, stats: matcher.getStats() }))
  })

// Work publicly permits per-item judge/params. Verify this using the production
// batch transport; a synthetic asBatch loop would hide a strict-schema rejection.
test('real worker: mixed batch preserves each judge params, facts and unmatched result',
  { timeout: 20000 }, async t => {
    const { matcher, tracePath, params } = await setup(t)
    const alpha = params('alpha', { value: { choice: 'A', count: 2 } })
    const beta = params('beta', { ok: false, value: ['B', 0, null] })
    const payload: Work = { reminderBatch: { event: makeEvent('mixed'), maxBytes: 1_000_000,
      countLimits: limits, budgetMs: 5000, rules: [
        { key: 'plain', condition },
        { key: 'alpha', condition, judge: detector, params: alpha },
        { key: 'beta', condition, judge: detector, params: beta },
      ] } }
    const outcome = await capture(matcher.detect(payload, undefined, timing(5000)))
    t.diagnostic(JSON.stringify({ outcome: describe(outcome), trace: readTrace(tracePath), stats: matcher.getStats() }))
    assert.equal(outcome.status, 'fulfilled', 'production batch must honor its per-item judge/params contract')
    if (outcome.status !== 'fulfilled') throw new Error('mixed batch rejected')
    const batch = BatchResult.parse(outcome.value)
    assert.equal(batch.stopped, false)
    const answers = batch.items.map(item => BatchAnswer.parse(item))
    assert.deepEqual(answers.map(item => item.key), ['plain', 'alpha', 'beta'])
    const resultOf = (key: string) => {
      const answer = answers.find(item => item.key === key)
      assert.ok(answer && 'match' in answer, `missing match for ${key}`)
      return MatchResult.parse(answer.match)
    }
    assert.equal(resultOf('plain').status, 'matched')
    assert.deepEqual(resultOf('alpha').facts, { label: 'alpha', value: alpha.value,
      eventId: 'mixed', eventFacts: { original: 'preserved' } })
    assert.equal(resultOf('beta').status, 'unmatched')
    assert.equal(resultOf('beta').ok, false)
    assert.deepEqual(resultOf('beta').facts, { label: 'beta', value: beta.value,
      eventId: 'mixed', eventFacts: { original: 'preserved' } })
    const starts = readTrace(tracePath).filter(item => item.phase === 'start')
    assert.deepEqual(starts.map(item => item.params), [alpha, beta])
  })

test('real runtime: completing a plain batch does not re-enter still-running judges',
  { timeout: 30000 }, async t => {
    // Concurrent cold acquisitions reserve distinct starting workers. The warm
    // implementation can select the same idle entry before any caller records
    // its task; that serializes all work and hides the batch/solo overlap.
    const { root, matcher, tracePath, params } = await setup(t, 4, false)
    const storage = await openRealReminderStorage(join(root, 'storage'))
    const gatePath = join(root, 'release')
    let completedBatches = 0
    // This observer forwards the exact input, signal, timing and result to the
    // production matcher. It does not fabricate execution or batch callbacks.
    const execute: NonNullable<RuntimeOptions['execute']> = async (input, signal, options) => {
      const result: unknown = await matcher.detect(input, signal, options)
      if ('reminderBatch' in input) completedBatches++
      return result
    }
    const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 4000, roundTimeoutMs: 10000 },
      dispatches: true, execute, save: (id, state) => storage.sessions.put(id, state) })
    try {
      runtime.registerDetector(detector)
      const alpha = params('runtime-alpha', { mode: 'gate', gatePath, value: { identity: 'A', values: [1, true] } })
      const beta = params('runtime-beta', { mode: 'gate', gatePath, value: { identity: 'B', values: [2, null] } })
      const plain: ReminderRuleInput = eventRule('tool.succeeded', { id: 'plain', event: { tool: 'read' } }, { template: 'plain' })
      runtime.registerSource({ sourceId: 'real-mixed', plugin: 'test', revision: 1, rules: [
        { ...plain, id: 'alpha', priority: 30, judge: { ref: detector.ref, revision: 1, params: alpha } },
        { ...plain, id: 'beta', priority: 20, judge: { ref: detector.ref, revision: 1, params: beta } },
        { ...plain, priority: 10 },
      ] })
      const pending = capture(runtime.submit(makeEvent('runtime-mixed')))
      await waitForTrace(tracePath, item => item.phase === 'start' && item.label === 'runtime-alpha')
      // The real async judges stay unfinished while the real plain batch can
      // finish. No assumed timeout/return value is injected into the runtime.
      await delay(300)
      const beforeRelease = readTrace(tracePath)
      const completedBatchesBeforeRelease = completedBatches
      await writeFile(gatePath, 'release')
      const outcome = await pending
      const deadline = performance.now() + 5000
      while (matcher.getStats().active > 0 && performance.now() < deadline) await delay(5)
      const snapshot = runtime.snapshot('real-worker')
      const persisted = await storage.readDisk('real-worker')
      const starts = readTrace(tracePath).filter(item => item.phase === 'start')
      t.diagnostic(JSON.stringify({ completedBatchesBeforeRelease, completedBatches, beforeRelease, starts, outcome: describe(outcome),
        diagnostics: snapshot.diagnostics, candidates: snapshot.candidates.map(item => ({ ruleId: item.ruleId, evidence: item.evidence })),
        stats: matcher.getStats() }))
      assert.equal(outcome.status, 'fulfilled')
      assert.equal(matcher.getStats().active, 0, 'all real worker tasks must settle before observing call counts')
      assert.deepEqual(snapshot.candidates.map(item => item.ruleId), ['alpha', 'beta', 'plain'])
      assert.deepEqual(persisted.candidates, snapshot.candidates, 'candidate evidence must reach the actual storage domain')
      const evidence = z.object({ facts: z.object({ label: z.string(), value: z.json(),
        eventId: z.string(), eventFacts: z.record(z.string(), z.json()) }) }).passthrough()
      for (const [id, expected] of [['alpha', alpha], ['beta', beta]] as const) {
        const candidate = snapshot.candidates.find(item => item.ruleId === id)
        assert.ok(candidate)
        // Runtime initializes analyzer facts to {}; verify that existing contract
        // explicitly rather than assuming event.facts survives runtime analysis.
        assert.deepEqual(evidence.parse(candidate.evidence).facts, { label: expected.label, value: expected.value,
          eventId: 'runtime-mixed', eventFacts: {} })
        const calls = starts.filter(item => item.label === expected.label)
        assert.ok(calls.every(item => JSON.stringify(item.params) === JSON.stringify(expected)), `${id} params must remain independent`)
        assert.equal(calls.length, 1, `${id} judge must execute exactly once even when the plain batch finishes first`)
      }
    } finally {
      await writeFile(gatePath, 'release')
      await runtime.close()
      await storage.close()
    }
  })

test('real worker: completed work survives a Host CPU block past its timer deadline',
  { timeout: 20000 }, async t => {
    const { root, matcher, tracePath, params } = await setup(t)
    // Import and validate the real local module before measuring execution.
    matched(await capture(matcher.detect(work('prime-host', params('prime-host')), undefined, timing(2000))), 'prime judge')
    const gatePath = join(root, 'release')
    const workTimeoutMs = 300
    let dispatchedAt: number | undefined
    const pending = capture(matcher.detect(work('host-block', params('host-block', { mode: 'gate', gatePath })),
      undefined, { workTimeoutMs, onDispatch: () => { dispatchedAt = performance.now() } }))
    const started = await waitForTrace(tracePath, item => item.label === 'host-block' && item.phase === 'start')
    const blockAndObserve = () => {
      const began = performance.now()
      // No await after releasing the worker: the Host cannot consume its result
      // until the calculation below ends. File evidence crosses that boundary.
      writeFileSync(gatePath, 'release')
      const cpu = burnCpu(800)
      const ended = performance.now()
      const completed = readTrace(tracePath).find(item => item.label === 'host-block' && item.phase === 'end')
      return { began, ended, cpu, completed }
    }
    // Block in the real check phase. A due timer then runs before the next poll
    // can deliver the worker result. Nothing replaces timers or their ordering.
    const observation = await new Promise<ReturnType<typeof blockAndObserve>>((resolve, reject) => {
      setImmediate(() => {
        try { resolve(blockAndObserve()) }
        catch (error: unknown) { reject(error) }
      })
    })
    const outcome = await pending
    t.diagnostic(JSON.stringify({ dispatchedAt, started, observation, outcome: describe(outcome), stats: matcher.getStats() }))
    assert.ok(observation.cpu.iterations > 0)
    assert.ok(observation.ended - observation.began > workTimeoutMs, 'Host must actually block beyond the work allowance')
    assert.ok(observation.completed, 'worker must physically finish before Host event processing resumes')
    assert.equal(typeof dispatchedAt, 'number')
    if (dispatchedAt === undefined) throw new Error('dispatch observation missing')
    assert.ok(observation.completed.at - dispatchedAt < workTimeoutMs, 'worker result must already exist within its nominal allowance')
    assert.ok(observation.completed.at < observation.ended, 'completion must precede the end of Host CPU work')
    const result = matched(outcome, 'late Host timer must not reject completed worker computation')
    assert.deepEqual(result.facts, { label: 'host-block', value: { label: 'host-block' },
      eventId: 'host-block', eventFacts: { original: 'preserved' } })
  })

test('real worker: a batch may exceed one rule allowance while every rule stays within its own budget',
  { timeout: 20000 }, async t => {
    const { matcher, tracePath, params } = await setup(t)
    matched(await capture(matcher.detect(work('prime-batch', params('prime-batch')), undefined, timing(2000))), 'prime judge')
    const ruleTimeoutMs = 300
    const roundTimeoutMs = 5000
    const rules = Array.from({ length: 12 }, (_, index) => ({ key: `cpu-${index}`, condition, judge: detector,
      params: params(`cpu-${index}`, { mode: 'burn', durationMs: 80, value: { index } }) }))
    const payload: Work = { reminderBatch: { event: makeEvent('cumulative'), maxBytes: 1_000_000,
      countLimits: limits, budgetMs: roundTimeoutMs, rules } }
    const streamed: z.infer<typeof BatchAnswer>[] = []
    const outcome = await capture(matcher.detect(payload, undefined, { ...timing(ruleTimeoutMs),
      onItem: (raw: unknown) => { streamed.push(BatchAnswer.parse(raw)) } }))
    const trace = readTrace(tracePath).filter(item => item.eventId === 'cumulative')
    t.diagnostic(JSON.stringify({ ruleTimeoutMs, roundTimeoutMs,
      outcome: outcome.status === 'rejected' ? describe(outcome) : { status: outcome.status },
      streamedKeys: streamed.map(item => item.key), stats: matcher.getStats() }))
    for (const item of trace) t.diagnostic(JSON.stringify({ observation: 'batch-judge',
      label: item.label, phase: item.phase, threadId: item.threadId, at: item.at }))
    assert.equal(outcome.status, 'fulfilled', 'batch cumulative execution must not inherit a single-rule deadline')
    if (outcome.status !== 'fulfilled') throw new Error('cumulative batch rejected')
    const batch = BatchResult.parse(outcome.value)
    assert.equal(batch.stopped, false)
    const answers = batch.items.map(item => BatchAnswer.parse(item))
    assert.deepEqual(answers.map(item => item.key), rules.map(rule => rule.key))
    assert.deepEqual(streamed.map(item => item.key), rules.map(rule => rule.key), 'real worker must deliver each item once')
    assert.ok(batch.elapsedMs > ruleTimeoutMs, 'real total work must exceed the per-rule allowance')
    assert.ok(batch.elapsedMs < roundTimeoutMs, 'this input must still fit the real round allowance')
    for (const answer of answers) {
      assert.ok('match' in answer, `${answer.key} must have its own successful result`)
      assert.equal(MatchResult.parse(answer.match).status, 'matched')
      assert.ok(answer.ms < ruleTimeoutMs, `${answer.key} must actually execute below its individual allowance`)
      const started = trace.find(item => item.label === answer.key && item.phase === 'start')
      const ended = trace.find(item => item.label === answer.key && item.phase === 'end')
      assert.ok(started && ended, `${answer.key} requires physical start and completion evidence`)
      assert.ok(ended.at - started.at >= 80, `${answer.key} must perform the requested synchronous computation`)
    }
    assert.equal(trace.filter(item => item.phase === 'start').length, rules.length)
  })

test('real runtime: priority orders judge execution and an exclusive winner skips later judges before invocation',
  { timeout: 30000 }, async t => {
    const { root, matcher, tracePath, params } = await setup(t, 4, false)
    const storage = await openRealReminderStorage(join(root, 'storage'))
    const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 10000 },
      dispatches: true, execute: (input, signal, options) => matcher.detect(input, signal, options),
      save: (id, state) => storage.sessions.put(id, state) })
    try {
      runtime.registerDetector(detector)
      const plain: ReminderRuleInput = eventRule('tool.succeeded', { id: 'base', event: { tool: 'read' } }, { template: 'ORDER' })
      const judged = (label: string, extra: Partial<JudgeParamsValue> = {}) => ({ ref: detector.ref, revision: 1,
        params: params(label, { mode: 'burn', durationMs: 60, ...extra }) })
      // Registration order intentionally disagrees with priority. The skipped
      // judge would physically log its invocation and throw if it ever ran.
      runtime.registerSource({ sourceId: 'real-order', plugin: 'test', revision: 1, rules: [
        { ...plain, id: 'skipped', priority: 10, exclusiveGroup: 'winner-group', judge: judged('skipped', { mode: 'throw' }) },
        { ...plain, id: 'fallback', priority: 20, exclusiveGroup: 'fallback-group', judge: judged('fallback') },
        { ...plain, id: 'independent', priority: 40, judge: judged('independent') },
        { ...plain, id: 'unmatched', priority: 30, exclusiveGroup: 'fallback-group', judge: judged('unmatched', { ok: false }) },
        { ...plain, id: 'winner', priority: 50, exclusiveGroup: 'winner-group', judge: judged('winner') },
      ] })
      const outcome = await capture(runtime.submit(makeEvent('ordered')))
      const trace = readTrace(tracePath)
      const starts = trace.filter(item => item.phase === 'start')
      const snapshot = runtime.snapshot('real-worker')
      const persisted = await storage.readDisk('real-worker')
      t.diagnostic(JSON.stringify({ outcome: describe(outcome), trace,
        candidates: snapshot.candidates.map(item => item.ruleId), diagnostics: snapshot.diagnostics, stats: matcher.getStats() }))
      assert.equal(outcome.status, 'fulfilled')
      assert.deepEqual(starts.map(item => item.label), ['winner', 'independent', 'unmatched', 'fallback'])
      assert.equal(trace.some(item => item.label === 'skipped'), false, 'exclusive skip must happen before local judge code is invoked')
      let previousEnd = -Infinity
      for (const start of starts) {
        const end = trace.find(item => item.label === start.label && item.phase === 'end')
        assert.ok(end, `${start.label} must finish before the next priority is evaluated`)
        assert.ok(start.at >= previousEnd, `${start.label} must not run in parallel ahead of its preceding rule`)
        previousEnd = end.at
      }
      assert.deepEqual(snapshot.candidates.map(item => item.ruleId), ['winner', 'independent', 'fallback'])
      assert.deepEqual(persisted.candidates, snapshot.candidates, 'ordered results must reach the actual disk domain')
    } finally {
      await runtime.close()
      await storage.close()
    }
  })

for (const roundExhausted of [false, true]) {
  test('real runtime: ' + (roundExhausted ? 'round exhaustion leaves the suffix unstarted' : 'rule termination resumes only the unstarted suffix'),
    { timeout: 30000 }, async t => {
      const { root, matcher, tracePath, params } = await setup(t)
      const storage = await openRealReminderStorage(join(root, 'storage'))
      const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000,
        roundTimeoutMs: roundExhausted ? 300 : 7000 }, dispatches: true,
        execute: (input, signal, options) => matcher.detect(input, signal, options),
        save: (id, state) => storage.sessions.put(id, state) })
      const heartbeatPath = join(root, 'timeout-heartbeat')
      try {
        // Import the actual judge before measuring the constrained round itself.
        matched(await capture(matcher.detect(work('prime-timeout', params('prime-timeout')),
          undefined, timing(2000))), 'prime the real worker')
        runtime.registerDetector(detector)
        const plain: ReminderRuleInput = eventRule('tool.succeeded', { id: 'base', event: { tool: 'read' } }, { template: 'Timeout result' })
        const judged = (label: string, extra: Partial<JudgeParamsValue> = {}) => ({ ref: detector.ref,
          revision: 1, params: params(label, extra) })
        runtime.registerSource({ sourceId: 'real-timeout', plugin: 'test', revision: 1, rules: [
          { ...plain, id: 'prefix', priority: 40, judge: judged('prefix', { mode: 'burn', durationMs: 40 }) },
          { ...plain, id: 'stuck', priority: 30, exclusiveGroup: 'stuck-group',
            judge: { ...judged('stuck', { mode: 'cpu', heartbeatPath }), timeoutMs: roundExhausted ? 2000 : 150 } },
          { ...plain, id: 'skipped', priority: 20, exclusiveGroup: 'stuck-group', judge: judged('skipped', { mode: 'throw' }) },
          { ...plain, id: 'suffix', priority: 10, judge: judged('suffix') },
        ] })
        const eventId = roundExhausted ? 'exhausted-round' : 'resumed-suffix'
        await runtime.submit(makeEvent(eventId))
        await runtime.drainPersistence('real-worker')
        const trace = readTrace(tracePath).filter(item => item.eventId === eventId)
        const starts = trace.filter(item => item.phase === 'start')
        assert.deepEqual(starts.map(item => item.label), roundExhausted ? ['prefix', 'stuck'] : ['prefix', 'stuck', 'suffix'])
        assert.equal(trace.filter(item => item.label === 'stuck').length, 1, 'the killed judge must never be replayed or report completion')
        assert.ok(existsSync(heartbeatPath), 'the interrupted judge must perform physical CPU work')
        const stoppedBeat = readFileSync(heartbeatPath, 'utf8')
        await delay(100)
        assert.equal(readFileSync(heartbeatPath, 'utf8'), stoppedBeat, 'settlement must follow actual thread exit')
        const snapshot = runtime.snapshot('real-worker')
        const persisted = await storage.readDisk('real-worker')
        const stuckDiagnostic = snapshot.diagnostics.find(item => item.ruleId === 'stuck')
        assert.ok(stuckDiagnostic)
        assert.equal(stuckDiagnostic.status, 'timed-out')
        assert.match(String(stuckDiagnostic.message), roundExhausted ? /reminder-round-timeout/ : /matcher-work-timeout/)
        const budget = z.object({ phase: z.literal('processing'), timeoutMs: z.number().positive() }).parse(stuckDiagnostic.diagnostic)
        if (roundExhausted) assert.ok(budget.timeoutMs < 300, 'the prefix consumes part of the real round allowance')
        else assert.equal(budget.timeoutMs, 150, 'diagnostics must report this rule budget, not the pool default')
        assert.deepEqual(snapshot.candidates.map(item => item.ruleId), roundExhausted ? ['prefix'] : ['prefix', 'suffix'])
        assert.deepEqual(persisted.candidates, snapshot.candidates, 'completed results must survive termination and reach real storage')
        assert.deepEqual(persisted.diagnostics, snapshot.diagnostics)
        if (roundExhausted) {
          assert.equal(snapshot.diagnostics.find(item => item.ruleId === 'suffix')?.status, 'not-evaluated')
        } else {
          const stuck = starts.find(item => item.label === 'stuck')
          const suffix = starts.find(item => item.label === 'suffix')
          assert.ok(stuck && suffix)
          assert.notEqual(suffix.threadId, stuck.threadId, 'the proven unstarted suffix runs on a replacement worker')
        }
        t.diagnostic(JSON.stringify({ roundExhausted, trace, diagnostics: snapshot.diagnostics, stats: matcher.getStats() }))
      } finally {
        await runtime.close()
        await storage.close()
      }
    })
}

test('real worker: malformed condition data cannot reach a judge through a type assertion',
  { timeout: 20000 }, async t => {
    const { matcher, tracePath, params } = await setup(t)
    const raw: unknown = { kind: 'always', unexpected: true }
    const rules = [
      { key: 'malformed', condition: raw, judge: detector, params: params('must-not-run'), timeoutMs: 2000 },
      { key: 'valid', condition, judge: detector, params: params('valid'), timeoutMs: 2000 },
    ]
    const result = BatchResult.parse(await matcher.detect({ reminderBatch: { event: makeEvent('invalid-condition'),
      maxBytes: 1_000_000, countLimits: limits, rules, budgetMs: 5000 } }, undefined, timing(2000)))
    const answers = result.items.map(item => BatchAnswer.parse(item))
    const malformed = answers.find(item => item.key === 'malformed')
    const valid = answers.find(item => item.key === 'valid')
    t.diagnostic(JSON.stringify({ answers, trace: readTrace(tracePath) }))
    assert.ok(malformed && 'error' in malformed, 'malformed structured-clone data must fail validation before judge execution')
    assert.ok(valid && 'match' in valid)
    assert.equal(MatchResult.parse(valid.match).status, 'matched')
    assert.deepEqual(readTrace(tracePath).filter(item => item.phase === 'start').map(item => item.label), ['valid'])
  })
