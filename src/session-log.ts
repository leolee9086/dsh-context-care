import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'

type Observation = Awaited<ReturnType<Context['sessionQuery']['observeSession']>>
type Kind = SessionEvent['type']
interface Index { ranges: { from: number; end: number }[]; byType: Map<Kind, SessionEvent[]>;
  events: Map<number, SessionEvent>; prepared?: Session;
  latest: Map<Kind, { through: number; event?: SessionEvent }> }
interface Pending { controller: AbortController; task: Promise<Observation>; readers: number; observation?: Observation }

/** One immutable log cut. Range readers never materialize the complete event array. */
export interface SessionLogRead extends Disposable {
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly length: number
  /** Compatibility for consumers that genuinely need an entire accepted log. */
  readonly events: readonly SessionEvent[]
  at(seq: number): SessionEvent | undefined
  last(type: Kind, beforeSeq?: number): SessionEvent | undefined
  range(fromSeq: number, toSeqExclusive?: number): Iterable<SessionEvent>
  /** Shared type index; an explicit fromSeq uses only that range, not the old prefix. */
  select(types: readonly Kind[], fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[]
  /** Reuse the same native prepared Session instead of rebuilding it per consumer. */
  prepare(): Session
}

/** Public capabilities shared by this plugin's log consumers. */
export interface SessionLog {
  read(id: SessionId, signal?: AbortSignal): Promise<SessionLogRead>
  live(session: Session): SessionLogRead
  withLive<T>(session: Session, reader: (log: SessionLogRead) => T): T
  listSessions(signal?: AbortSignal): Promise<readonly { header: SessionHeader }[]>
  close(): void
}

/**
 * Read only the current surface tail through native message projections. One
 * extra message preserves requestContext's truncation indicator without copying
 * the complete derived transcript. The current result may be excluded by ID.
 */
export function sessionMessageTail(session: Session, maxMessages: number, excludeMessageId?: string): ReturnType<Session['deriveMessages']> {
  const messages: ReturnType<Session['deriveMessages']> = []
  const nodes = session.surface.nodes
  for (let index = nodes.length - 1; index >= 0 && messages.length <= maxMessages; index--) {
    const event = session.eventAt(nodes[index])
    if (!event) throw new Error('context-care-session-surface-event-missing')
    const message = session.deriveEventMessage(event)
    if (message && message.id !== excludeMessageId) messages.unshift(message)
  }
  return messages
}

/** Host-owned access to native immutable logs; no reminder or delivery state lives here. */
export function createSessionLog(ctx: Context): SessionLog {
  const liveIndexes = new WeakMap<Session, Index>()
  const coldIndexes = new WeakMap<readonly SessionEvent[], Index>()
  const pending = new Map<SessionId, Pending>()
  let closed = false

  function indexFor<K extends object>(map: WeakMap<K, Index>, key: K): Index {
    let index = map.get(key)
    if (!index) { index = { ranges: [], events: new Map(), byType: new Map(), latest: new Map() }; map.set(key, index) }
    return index
  }
  function view(header: SessionHeader, inheritedEventCount: number, length: number,
    at: (seq: number) => SessionEvent | undefined, snapshot: () => readonly SessionEvent[],
    index: Index, prepare: () => Session, release: () => void): SessionLogRead {
    let disposed = false
    const active = () => { if (closed || disposed) throw new Error('context-care-session-log-closed') }
    const get = (seq: number) => {
      active()
      if (seq < 0 || seq >= length) return undefined
      let event = index.events.get(seq)
      if (!event) {
        event = at(seq)
        if (!event) throw new Error(`context-care-session-log-event-missing: ${header.id}:${seq}`)
        index.events.set(seq, event)
      }
      return event
    }
    const lowerBound = (events: readonly SessionEvent[], seq: number) => {
      let left = 0, right = events.length
      while (left < right) {
        const middle = Math.floor((left + right) / 2)
        if (events[middle].seq < seq) left = middle + 1
        else right = middle
      }
      return left
    }
    function* range(fromSeq: number, toSeqExclusive = length): Iterable<SessionEvent> {
      for (let seq = Math.max(0, fromSeq); seq < Math.min(length, toSeqExclusive); seq++) {
        const event = get(seq)
        if (!event) throw new Error(`context-care-session-log-event-missing: ${header.id}:${seq}`)
        yield event
      }
    }
    return { header, inheritedEventCount, length,
      get events() { active(); return snapshot() }, at: get, range,
      last(type, beforeSeq = length) {
        active()
        const end = Math.min(length, beforeSeq), cached = index.latest.get(type)
        if (cached && cached.through >= end && (!cached.event || cached.event.seq < end)) return cached.event
        const floor = cached && cached.through <= end ? cached.through : 0
        const covering = index.ranges.find(span => span.from <= floor && span.end >= end)
        if (covering) {
          const events = index.byType.get(type) ?? [], position = lowerBound(events, end) - 1
          const indexed = position >= 0 ? events[position] : undefined
          const previous = cached && cached.through <= end ? cached.event : undefined
          const event = previous && (!indexed || previous.seq > indexed.seq) ? previous : indexed
          if (end === length) index.latest.set(type, { through: end, event })
          return event
        }
        for (let seq = end - 1; seq >= floor; seq--) {
          const event = get(seq)
          if (event?.type !== type) continue
          if (end === length) index.latest.set(type, { through: end, event })
          return event
        }
        const event = cached && cached.through <= end ? cached.event : undefined
        if (end === length) index.latest.set(type, { through: end, event })
        return event
      },
      select(types, fromSeq = 0, toSeqExclusive = length) {
        active()
        const from = Math.max(0, fromSeq), end = Math.min(length, toSeqExclusive)
        if (from >= end) return []
        // Each consumer asks for its own interval. Index only uncovered gaps; a
        // tail receipt query must never force reading the unrelated old prefix.
        const additions = new Map<Kind, SessionEvent[]>()
        const scan = (start: number, stop: number) => {
          for (const event of range(start, stop)) {
            let list = additions.get(event.type)
            if (!list) { list = []; additions.set(event.type, list) }
            list.push(event)
          }
        }
        let cursor = from
        for (const covered of index.ranges) {
          if (covered.end <= cursor) continue
          if (covered.from >= end) break
          if (covered.from > cursor) scan(cursor, covered.from)
          cursor = Math.max(cursor, covered.end)
          if (cursor >= end) break
        }
        if (cursor < end) scan(cursor, end)
        for (const [type, added] of additions) {
          const previous = index.byType.get(type)
          if (!previous) index.byType.set(type, added)
          else if (previous[previous.length - 1].seq < added[0].seq) {
            for (const event of added) previous.push(event)
          } else index.byType.set(type, previous.concat(added).sort((a, b) => a.seq - b.seq))
        }
        const merged: Index['ranges'] = []
        for (const span of [...index.ranges, { from, end }].sort((a, b) => a.from - b.from)) {
          const previous = merged[merged.length - 1]
          if (previous && span.from <= previous.end) previous.end = Math.max(previous.end, span.end)
          else merged.push({ ...span })
        }
        index.ranges = merged
        return [...new Set(types)].flatMap(type => {
          const events = index.byType.get(type) ?? []
          return events.slice(lowerBound(events, from), lowerBound(events, end))
        }).sort((a, b) => a.seq - b.seq)
      },
      prepare() { active(); return index.prepared ??= prepare() },
      [Symbol.dispose]() { if (!disposed) { disposed = true; release() } },
    }
  }
  function live(session: Session): SessionLogRead {
    if (closed) throw new Error('context-care-session-log-closed')
    const length = session.seq
    return view(session.header, session.inheritedEventCount, length, seq => session.eventAt(seq as SessionEvent['seq']),
      () => session.snapshotEvents(undefined, length), indexFor(liveIndexes, session), () => session, () => {})
  }
  function release(id: SessionId, entry: Pending) {
    entry.readers--
    if (entry.readers !== 0) return
    if (pending.get(id) === entry) pending.delete(id)
    if (entry.observation) entry.observation[Symbol.dispose]()
    else entry.controller.abort(new Error('context-care-session-log-no-readers'))
  }
  async function read(id: SessionId, signal?: AbortSignal): Promise<SessionLogRead> {
    signal?.throwIfAborted()
    if (closed) throw new Error('context-care-session-log-closed')
    const session = ctx.sessions.get(id)
    if (session) return live(session)
    let entry = pending.get(id)
    if (!entry) {
      const query = ctx.get('sessionQuery')
      if (!query) throw new Error('context-care-session-history-unavailable')
      const controller = new AbortController()
      const task = query.observeSession(id, { projectionMode: 'none', signal: controller.signal })
      entry = { task, controller, readers: 0 }
      pending.set(id, entry)
      const owner = entry
      // The native reader owns revision checking and its bounded cold cache.
      // This module merges simultaneous consumers, not indefinitely stale cuts.
      void task.then(observation => {
        owner.observation = observation
        if (pending.get(id) === owner) pending.delete(id)
        if (owner.readers === 0) observation[Symbol.dispose]()
      }, () => { if (pending.get(id) === owner) pending.delete(id) })
    }
    const owner = entry
    owner.readers++
    let abort: (() => void) | undefined
    try {
      const observation = signal ? await Promise.race([owner.task, new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })]) : await owner.task
      signal?.throwIfAborted()
      if (closed) throw new Error('context-care-session-log-closed')
      const attached = ctx.sessions.get(id)
      if (attached) { release(id, owner); return live(attached) }
      const events = observation.events
      return view(observation.header, observation.inheritedEventCount, observation.cursor + 1,
        seq => events[seq], () => events, indexFor(coldIndexes, events),
        () => ctx.sessions.prepare(id, { seed: [...events], meta: observation.header,
          inheritedEventCount: observation.inheritedEventCount, eventState: 'shared-frozen' }), () => release(id, owner))
    } catch (error) { release(id, owner); throw error }
    finally { if (abort) signal?.removeEventListener('abort', abort) }
  }
  return { read, live,
    withLive<T>(session: Session, reader: (log: SessionLogRead) => T): T { using log = live(session); return reader(log) },
    async listSessions(signal?: AbortSignal) {
      if (closed) throw new Error('context-care-session-log-closed')
      const query = ctx.get('sessionQuery')
      if (!query) throw new Error('context-care-session-history-unavailable')
      return query.listSessions(signal)
    },
    close() {
      if (closed) return
      closed = true
      for (const entry of pending.values()) entry.controller.abort(new Error('context-care-session-log-closed'))
      // Existing leases release their observations exactly once when readers exit.
      pending.clear()
    },
  }
}

declare module '@deepseek-ai/cordis' { interface Context { contextCareSessionLog: SessionLog } }

/** One service per Host composition, shared by requests, reminders and diagnostics. */
export function ensureSessionLog(ctx: Context): SessionLog {
  // The synchronous service is usable during its owner's async initialization.
  const current = ctx.get('contextCareSessionLog', false)
  if (current) return current
  const log = createSessionLog(ctx)
  ctx.provide('contextCareSessionLog', log)
  ctx.effect(() => () => log.close())
  return log
}
