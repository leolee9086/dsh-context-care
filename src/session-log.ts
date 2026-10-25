import { randomUUID } from 'node:crypto'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createSessionCache, type CacheKey, type SessionCache } from './session-cache.js'

type Observation = Awaited<ReturnType<Context['sessionQuery']['observeSession']>>
type Kind = SessionEvent['type']
type Message = ReturnType<Session['deriveMessages']>[number]
export interface SurfaceEntry { event: SessionEvent; turnId: string }
export interface MessageOrigin extends SurfaceEntry { message: Message }
/** A fixed cut over append-only derived values, without copying its prefix. */
export interface IndexedProjection<T> {
  readonly length: number
  at(index: number): T | undefined
  slice(from?: number, to?: number): readonly T[]
}
interface HistoryProjection { through: number; turnId: string; values: unknown[]; ends: { seq: number; end: number }[] }
interface SurfaceProjection { generation: number; through: number; entries: readonly SurfaceEntry[]; values: unknown[]; snapshot?: readonly unknown[];
  byEvent: WeakMap<SessionEvent, readonly unknown[]> }
interface OriginLookup {
  through: number; last?: MessageOrigin
  byId: Map<string, { index: number; value: MessageOrigin }[]>
  system?: MessageOrigin
  snapshot?: { messages: readonly MessageOrigin[]; byId: Pick<ReadonlyMap<string, MessageOrigin>, 'get'>; system?: MessageOrigin }
}
interface SurfaceIndex { generation: number; through: number; logThrough: number; entries: SurfaceEntry[];
  messages?: { origins: readonly MessageOrigin[]; values: readonly Message[] };
  chronological: SurfaceEntry[];
  byType: Map<Kind, { values: SessionEvent[]; snapshot?: IndexedProjection<SessionEvent> }>;
  projections: Map<object, SurfaceProjection>; origins?: OriginLookup }
interface Index { ranges: { from: number; end: number }[]; byType: Map<Kind, SessionEvent[]>;
  events: Map<number, SessionEvent>; accepted?: readonly SessionEvent[]; prepared?: Session;
  snapshot?: { length: number; events: Promise<readonly SessionEvent[]> };
  latest: Map<string, { through: number; event?: SessionEvent }> }
interface OwnedSession {
  index: Index
  surface?: SurfaceIndex
  histories: Map<object, HistoryProjection>
  historical?: { before: number; session: Session }
  messages?: { generation: number; values: Map<number, Message | undefined> }
  tools?: { through: number; value: ReturnType<Session['toolHistory']> }
}
interface Pending { controller: AbortController; task: Promise<Observation>; readers: number; observation?: Observation }
interface PrefixState {
  events: SessionEvent[]
  nodes: SessionEvent['seq'][]
  messages: Map<SessionEvent['seq'], Message>
  calls: Map<string, Extract<SessionEvent, { type: 'tool/call' }>>
  used: Set<Context['sessions']['messageProjections'][number]>
  native?: Session
  lane: Promise<unknown>
  older?: PrefixState
}
export interface HistoricalContext {
  readonly messages: readonly Message[]
  readonly call?: Extract<SessionEvent, { type: 'tool/call' }>
}

/** One immutable log cut. Range readers never materialize the complete event array. */
export interface SessionLogRead extends Disposable {
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  /** Cache owner only; consumers must not inspect it or retain the lease through it. */
  readonly owner: object
  readonly length: number
  /** Explicit historical reconstruction only; ordinary consumers use indexed ranges. */
  all(signal?: AbortSignal): Promise<readonly SessionEvent[]>
  at(seq: number): SessionEvent | undefined
  last(type: Kind | readonly Kind[], beforeSeq?: number): SessionEvent | undefined
  range(fromSeq: number, toSeqExclusive?: number): Iterable<SessionEvent>
  /** Shared type index; an explicit fromSeq uses only that range, not the old prefix. */
  select(types: readonly Kind[], fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[]
  /** Reuse the same native prepared Session instead of rebuilding it per consumer. */
  prepare(): Session
}

/** Public capabilities shared by this plugin's log consumers. */
export interface SessionLog {
  readonly cache: SessionCache
  read(id: SessionId, signal?: AbortSignal): Promise<SessionLogRead>
  live(session: Session): SessionLogRead
  /** Current surface order, indexed once for each native event type. */
  surfaceEvents(session: Session, type: Kind): IndexedProjection<SessionEvent>
  lastSurface(session: Session, type: Kind): SessionEvent | undefined
  /** Interpret one original native event once per content generation. */
  messageAt(session: Session, seq: number): Message | undefined
  /** Bounded current tail plus one extra message to preserve truncation evidence. */
  tail(session: Session, maxMessages: number, excludeMessageId?: string): readonly Message[]
  /** Restore only the prefix before the requested terminal; serialized readers share its native fold. */
  contextBefore(log: Pick<SessionLogRead, 'owner' | 'at'>, terminal: SessionEvent, maxMessages: number, signal?: AbortSignal): Promise<HistoricalContext>
  /**
   * Borrow cached readonly values. Each key owns one projection and result type.
   * Raw values follow event order; projected values follow native surface order
   * and invalidate on contentGeneration. Consumers must not mutate returned data.
   */
  projectSurface<T>(session: Session, key: object, project: (entry: SurfaceEntry) => readonly T[], projected?: boolean): readonly T[]
  /** Project selected immutable events once; older cuts reuse the indexed prefix. */
  projectHistory<T>(session: Session, key: object, types: readonly Kind[], project: (entry: SurfaceEntry) => readonly T[], beforeSeq?: number): IndexedProjection<T>
  /** Prepare one bounded native historical cut; the last cut is reusable. */
  historical(session: Session, beforeSeq: number): Session
  /** Borrow the native immutable tool-history fold; repeated unchanged cuts do no work. */
  tools(session: Session): ReturnType<Session['toolHistory']>
  messages(session: Session): readonly Message[]
  origins(session: Session): { byId: Pick<ReadonlyMap<string, MessageOrigin>, 'get'>; system?: MessageOrigin }
  withLive<T>(session: Session, reader: (log: SessionLogRead) => T): T
  listSessions(signal?: AbortSignal): Promise<readonly { header: SessionHeader }[]>
  close(): void
}

/** Host-owned access to native immutable logs; no reminder or delivery state lives here. */
export function createSessionLog(ctx: Context): SessionLog {
  const cache = createSessionCache(), messageKey = {}
  const emptyIndex = (): Index => ({ ranges: [], events: new Map(), byType: new Map(), latest: new Map() })
  const sessionKey: CacheKey<Session, OwnedSession> = { name: 'session-log',
    validity: 'Exact native Session identity; append cursors, replacement and content generations are tracked within its projections.',
    create: () => ({ index: emptyIndex(), histories: new Map() }) }
  const coldKey: CacheKey<readonly SessionEvent[], Index> = { name: 'cold-log',
    validity: 'Immutable observation array identity after native persistence revision validation.', create: emptyIndex }
  const owned = (session: Session) => cache.use(session, sessionKey)
  const pending = new Map<SessionId, Pending>()
  let closed = false
  const stopDisposed = ctx.on('session/disposed', session => cache.release(session))
  function view(header: SessionHeader, inheritedEventCount: number, length: number,
    at: (seq: number) => SessionEvent | undefined, snapshot: () => Promise<readonly SessionEvent[]>,
    index: Index, owner: object, prepare: () => Session, release: () => void): SessionLogRead {
    let disposed = false
    let fullSnapshot: Promise<readonly SessionEvent[]> | undefined
    const active = () => { if (closed || disposed) throw new Error('context-care-session-log-closed') }
    const complete = async (signal?: AbortSignal) => {
      active(); signal?.throwIfAborted()
      if (!fullSnapshot) {
        const task = index.snapshot?.length === length ? index.snapshot.events : snapshot()
        fullSnapshot = task
        if (!index.snapshot || index.snapshot.length <= length) index.snapshot = { length, events: task }
        // Failed reads must not poison later attempts at the same cut.
        void task.catch(() => {
          if (fullSnapshot === task) fullSnapshot = undefined
          if (index.snapshot?.events === task) index.snapshot = undefined
        })
      }
      let abort: (() => void) | undefined
      try {
        const events = signal ? await Promise.race([fullSnapshot, new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })]) : await fullSnapshot
        active(); signal?.throwIfAborted()
        if (!index.accepted || index.accepted.length < events.length) index.accepted = events
        return events
      } finally { if (abort) signal?.removeEventListener('abort', abort) }
    }
    const get = (seq: number) => {
      active()
      if (seq < 0 || seq >= length) return undefined
      let event = index.events.get(seq)
      if (!event) {
        event = index.accepted?.[seq] ?? at(seq)
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
    return { header, inheritedEventCount, owner, length,
      all: complete, at: get, range,
      last(type, beforeSeq = length) {
        active()
        const types = typeof type === 'string' ? [type] : [...new Set(type)].sort()
        const key = types.join('|'), end = Math.min(length, beforeSeq), cached = index.latest.get(key)
        if (cached && cached.through >= end && (!cached.event || cached.event.seq < end)) return cached.event
        const floor = cached && cached.through <= end ? cached.through : 0
        const covering = index.ranges.find(span => span.from <= floor && span.end >= end)
        if (covering) {
          let event = cached && cached.through <= end ? cached.event : undefined
          for (const kind of types) {
            const events = index.byType.get(kind) ?? [], position = lowerBound(events, end) - 1
            const indexed = position >= 0 ? events[position] : undefined
            if (indexed && (!event || indexed.seq > event.seq)) event = indexed
          }
          if (end === length) index.latest.set(key, { through: end, event })
          return event
        }
        for (let seq = end - 1; seq >= floor; seq--) {
          const event = get(seq)
          if (!event || !types.includes(event.type)) continue
          if (end === length) index.latest.set(key, { through: end, event })
          return event
        }
        const event = cached && cached.through <= end ? cached.event : undefined
        if (end === length) index.latest.set(key, { through: end, event })
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
      async () => {
        const query = ctx.get('sessionQuery')
        if (!query) throw new Error('context-care-session-history-unavailable')
        if (ctx.sessions.get(session.id) !== session) throw new Error('context-care-session-history-detached')
        using observation = await query.observeSession(session.id, { projectionMode: 'none' })
        if (observation.source !== 'live' || observation.header !== session.header || observation.cursor + 1 < length) {
          throw new Error('context-care-session-history-cut-changed')
        }
        const events = observation.events
        return events.length === length ? events : Object.freeze(events.slice(0, length))
      }, owned(session).index, session, () => session, () => {})
  }
  function historical(session: Session, beforeSeq: number): Session {
    if (closed) throw new Error('context-care-session-log-closed')
    if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0 || beforeSeq > session.seq) throw new Error('context-care-session-history-cut-invalid')
    const state = owned(session), cached = state.historical
    if (cached?.before === beforeSeq) {
      // Native projection interpreters can be disposed without a log append.
      void cached.session.surface.contentGeneration
      return cached.session
    }
    using log = live(session)
    const seed = [...log.range(0, beforeSeq)]
    const id = `context-care-history-${randomUUID()}` as SessionId
    const prepared = ctx.sessions.prepare(id, { seed, meta: { ...session.header, id },
      inheritedEventCount: Math.min(session.inheritedEventCount, beforeSeq) as Session['inheritedEventCount'], eventState: 'shared-frozen' })
    const index = owned(prepared).index
    index.ranges = [{ from: 0, end: beforeSeq }]
    for (const event of seed) {
      index.events.set(event.seq, event)
      let bucket = index.byType.get(event.type)
      if (!bucket) { bucket = []; index.byType.set(event.type, bucket) }
      bucket.push(event)
    }
    state.historical = { before: beforeSeq, session: prepared }
    return prepared
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
        seq => events[seq], async () => events, cache.use(events, coldKey), events,
        () => ctx.sessions.prepare(id, { seed: [...events], meta: observation.header,
          inheritedEventCount: observation.inheritedEventCount, eventState: 'shared-frozen' }), () => release(id, owner))
    } catch (error) { release(id, owner); throw error }
    finally { if (abort) signal?.removeEventListener('abort', abort) }
  }
  function surfaceState(session: Session): SurfaceIndex {
    if (closed) throw new Error('context-care-session-log-closed')
    const nodes = session.surface.nodes, generation = session.surface.replaceGeneration
    const owner = owned(session)
    const state: SurfaceIndex = owner.surface ??= { generation, through: 0, logThrough: 0, entries: [], chronological: [], byType: new Map(), projections: new Map() }
    const replaced = state.generation !== generation
    if (replaced) {
      state.generation = generation; state.through = 0; state.entries = []; state.chronological = []; state.byType.clear()
    }
    if (state.through !== nodes.length) {
      using log = live(session)
      // Build the shared type index only for new log positions. last() can then
      // assign each surface entry its turn by indexed lookup instead of a scan.
      log.select(['turn/start'], state.logThrough)
      state.logThrough = log.length
      for (let index = state.through; index < nodes.length; index++) {
        const event = log.at(nodes[index])
        if (!event) throw new Error('context-care-session-surface-event-missing')
        const turn = log.last('turn/start', event.seq + 1)
        const turnId = turn?.type === 'turn/start'
          ? String(session.id) + ':turn:' + (turn.data.turn ?? turn.seq) : String(session.id) + ':seed'
        const entry = { event, turnId }
        state.entries.push(entry); state.chronological.push(entry)
        let bucket = state.byType.get(event.type)
        if (!bucket) { bucket = { values: [] }; state.byType.set(event.type, bucket) }
        bucket.values.push(event); bucket.snapshot = undefined
      }
      if (replaced || state.through === 0) state.chronological.sort((a, b) => a.event.seq - b.event.seq)
      state.through = nodes.length
    }
    return state
  }
  const noSurfaceEvents: IndexedProjection<SessionEvent> = { length: 0, at: () => undefined, slice: () => [] }
  function surfaceEvents(session: Session, type: Kind): IndexedProjection<SessionEvent> {
    const bucket = surfaceState(session).byType.get(type)
    if (!bucket) return noSurfaceEvents
    if (!bucket.snapshot) {
      const values = bucket.values, length = values.length
      bucket.snapshot = { length, at: index => index >= 0 && index < length ? values[index] : undefined,
        slice: (from = 0, to = length) => values.slice(Math.max(0, from), Math.min(length, to)) }
    }
    return bucket.snapshot
  }
  function lastSurface(session: Session, type: Kind): SessionEvent | undefined {
    return surfaceState(session).byType.get(type)?.values.at(-1)
  }
  function projectSurface<T>(session: Session, key: object, project: (entry: SurfaceEntry) => readonly T[], projected = false): readonly T[] {
    const state = surfaceState(session)
    const generation = projected ? session.surface.contentGeneration : -1
    const entries = projected ? state.entries : state.chronological
    let cached = state.projections.get(key)
    if (!cached || cached.generation !== generation) {
      cached = { generation, through: 0, entries, values: [], byEvent: new WeakMap() }
      state.projections.set(key, cached)
    }
    // A replacement changes positions, not immutable original-event blocks.
    // The entries array identity distinguishes a rebuild from pure tail growth.
    if (cached.entries !== entries) {
      cached.entries = entries; cached.values = []; cached.through = 0; cached.snapshot = undefined
    }
    try {
      for (let index = cached.through; index < entries.length; index++) {
        const entry = entries[index]
        let values = cached.byEvent.get(entry.event)
        if (!values) { values = project(entry); cached.byEvent.set(entry.event, values) }
        for (const value of values) cached.values.push(value)
        cached.through = index + 1; cached.snapshot = undefined
      }
    } catch (error) { state.projections.delete(key); throw error }
    // A consumer key is owned by one projection function and one result type.
    return (cached.snapshot ??= cached.values.slice()) as readonly T[]
  }
  const emptyPrefix = (): PrefixState => ({ events: [], nodes: [], messages: new Map(), calls: new Map(), used: new Set(), lane: Promise.resolve() })
  const prefixKey: CacheKey<object, PrefixState> = cache.define('native-historical-context',
    'Immutable log owner; native projection definitions and incremental event cursor before an explicit terminal.', emptyPrefix)
  async function contextBefore(log: Pick<SessionLogRead, 'owner' | 'at'>, terminal: SessionEvent, maxMessages: number, signal?: AbortSignal): Promise<HistoricalContext> {
    signal?.throwIfAborted()
    const root = cache.use(log.owner, prefixKey)
    const task = root.lane.then(async () => {
      signal?.throwIfAborted()
      if (closed) throw new Error('context-care-session-log-closed')
      if (cache.peek(log.owner, prefixKey) !== root) return contextBefore(log, terminal, maxMessages, signal)
      if (log.at(terminal.seq) !== terminal) throw new Error('context-care-session-history-terminal-mismatch')
      // One backward reader must not discard the forward recovery cursor. Retain
      // only its latest older fold, not a full prefix per historical terminal.
      let state = root
      if (terminal.seq < root.events.length) {
        if (!root.older || root.older.events.length > terminal.seq) root.older = emptyPrefix()
        state = root.older
      }
      const definitions = ctx.sessions.messageProjections
      const assertDefinitions = () => {
        for (const definition of state.used) if (!definitions.includes(definition)) {
          throw new Error(`context-care-native-message-projection-unloaded: ${definition.type}`)
        }
      }
      const byType = new Map(definitions.map(definition => [definition.type, definition]))
      try {
        assertDefinitions()
        while (state.events.length < terminal.seq) {
          signal?.throwIfAborted()
          const event = log.at(state.events.length)
          if (!event) throw new Error('context-care-session-history-prefix-missing')
          const definition = byType.get(event.type)
          if (definition) {
            const updates = definition.project(event, { nodes: state.nodes, events: state.events,
              baseSeq: 0 as Session['inheritedEventCount'], messages: state.messages })
            for (const [seq, message] of updates) state.messages.set(seq, message)
            state.used.add(definition)
          } else if (event.surfaceOp === 'append') state.nodes.push(event.seq)
          else if (event.surfaceOp && typeof event.surfaceOp === 'object' && 'op' in event.surfaceOp && event.surfaceOp.op === 'replace') {
            const start = state.nodes.indexOf(event.surfaceOp.startSeq), end = state.nodes.indexOf(event.surfaceOp.endSeq)
            if (start < 0 || end < start) throw new Error('context-care-native-surface-range-missing')
            state.nodes.splice(start, end - start + 1, event.seq)
          }
          state.events.push(event)
          if (event.type === 'tool/call') state.calls.set(String(event.data.callId), event)
          cache.worked(prefixKey)
          if (state.events.length % 2048 === 0) {
            await yieldToHost(); signal?.throwIfAborted(); assertDefinitions()
            if (closed) throw new Error('context-care-session-log-closed')
          }
        }
        const messages: Message[] = []
        for (let index = state.nodes.length - 1; index >= 0 && messages.length <= maxMessages; index--) {
          const seq = state.nodes[index]
          let message = state.messages.get(seq)
          if (!message) {
            state.native ??= ctx.sessions.prepare()
            message = state.native.deriveEventMessage(state.events[seq]) ?? undefined
            if (message) state.messages.set(seq, message)
          }
          if (message) messages.unshift(message)
        }
        const call = terminal.type === 'tool/result' ? state.calls.get(String(terminal.data.message.toolCallId)) : undefined
        return { messages, ...(call ? { call } : {}) }
      } catch (error) {
        // A failed native interpreter may have mutated nodes before throwing.
        if (cache.peek(log.owner, prefixKey) === root) cache.invalidate(log.owner, prefixKey)
        throw error
      }
    })
    // The returned task owns the failure; subsequent readers still get a turn.
    root.lane = task.catch(() => undefined)
    return task
  }
  function derivedMessage(session: Session, event: SessionEvent): Message | undefined {
    const generation = session.surface.contentGeneration, state = owned(session)
    if (state.messages?.generation !== generation) state.messages = { generation, values: new Map() }
    const values = state.messages.values
    if (!values.has(event.seq)) values.set(event.seq, session.deriveEventMessage(event) ?? undefined)
    return values.get(event.seq)
  }
  function messageAt(session: Session, seq: number): Message | undefined {
    using log = live(session)
    const event = log.at(seq)
    return event ? derivedMessage(session, event) : undefined
  }
  function tail(session: Session, maxMessages: number, excludeMessageId?: string): readonly Message[] {
    const messages: Message[] = [], nodes = session.surface.nodes
    using log = live(session)
    for (let index = nodes.length - 1; index >= 0 && messages.length <= maxMessages; index--) {
      const event = log.at(nodes[index])
      if (!event) throw new Error('context-care-session-surface-event-missing')
      const message = derivedMessage(session, event)
      if (message && message.id !== excludeMessageId) messages.unshift(message)
    }
    return messages
  }
  function messageOrigins(session: Session): readonly MessageOrigin[] {
    return projectSurface(session, messageKey, entry => {
      const message = derivedMessage(session, entry.event)
      return message ? [{ ...entry, message }] : []
    }, true)
  }
  function tools(session: Session): ReturnType<Session['toolHistory']> {
    const state = owned(session)
    if (state.tools?.through !== session.seq) state.tools = { through: session.seq, value: session.toolHistory() }
    return state.tools.value
  }
  function origins(session: Session) {
    const messages = messageOrigins(session), state = surfaceState(session)
    let indexed = state.origins
    if (!indexed || indexed.through > messages.length
      || indexed.through > 0 && messages[indexed.through - 1] !== indexed.last) {
      indexed = { through: 0, byId: new Map() }; state.origins = indexed
    }
    if (indexed.snapshot?.messages === messages) return indexed.snapshot
    for (let index = indexed.through; index < messages.length; index++) {
      const value = messages[index], id = String(value.message.id)
      let bucket = indexed.byId.get(id)
      if (!bucket) { bucket = []; indexed.byId.set(id, bucket) }
      const prior = bucket.at(-1)?.value
      // Duplicate message ids keep the newest native origin in this surface cut.
      bucket.push({ index, value: prior && prior.event.seq >= value.event.seq ? prior : value })
      if (value.message.role === 'system' && (!indexed.system || value.event.seq < indexed.system.event.seq)) indexed.system = value
      cache.worked(sessionKey)
    }
    indexed.through = messages.length; indexed.last = messages.at(-1)
    const length = messages.length, directory = indexed.byId
    indexed.snapshot = { messages, system: indexed.system, byId: { get(id: string) {
      const bucket = directory.get(id)
      if (!bucket) return undefined
      let left = 0, right = bucket.length
      while (left < right) {
        const middle = Math.floor((left + right) / 2)
        if (bucket[middle].index < length) left = middle + 1
        else right = middle
      }
      return left > 0 ? bucket[left - 1].value : undefined
    } } }
    return indexed.snapshot
  }
  function projectHistory<T>(session: Session, key: object, types: readonly Kind[], project: (entry: SurfaceEntry) => readonly T[], beforeSeq = session.seq): IndexedProjection<T> {
    using log = live(session)
    const consumers = owned(session).histories
    let state = consumers.get(key)
    if (!state) { state = { through: 0, turnId: String(session.id) + ':seed', values: [], ends: [] }; consumers.set(key, state) }
    const end = Math.min(beforeSeq, log.length)
    if (state.through < end) {
      const selected = new Set(types)
      try {
        for (const event of log.select([...types, 'turn/start'], state.through, end)) {
          if (event.type === 'turn/start') state.turnId = String(session.id) + ':turn:' + (event.data.turn ?? event.seq)
          if (!selected.has(event.type)) continue
          for (const value of project({ event, turnId: state.turnId })) state.values.push(value)
          state.ends.push({ seq: event.seq, end: state.values.length })
          state.through = event.seq + 1
        }
        state.through = end
      } catch (error) {
        // A callback or iterator may fail after appending values. The next read
        // must reconstruct this consumer, never resume a half-published event.
        consumers.delete(key); throw error
      }
    }
    let left = 0, right = state.ends.length
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      if (state.ends[middle].seq < end) left = middle + 1
      else right = middle
    }
    const length = left ? state.ends[left - 1].end : 0
    const values = state.values as T[]
    return { length, at: index => index >= 0 && index < length ? values[index] : undefined,
      slice: (from = 0, to = length) => values.slice(Math.max(0, from), Math.min(length, to)) }
  }
  return { cache, read, live, surfaceEvents, lastSurface, historical, projectSurface, projectHistory, origins, messageAt, tail, contextBefore, tools,
    messages(session: Session): readonly Message[] {
      const projected = messageOrigins(session), state = surfaceState(session)
      if (state.messages?.origins !== projected) state.messages = { origins: projected, values: projected.map(value => value.message) }
      return state.messages.values
    },
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
      pending.clear(); stopDisposed(); cache.close()
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
