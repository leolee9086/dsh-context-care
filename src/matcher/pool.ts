import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createProgress, readProgress, milliseconds, type ProgressSnapshot } from './progress.js'

export interface MatcherDiagnostic {
  operationId: string
  stage: string
  phase: 'admission' | 'startup' | 'processing'
  rules: { sourceId: string; ruleId: string; revision: unknown }[]
  inputBytes: number
  blockCount: number
  elapsedMs: number
  startupMs: number
  queueMs: number
  roundTripMs: number | null
  processingElapsedMs: number | null
  timeoutMs: number
  activeOperations: number
}
/** Checkpoint identifies the rule actually executing, never an inferred retry candidate. */
export interface InterruptedRule {
  index: number
  elapsedMs: number
  completedMs: number
  roundLimited: boolean
}
export class MatcherFailure extends Error {
  readonly code = 'CONTEXT_CARE_MATCH_FAILED'
  constructor(message: string, readonly diagnostic: MatcherDiagnostic, cause?: unknown,
    readonly checkpoint?: InterruptedRule) {
    super(message, { cause })
    this.name = 'MatcherFailure'
  }
}
export interface MatcherTiming {
  onDispatch?: () => void
  workTimeoutMs?: number
  onItem?: (item: unknown) => void
  /** Actual worker execution, excluding startup, queue residence and response transport. */
  onTiming?: (timing: { processingMs: number }) => void
}
export interface MatcherOptions {
  timeoutMs?: number
  startupMs?: number
  maxBytes?: number
  maxPending?: number
  maxIdle?: number
}
interface Task {
  id: string
  input: Record<string, unknown>
  inputBytes: number
  signal?: AbortSignal
  abort: () => void
  timing: MatcherTiming
  workTimeoutMs: number
  began: number
  dispatchedAt?: number
  phase: MatcherDiagnostic['phase']
  progress: SharedArrayBuffer
  timer?: ReturnType<typeof setTimeout>
  entry?: Entry
  cancelled: boolean
  settled: boolean
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}
interface Entry {
  worker: Worker
  createdAt: number
  readyAt?: number
  task?: Task
  stopping: boolean
  exited: boolean
  ready: Promise<void>
  finishReady: (error?: Error) => void
  timer?: ReturnType<typeof setTimeout>
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const errorOf = (value: unknown): Error => value instanceof Error ? value : new Error(String(value))

/**
 * The Host owns the queue. Each worker receives only its current task, so stopping
 * that thread cannot execute, cancel or consume another task's allowance.
 */
export function createBoundedMatcher({ timeoutMs = 250, startupMs = 10000, maxBytes = 4194304,
  maxPending = 256, maxIdle = 2 }: MatcherOptions = {}) {
  if (!Number.isInteger(maxPending) || maxPending < 1 || !Number.isInteger(maxIdle) || maxIdle < 1) {
    throw new RangeError('matcher-invalid-capacity')
  }
  const capacity = Math.min(maxIdle, maxPending)
  const entries = new Set<Entry>(), active = new Set<Task>(), queue: Task[] = []
  const terminating = new Set<Promise<void>>()
  let closed = false, warmed = false, pumping = false
  let workersStarted = 0, completed = 0, failed = 0
  let refillTimer: ReturnType<typeof setTimeout> | undefined
  let closing: Promise<void> | undefined

  function diagnostic(task: Task): MatcherDiagnostic {
    const progress = readProgress(task.progress)
    const processing = progress && progress.phase !== 'waiting'
      ? milliseconds(progress.spentNs + (progress.phase === 'running' ? process.hrtime.bigint() - progress.startedNs : 0n)) : null
    // A batch rule may use a smaller allowance than the pool default. Report
    // the same worker checkpoint budget which actually triggered supervision.
    const workLimit = progress && progress.limitNs > 0n ? milliseconds(progress.limitNs) : task.workTimeoutMs
    return { operationId: task.id, stage: typeof task.input.stage === 'string' ? task.input.stage : 'detector.reset', phase: task.phase,
      rules: Array.isArray(task.input.rules) ? task.input.rules.filter(record).map(rule => ({
        sourceId: typeof rule.sourceId === 'string' ? rule.sourceId : '', ruleId: typeof rule.id === 'string' ? rule.id : '', revision: rule.revision ?? null,
      })) : [], inputBytes: task.inputBytes, blockCount: Array.isArray(task.input.blocks) ? task.input.blocks.length : 0,
      elapsedMs: performance.now() - task.began,
      startupMs: task.entry ? (task.entry.readyAt ?? performance.now()) - task.entry.createdAt : 0,
      queueMs: (task.dispatchedAt ?? performance.now()) - task.began,
      roundTripMs: task.dispatchedAt === undefined ? null : performance.now() - task.dispatchedAt,
      processingElapsedMs: processing, timeoutMs: workLimit, activeOperations: active.size }
  }
  function failure(task: Task, error: unknown, checkpoint?: InterruptedRule): MatcherFailure {
    return error instanceof MatcherFailure ? error : new MatcherFailure(errorOf(error).message, diagnostic(task), error, checkpoint)
  }
  function settle(task: Task, error?: unknown, result?: unknown) {
    if (task.settled) return
    task.settled = true
    clearTimeout(task.timer)
    task.signal?.removeEventListener('abort', task.abort)
    active.delete(task)
    const index = queue.indexOf(task)
    if (index >= 0) queue.splice(index, 1)
    if (task.entry?.task === task) {
      task.entry.task = undefined
      if (!task.entry.stopping) task.entry.worker.unref()
    }
    try { task.timing.onTiming?.({ processingMs: diagnostic(task).processingElapsedMs ?? 0 }) }
    catch (callbackError) { error ??= callbackError }
    if (error === undefined) { completed++; task.resolve(result) }
    else { if (!task.cancelled) failed++; task.reject(error) }
    pump()
  }
  function scheduleRefill() {
    if (!warmed || closed || refillTimer || entries.size >= capacity) return
    refillTimer = setTimeout(() => {
      refillTimer = undefined
      if (closed) return
      while (entries.size < capacity) createEntry()
      pump()
    }, 1000)
    refillTimer.unref()
  }
  function stop(entry: Entry, error: unknown, checkpoint?: InterruptedRule): Promise<void> {
    if (entry.stopping) return Promise.resolve()
    entry.stopping = true
    clearTimeout(entry.timer)
    clearTimeout(entry.task?.timer)
    entry.finishReady(errorOf(error))
    // Keep the task attached through exit: Node delivers its queued messages before
    // 'exit', including checkpoints completed before the stuck rule was terminated.
    const exited = entry.exited ? Promise.resolve()
      : new Promise<void>(resolve => { entry.worker.once('exit', () => resolve()) })
    // A rejected termination request is not evidence that a thread stopped.
    // Only its real exit event releases the task and the worker's capacity.
    void entry.worker.terminate().catch(() => {})
    const stopping = exited.then(() => {
      entries.delete(entry)
      const task = entry.task
      if (task) {
        // The worker can advance between the supervisor's read and terminate().
        // Never reuse that earlier index to replay a successor which already began.
        const final = checkpoint ? readProgress(task.progress) : undefined
        const confirmed = final && final.index >= (checkpoint?.index ?? 0)
          && (final.phase === 'running' || final.phase === 'between') ? {
            index: final.index,
            elapsedMs: final.phase === 'running' ? milliseconds(process.hrtime.bigint() - final.startedNs) : 0,
            completedMs: milliseconds(final.spentNs), roundLimited: final.roundLimited,
          } : undefined
        const reason = confirmed && checkpoint && confirmed.index > checkpoint.index && final?.phase === 'running'
          ? new Error('matcher-rule-interrupted', { cause: error }) : error
        // An incomplete seqlock read is deliberately unconfirmed: no suffix retry.
        settle(task, failure(task, reason, confirmed))
      }
      pump()
      scheduleRefill()
    }).finally(() => { terminating.delete(stopping) })
    terminating.add(stopping)
    return stopping
  }
  function supervise(task: Task) {
    clearTimeout(task.timer)
    const entry = task.entry
    if (task.settled || !entry || entry.stopping) return
    const progress = readProgress(task.progress)
    let nextMs = 10
    if (progress?.phase === 'finished') return // result is in transit; it is not unfinished computation
    if (progress?.phase === 'running') {
      task.phase = 'processing'
      const elapsedNs = process.hrtime.bigint() - progress.startedNs
      const remaining = milliseconds(progress.limitNs - elapsedNs)
      if (remaining <= 0) {
        const checkpoint: InterruptedRule = { index: progress.index, elapsedMs: milliseconds(elapsedNs),
          completedMs: milliseconds(progress.spentNs), roundLimited: progress.roundLimited }
        void stop(entry, new Error(progress.roundLimited ? 'reminder-round-timeout' : 'matcher-work-timeout'), checkpoint)
        return
      }
      nextMs = Math.max(1, Math.ceil(remaining))
    } else if (progress?.phase === 'waiting' && task.dispatchedAt !== undefined) {
      const remaining = startupMs - (performance.now() - task.dispatchedAt)
      if (remaining <= 0) { void stop(entry, new Error('matcher-startup-timeout')); return }
      nextMs = Math.max(1, Math.min(10, remaining))
    }
    task.timer = setTimeout(() => supervise(task), nextMs)
    task.timer.unref()
  }
  function receive(entry: Entry, raw: unknown) {
    if (!record(raw)) return
    if (raw.ready === true) {
      if (entry.stopping) return
      entry.readyAt = performance.now()
      entry.finishReady()
      if (!entry.task) entry.worker.unref()
      pump()
      return
    }
    const task = entry.task
    if (!task || task.id !== raw.taskId || task.settled) return
    try {
      if ('item' in raw) { task.timing.onItem?.(raw.item); return }
      if (entry.stopping) return
      if (raw.started === true) {
        task.phase = 'processing'
        task.timing.onDispatch?.()
        supervise(task)
        return
      }
      if (record(raw.error) && typeof raw.error.message === 'string') {
        const error = new Error(raw.error.message)
        if (typeof raw.error.name === 'string') error.name = raw.error.name
        settle(task, failure(task, error))
      } else if ('result' in raw) settle(task, undefined, raw.result)
    } catch (error) { void stop(entry, error) }
  }
  function createEntry(): Entry {
    // A tiny JS adapter retains the existing detector engine boundary. All pool,
    // lifecycle, timing and reminder work is compiled TypeScript.
    const worker = new Worker(new URL('../../src/match-worker.js', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 }, execArgv: [],
    })
    workersStarted++
    let finish!: (error?: Error) => void
    let readySettled = false
    const ready = new Promise<void>((resolve, reject) => { finish = error => {
      if (readySettled) return
      readySettled = true
      clearTimeout(entry.timer)
      if (error) reject(error); else resolve()
    } })
    const entry: Entry = { worker, createdAt: performance.now(), stopping: false, exited: false, ready, finishReady: finish }
    // Readiness can fail before a warmup caller or queued task starts awaiting it.
    ready.catch(() => {})
    entries.add(entry)
    worker.on('message', (raw: unknown) => receive(entry, raw))
    worker.on('error', (error: Error) => {
      // Node module-loading failures happen before ready and have no timeout
      // marker. Keep the original cause while naming the failed startup phase.
      const reason = entry.readyAt === undefined
        ? new Error(`matcher-worker-startup-failed: ${error.message}`, { cause: error }) : error
      void stop(entry, reason)
    })
    worker.on('exit', code => {
      entry.exited = true
      if (!entry.stopping) void stop(entry, new Error(`matcher-worker-exited:${code}`))
    })
    entry.timer = setTimeout(() => { void stop(entry, new Error('matcher-startup-timeout')) }, startupMs)
    return entry
  }
  function dispatch(entry: Entry, task: Task) {
    if (task.dispatchedAt !== undefined || entry.readyAt === undefined || entry.stopping) return
    task.dispatchedAt = performance.now()
    entry.worker.ref()
    try {
      entry.worker.postMessage({ taskId: task.id, input: task.input, progress: task.progress, workTimeoutMs: task.workTimeoutMs })
      supervise(task)
    } catch (error) { void stop(entry, error) }
  }
  function pump() {
    if (closed || pumping) return
    pumping = true
    try {
      // Assignment is synchronous. Concurrent callers cannot observe and claim the
      // same idle entry during an await, nor send a task into a busy worker.
      for (const entry of entries) if (entry.task) dispatch(entry, entry.task)
      while (queue.length) {
        let entry = [...entries].find(item => !item.stopping && item.task === undefined)
        if (!entry && entries.size < capacity) entry = createEntry()
        if (!entry) break
        const task = queue.shift()
        if (!task || task.settled) continue
        entry.task = task
        task.entry = entry
        task.phase = entry.readyAt === undefined ? 'startup' : 'admission'
        dispatch(entry, task)
      }
    } finally { pumping = false }
  }
  async function detect(raw: unknown, signal?: AbortSignal, timing: MatcherTiming = {}): Promise<unknown> {
    if (closed) throw new Error('matcher-closed')
    if (signal?.aborted) throw signal.reason ?? new Error('matcher-cancelled')
    if (!record(raw)) throw new TypeError('matcher-input-must-be-object')
    let input = raw
    if (!input.detectorReset && Array.isArray(input.rules)) {
      const rules = input.rules.filter(rule => !record(rule) || !Array.isArray(rule.on) || rule.on.includes(input.stage))
      if (!rules.length) return input.detectorSpecifications ? { events: [], states: {} } : []
      input = { ...input, rules }
    }
    let resolve!: Task['resolve'], reject!: Task['reject']
    const answer = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
    answer.catch(() => {})
    const task: Task = { id: randomUUID(), input, inputBytes: Buffer.byteLength(JSON.stringify(input)), signal,
      timing, workTimeoutMs: timing.workTimeoutMs ?? timeoutMs, began: performance.now(), phase: 'admission',
      progress: createProgress(), cancelled: false, settled: false, resolve, reject, abort: () => {} }
    if (active.size >= maxPending) throw failure(task, new Error('matcher-capacity-exceeded'))
    if (task.inputBytes > maxBytes) throw failure(task, new Error('matcher-input-budget-exceeded'))
    if (!Number.isFinite(task.workTimeoutMs) || task.workTimeoutMs < 0) throw failure(task, new Error('matcher-invalid-budget'))
    task.abort = () => {
      task.cancelled = true
      const error: unknown = signal?.reason ?? new Error('matcher-cancelled')
      if (task.entry) void stop(task.entry, error)
      else settle(task, failure(task, error))
    }
    signal?.addEventListener('abort', task.abort, { once: true })
    active.add(task)
    queue.push(task)
    pump()
    if (signal?.aborted) task.abort()
    return answer
  }
  async function warmup(signal?: AbortSignal): Promise<void> {
    if (closed) throw new Error('matcher-closed')
    signal?.throwIfAborted()
    warmed = true
    while (entries.size < capacity) createEntry()
    const pending = [...entries].filter(entry => entry.readyAt === undefined)
    const abort = () => { for (const entry of pending) if (entry.readyAt === undefined) void stop(entry, signal?.reason ?? new Error('matcher-cancelled')) }
    signal?.addEventListener('abort', abort, { once: true })
    try { await Promise.all(pending.map(entry => entry.ready)) }
    finally { signal?.removeEventListener('abort', abort) }
  }
  function close(): Promise<void> {
    if (closing) return closing
    closed = true
    clearTimeout(refillTimer)
    for (const task of queue.splice(0)) { task.cancelled = true; settle(task, failure(task, new Error('matcher-closed'))) }
    for (const entry of entries) {
      if (entry.task) entry.task.cancelled = true
      void stop(entry, new Error('matcher-closed'))
    }
    closing = Promise.allSettled([...terminating]).then(() => {})
    return closing
  }
  return { detect, warmup, close,
    getStats() {
      return { active: active.size, idle: [...entries].filter(entry => entry.readyAt !== undefined && !entry.task && !entry.stopping).length,
        preparing: [...entries].filter(entry => entry.readyAt === undefined && !entry.stopping).length,
        threads: entries.size, workersStarted, completed, failed, closed }
    },
  }
}
