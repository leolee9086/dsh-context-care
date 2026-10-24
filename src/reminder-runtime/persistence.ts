/**
 * Persistence owns transactions, not a cache of snapshots to retry.
 *
 * A caller may stop waiting while a real write is still running. That does not cancel the
 * write, acknowledge its state, or permit a later transaction to overtake it. The session
 * lane survives until the write and its explicitly requested compensation have settled.
 */

export type PersistencePhase = 'queued' | 'preparing' | 'saving' | 'publishing' | 'compensating'

export interface PersistencePending {
  readonly sessionId: string
  readonly phase: PersistencePhase
  /** The caller received no result; the owned transaction may still have side effects. */
  readonly abandoned: boolean
}

/** A deadline describes observation, not an outcome from the storage backend. */
export class PersistenceTimeoutError extends Error {
  readonly code = 'CONTEXT_CARE_PERSISTENCE_TIMEOUT'

  constructor(
    readonly scope: 'transaction' | 'close',
    readonly sessionId: string | undefined,
    readonly outcome: 'not-started' | 'unknown',
  ) {
    super(scope === 'close' ? 'reminder-persistence-close-timeout' : 'reminder-storage-timeout')
    this.name = 'PersistenceTimeoutError'
  }
}

/**
 * Only native rename failures that prove replacement did not occur permit immediate release.
 * In particular, a generic rejection or fsync failure is NOT a negative commit ACK: a JSON
 * backend can reject while syncing the directory after an already successful rename.
 * Wrappers with a single `cause` retain the native evidence; aggregates do not prove which
 * side effect failed, and cycles are rejected conservatively.
 */
export function isDefiniteStorageFailure(error: unknown): boolean {
  const visited = new Set<Error>()
  const rejectedRenameCodes = new Set(['EPERM', 'EISDIR', 'EEXIST', 'ENOTEMPTY', 'EACCES',
    'ENOENT', 'ENOTDIR', 'EXDEV', 'EROFS', 'EBUSY'])
  let current: unknown = error
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof AggregateError) return false
    visited.add(current)
    if ('syscall' in current) {
      return current.syscall === 'rename' && 'code' in current
        && typeof current.code === 'string' && rejectedRenameCodes.has(current.code)
    }
    current = current.cause
  }
  return false
}

export interface PersistenceIO<State> {
  /**
   * Write and publish another state in this SAME owned transaction, without a new deadline.
   * Await this before releasing any external reservation. Do not enqueue another transaction
   * for the same session from a compensation callback: that would wait on itself.
   */
  persist(next: State): Promise<void>
}

export interface PersistenceTransaction<State, Value> {
  /** Runs inside the session lane, so reads see the preceding transaction's latest ACK. */
  prepare(): Promise<{ next: State; value: Value }>
  /**
   * A backend rejection is not universally proof of no commit (a post-rename fsync can fail).
   * Opt in only when this particular error proves the session write was not applied.
   * Preparation failures need no classifier: the session save has not been issued yet.
   */
  isDefiniteFailure?(error: unknown): boolean
  /** Release only this transaction's confirmed side effects after a definite failure. */
  onFailure?(error: unknown): Promise<void>
  /**
   * The session write ACKed, but the caller already timed out without receiving its value.
   * Collection can persist a rollback here, THEN release its shared claims. Ordinary state
   * updates need no hook: their late ACK is still valid. No implicit retry happens here.
   */
  onAbandoned?(value: Value, io: PersistenceIO<State>): Promise<void>
}

export interface PersistenceOptions<State> {
  save(sessionId: string, next: State): Promise<void>
  /** Synchronous publication after actual ACK. It must not throw or perform more I/O. */
  publish(sessionId: string, next: State): void
  timeoutMs(): number
  /** Receives real transaction failures even when the original caller has stopped waiting. */
  onError?(sessionId: string, error: unknown): void
}

export interface PersistenceOwner<State> {
  transact<Value>(sessionId: string, transaction: PersistenceTransaction<State, Value>): Promise<Value>
  /** Drain transactions owned at invocation, including their late compensation. No deadline. */
  drain(sessionId?: string): Promise<void>
  /** Stop accepting work; concurrent calls share a wait, later calls can await a recovered drain. */
  close(): Promise<void>
  pending(): readonly PersistencePending[]
}

interface Entry {
  readonly sessionId: string
  phase: PersistencePhase
  abandoned: boolean
  readonly done: Promise<void>
  start(): void
  cancelBeforeStart(): void
}

interface Lane {
  running: Entry | undefined
  readonly queued: Entry[]
}

/**
 * This owner cannot abort an uncancellable backend. close() reports that limitation with a
 * timeout and retains every in-flight entry. drain() is the separate real resource barrier;
 * a caller must not treat a timed-out close as permission to destroy the underlying store.
 */
export function createPersistenceOwner<State>(options: PersistenceOptions<State>): PersistenceOwner<State> {
  const lanes = new Map<string, Lane>()
  const owned = new Set<Entry>()
  // After an ambiguous backend rejection or failed publication, memory is not a safe
  // basis for another full-state write. Stop that session until authoritative reload.
  const uncertainSessions = new Map<string, unknown>()
  let closed = false
  let closing: Promise<void> | undefined

  function deadline(): number {
    const value = options.timeoutMs()
    if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
      throw new RangeError('reminder-persistence-invalid-timeout')
    }
    return value
  }

  /** A reporting failure must not detach the original transaction from its owner. */
  function report(sessionId: string, error: unknown): unknown {
    try { options.onError?.(sessionId, error); return error }
    catch (reportError) { return new AggregateError([error, reportError], 'reminder-persistence-report-failed') }
  }

  function startNext(sessionId: string, lane: Lane): void {
    if (lane.running) return
    const entry = lane.queued.shift()
    if (!entry) {
      if (lanes.get(sessionId) === lane) lanes.delete(sessionId)
      return
    }
    lane.running = entry
    entry.start()
  }

  function release(entry: Entry, lane: Lane): void {
    owned.delete(entry)
    if (lane.running === entry) lane.running = undefined
    else {
      const index = lane.queued.indexOf(entry)
      if (index >= 0) lane.queued.splice(index, 1)
    }
    startNext(entry.sessionId, lane)
  }

  async function drain(sessionId?: string): Promise<void> {
    const entries = [...owned].filter(entry => sessionId === undefined || entry.sessionId === sessionId)
    // allSettled is deliberate: one rejected write must not let drain finish while another
    // real write or compensation is still using the backend.
    const results = await Promise.allSettled(entries.map(entry => entry.done))
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length) throw new AggregateError(errors, 'reminder-persistence-drain-failed')
  }

  function transact<Value>(sessionId: string, transaction: PersistenceTransaction<State, Value>): Promise<Value> {
    if (closed) return Promise.reject(new Error('reminder-persistence-closed'))
    if (uncertainSessions.has(sessionId)) return Promise.reject(uncertainSessions.get(sessionId))
    let waitMs: number
    try { waitMs = deadline() }
    catch (error) { return Promise.reject(error) }
    const lane = lanes.get(sessionId) ?? { running: undefined, queued: [] }
    lanes.set(sessionId, lane)
    let resolveWait!: (value: Value) => void
    let rejectWait!: (error: unknown) => void
    let resolveDone!: () => void
    let rejectDone!: (error: unknown) => void
    const waiting = new Promise<Value>((resolve, reject) => { resolveWait = resolve; rejectWait = reject })
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
    // The caller owns `waiting`; this owner also observes late failures on the actual task.
    // `done` keeps its rejection for drain(), even after its caller timed out.
    void done.catch(() => {})
    let waiterFinished = false
    let timer: ReturnType<typeof setTimeout>

    function rejectCaller(error: unknown): void {
      if (waiterFinished) return
      waiterFinished = true
      clearTimeout(timer)
      rejectWait(error)
    }

    async function persist(next: State): Promise<void> {
      try { await options.save(sessionId, next) }
      catch (error) {
        if (transaction.isDefiniteFailure?.(error) !== true) uncertainSessions.set(sessionId, error)
        throw error
      }
      try { options.publish(sessionId, next) }
      catch (error) {
        uncertainSessions.set(sessionId, error)
        throw error
      }
    }

    async function execute(): Promise<void> {
      try {
        if (uncertainSessions.has(sessionId)) throw uncertainSessions.get(sessionId)
        entry.phase = 'preparing'
        const prepared = await transaction.prepare()
        entry.phase = 'saving'
        await options.save(sessionId, prepared.next)
        entry.phase = 'publishing'
        try { options.publish(sessionId, prepared.next) }
        catch (error) {
          uncertainSessions.set(sessionId, error)
          throw error
        }
        if (entry.abandoned) {
          entry.phase = 'compensating'
          await transaction.onAbandoned?.(prepared.value, { persist })
        } else {
          // Publication and result delivery are synchronous within this turn; a timer cannot
          // interleave and accidentally trigger both delivery and abandonment compensation.
          waiterFinished = true
          clearTimeout(timer)
          resolveWait(prepared.value)
        }
        resolveDone()
      } catch (error) {
        let failure: unknown = error
        try {
          const definite = entry.phase === 'preparing'
            || (entry.phase === 'saving' && transaction.isDefiniteFailure?.(error) === true)
          if (entry.phase === 'saving' && !definite) uncertainSessions.set(sessionId, error)
          if (definite && transaction.onFailure) {
            entry.phase = 'compensating'
            await transaction.onFailure(error)
          }
        } catch (compensationError) {
          failure = new AggregateError([error, compensationError], 'reminder-persistence-compensation-failed')
        }
        failure = report(sessionId, failure)
        rejectCaller(failure)
        rejectDone(failure)
      } finally {
        clearTimeout(timer)
        release(entry, lane)
      }
    }

    const entry: Entry = {
      sessionId, phase: 'queued', abandoned: false, done,
      start() { void execute() },
      cancelBeforeStart() {
        // Remove expired queued work instead of attaching another .then() to a potentially
        // permanent write. No snapshot/closure pile-up can survive after these callers expire.
        resolveDone()
        release(entry, lane)
      },
    }
    timer = setTimeout(() => {
      if (waiterFinished) return
      entry.abandoned = true
      const notStarted = entry.phase === 'queued'
      rejectCaller(new PersistenceTimeoutError('transaction', sessionId, notStarted ? 'not-started' : 'unknown'))
      if (notStarted) entry.cancelBeforeStart()
    }, waitMs)
    owned.add(entry)
    lane.queued.push(entry)
    startNext(sessionId, lane)
    return waiting
  }

  function close(): Promise<void> {
    if (closing) return closing
    closed = true
    const attempt = (async () => {
      const waitMs = deadline()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          drain(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new PersistenceTimeoutError('close', undefined, 'unknown')), waitMs)
          }),
        ])
      } finally { clearTimeout(timer) }
    })()
    closing = attempt
    const finishAttempt = () => { if (closing === attempt) closing = undefined }
    // Concurrent callers share this wait. Once it settles, a later call can wait again for
    // real recovery; it must not be stuck forever with an earlier observation timeout.
    void attempt.then(finishAttempt, finishAttempt)
    return attempt
  }

  return {
    transact, drain, close,
    pending: () => [...owned].map(entry => ({ sessionId: entry.sessionId, phase: entry.phase, abandoned: entry.abandoned })),
  }
}
