import { z } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'

const FORMAT = 'context-care/summary-proposal/v1'
const Evidence = z.object({ format: z.literal(FORMAT), proposalKey: z.string().min(1),
  failureCode: z.string().optional() }).strict()
const NO_USEFUL = new Set(['SUMMARY_NOT_SMALLER', 'SUMMARY_INPUT_BUDGET', 'SUMMARY_EMPTY'])
interface Projection {
  cursor: number
  inheritedEnd: number
  pending: Map<string, string>
  rejected: Set<string>
}
interface History {
  readSession(id: Session['id']): Promise<{ events: readonly SessionEvent[]; inheritedEventCount: number; length?: number;
    select?(types: readonly SessionEvent['type'][], fromSeq?: number): readonly SessionEvent[]; [Symbol.dispose]?(): void }>
}

/**
 * Attach actual proposal identity and an optional actual failure to compaction events.
 * This describes an executed compaction; it is never an independent state snapshot.
 * @param proposalKey - fingerprint of selected material, prices and summary policy.
 * @param failureCode - the summary execution's terminal code, when present.
 * @returns metadata for the real compaction/start or compaction/end append.
 */
export function summaryProposalRecord(proposalKey: unknown, failureCode?: unknown) {
  if (typeof proposalKey !== 'string' || !proposalKey.length) return {}
  return { contextCareSummary: { format: FORMAT, proposalKey,
    ...(typeof failureCode === 'string' ? { failureCode } : {}) } }
}

function initial(inheritedEnd: number): Projection {
  return { cursor: 0, inheritedEnd, pending: new Map(), rejected: new Set() }
}
function apply(state: Projection, event: SessionEvent) {
  if (event.seq < state.cursor) return
  if (event.seq < state.inheritedEnd || (event.type !== 'compaction/start' && event.type !== 'compaction/end')) {
    state.cursor = event.seq + 1
    return
  }
  const metadata = 'contextCareSummary' in event.data ? Evidence.parse(event.data.contextCareSummary) : undefined
  state.cursor = event.seq + 1
  if (event.type === 'compaction/start') {
    if (metadata) state.pending.set(event.data.compactionId, metadata.proposalKey)
    return
  }
  const key = state.pending.get(event.data.compactionId)
  state.pending.delete(event.data.compactionId)
  // A lone end, a cancelled attempt or a successful compaction proves no rejection.
  if (metadata && key === metadata.proposalKey && event.data.error !== undefined
    && metadata.failureCode !== undefined && NO_USEFUL.has(metadata.failureCode)) state.rejected.add(key)
}

/**
 * Reconstruct rejected proposals solely from paired native compaction executions.
 * @param history - the existing native Session query, without Agent activation.
 * @returns incremental live observation and cancellable reads with disposable caches.
 */
export function createSummaryProposalHistory(history: History) {
  let states = new WeakMap<Session, Projection>()
  let restoring = new WeakMap<Session, { task: Promise<Projection>; events: SessionEvent[] }>()
  let closed = false
  return {
    /** Follow actual commits; cold and mid-install Sessions restore on first read. */
    observe(session: Session, event: SessionEvent) {
      if (closed) return
      const active = restoring.get(session)
      if (active) { active.events.push(event); return }
      let state = states.get(session)
      if (!state && event.seq === 0) { state = initial(session.inheritedEventCount); states.set(session, state) }
      // A missed or invalid commit requires native replay; never jump its cursor.
      if (state?.cursor === event.seq) apply(state, event)
    },
    /** Read one exact proposal rejection; status-only log growth cannot clear it. */
    async has(session: Session, key: string, signal?: AbortSignal): Promise<boolean> {
      if (closed) throw new Error('context-care: summary proposal history closed')
      signal?.throwIfAborted()
      const cached = states.get(session)
      if (cached?.cursor === session.seq) return cached.rejected.has(key)
      let active = restoring.get(session)
      if (!active) {
        const queued: SessionEvent[] = []
        const task = (async () => {
          const log = await history.readSession(session.id)
          using lease = { [Symbol.dispose]: () => log[Symbol.dispose]?.() }
          if (closed) throw new Error('context-care: summary proposal history closed')
          const state = cached ?? initial(log.inheritedEventCount)
          const events = log.select?.(['compaction/start', 'compaction/end'], state.cursor) ?? log.events
          for (const event of events) apply(state, event)
          state.cursor = log.length ?? log.events.length
          for (const event of queued) apply(state, event)
          states.set(session, state)
          // Publish and leave restore mode in one synchronous cut. Commits queued
          // between task fulfillment and its readers must reach the live projection.
          restoring.delete(session)
          return state
        })()
        active = { task, events: queued }
        restoring.set(session, active)
        const release = () => { if (restoring.get(session) === active) restoring.delete(session) }
        // Contain this cleanup chain; each has() reader owns the original rejection.
        void task.then(release, release)
      }
      const state = await active.task
      signal?.throwIfAborted()
      return state.rejected.has(key)
    },
    /** Forget derived proposal state; the next owner reconstructs from the same log. */
    close() { closed = true; states = new WeakMap(); restoring = new WeakMap() },
  }
}
