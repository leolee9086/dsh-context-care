import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionLog, SessionLogRead } from './session-log.js'
import type { CacheKey } from './session-cache.js'

export const compareDiagnosticRecords = (left: { at: number; key: string }, right: { at: number; key: string }) => left.at - right.at || left.key.localeCompare(right.key)
export interface DiagnosticRecordDelta<R> { readonly added: readonly R[]; readonly removed: readonly R[]; readonly order?: readonly R[] }
export interface DiagnosticRecordFeed<R> { consume(cursor: object): DiagnosticRecordDelta<R> }
export type DiagnosticRecords<R> = DiagnosticRecordFeed<R>
export type DiagnosticRecordInput<R> = DiagnosticRecordDelta<R>
const emptyDelta: DiagnosticRecordDelta<never> = { added: [], removed: [] }

/** The owning Session cache contains this feed. Consumers hold only their cursor;
 * weak readers cannot retain disposed page projections or abandoned subscriptions.
 * Coalesce pending edits by record identity instead of retaining a revision log. */
export function createDiagnosticRecordFeed<R>(compare: (left: R, right: R) => number) {
  const values = new Map<string, R>()
  type Pending = { before?: R; after?: R }
  type Reader = { pending: Map<string, Pending> }
  const cursors = new WeakMap<object, Reader>(), readers = new Set<WeakRef<Reader>>()
  let snapshot: readonly R[] | undefined
  const readSnapshot = () => snapshot ??= [...values.values()].sort(compare)
  const publish = (id: string, before: R | undefined, after: R | undefined) => {
    if (before === after) return
    snapshot = undefined
    for (const reference of readers) {
      const reader = reference.deref()
      if (!reader) { readers.delete(reference); continue }
      const pending = reader.pending.get(id)
      const change = { before: pending ? pending.before : before, after }
      if (change.before === change.after) reader.pending.delete(id)
      else reader.pending.set(id, change)
    }
  }
  return {
    set(id: string, record: R) { const before = values.get(id); values.set(id, record); publish(id, before, record) },
    delete(id: string) { const before = values.get(id); if (values.delete(id)) publish(id, before, undefined) },
    snapshot(): readonly R[] { return readSnapshot() },
    consume(cursor: object): DiagnosticRecordDelta<R> {
      let reader = cursors.get(cursor)
      if (!reader) {
        const added = readSnapshot()
        reader = { pending: new Map() }; cursors.set(cursor, reader); readers.add(new WeakRef(reader))
        return { added, removed: [] }
      }
      if (!reader.pending.size) return emptyDelta
      const added: R[] = [], removed: R[] = []
      for (const change of reader.pending.values()) {
        if (change.before !== undefined) removed.push(change.before)
        if (change.after !== undefined) added.push(change.after)
      }
      added.sort(compare)
      reader.pending.clear()
      return { added, removed }
    },
  }
}

/** Sorted scalar candidates. Updates inspect only changed records; array shifts
 * move references but never re-parse or re-sort the complete historical list. */
export function createDiagnosticOrder<R>(compare: (left: R, right: R) => number) {
  const values: R[] = []
  const position = (value: R) => {
    let low = 0, high = values.length
    while (low < high) { const middle = (low + high) >>> 1; if (compare(values[middle], value) < 0) low = middle + 1; else high = middle }
    return low
  }
  return {
    update(delta: DiagnosticRecordDelta<R>) {
      for (const record of delta.removed) { const at = position(record); if (values[at] === record) values.splice(at, 1) }
      for (const record of delta.added) values.splice(position(record), 0, record)
    },
    last(): R | undefined { return values.at(-1) },
  }
}

export type DiagnosticRead = Pick<SessionLogRead, 'at'>
/** Entries are immutable revisions; only the selected page builds bodies. */
export interface DiagnosticEntry<T> { id: string; order: number; seq?: number; materialize(log: DiagnosticRead): T }
export interface DiagnosticIndex<T> {
  readonly size: number
  get(id: string): DiagnosticEntry<T> | undefined
  set(entry: DiagnosticEntry<T>): void
  delete(id: string): void
  slice(from: number, to: number): readonly DiagnosticEntry<T>[]
  position(seq: number): number | undefined
}

/** Sorted metadata only. Binary searches avoid re-sorting unchanged entries. */
export function createDiagnosticIndex<T>(): DiagnosticIndex<T> {
  const entries: DiagnosticEntry<T>[] = [], byId = new Map<string, DiagnosticEntry<T>>()
  const bySeq = new Map<number, Set<DiagnosticEntry<T>>>()
  // Native events arrive in increasing order. Append them without shifting an
  // entire array; reverse only the bounded page exposed as newest-first.
  const compare = (a: DiagnosticEntry<T>, b: DiagnosticEntry<T>) => a.order - b.order || a.id.localeCompare(b.id)
  const position = (entry: DiagnosticEntry<T>) => {
    let low = 0, high = entries.length
    while (low < high) { const middle = (low + high) >>> 1; if (compare(entries[middle], entry) < 0) low = middle + 1; else high = middle }
    return low
  }
  const remove = (id: string) => {
    const previous = byId.get(id)
    if (!previous) return
    entries.splice(position(previous), 1); byId.delete(id)
    if (previous.seq !== undefined) {
      const bucket = bySeq.get(previous.seq)!
      bucket.delete(previous); if (!bucket.size) bySeq.delete(previous.seq)
    }
  }
  return {
    get size() { return entries.length },
    get: id => byId.get(id),
    set(entry) {
      if (byId.get(entry.id) === entry) return
      remove(entry.id)
      entries.splice(position(entry), 0, entry); byId.set(entry.id, entry)
      if (entry.seq !== undefined) {
        let bucket = bySeq.get(entry.seq)
        if (!bucket) { bucket = new Set(); bySeq.set(entry.seq, bucket) }
        bucket.add(entry)
      }
    },
    delete: remove, slice: (from, to) => entries.slice(Math.max(0, entries.length - to), Math.max(0, entries.length - from)).reverse(),
    position(seq) {
      const bucket = bySeq.get(seq)
      if (!bucket) return undefined
      let first: DiagnosticEntry<T> | undefined
      for (const entry of bucket) if (!first || compare(entry, first) > 0) first = entry
      return first ? entries.length - 1 - position(first) : undefined
    },
  }
}

/** Keep relation buckets stable across immutable record-list revisions. */
export function createDiagnosticRelations<R, K>(keys: (record: R) => readonly K[], compare?: (left: R, right: R) => number) {
  const indexed = new Map<R, readonly K[]>(), buckets = new Map<K, Set<R>>()
  let order = new Map<R, number>(), sequence = 0, explicitOrder = false
  const views = new Map<K, readonly R[]>()
  return {
    update(records: DiagnosticRecordInput<R>): ReadonlySet<K> {
      const changed = new Set<K>()
      for (const record of records.removed) {
        for (const key of indexed.get(record) ?? []) {
          const bucket = buckets.get(key)!; bucket.delete(record); if (!bucket.size) buckets.delete(key); changed.add(key)
        }
        indexed.delete(record); order.delete(record)
      }
      for (const record of records.added) {
        const selected = [...new Set(keys(record))]; indexed.set(record, selected)
        if (!order.has(record)) order.set(record, sequence++)
        for (const key of selected) {
          let bucket = buckets.get(key); if (!bucket) { bucket = new Set(); buckets.set(key, bucket) }
          bucket.add(record); changed.add(key)
        }
      }
      if (records.order) {
        explicitOrder = true
        const next = new Map(records.order.map((record, index) => [record, index])), last = new Map<K, number>()
        for (const record of records.order) for (const key of indexed.get(record) ?? []) {
          const previous = order.get(record) ?? -1
          if ((last.get(key) ?? -1) > previous) changed.add(key)
          last.set(key, previous)
        }
        order = next; sequence = next.size
      }
      for (const key of changed) views.delete(key)
      return changed
    },
    rekey(records: Iterable<R>): ReadonlySet<K> {
      const changed = new Set<K>()
      for (const record of records) {
        const previous = indexed.get(record)
        if (!previous) continue
        const selected = [...new Set(keys(record))]
        if (selected.length === previous.length && selected.every((key, index) => key === previous[index])) continue
        for (const key of previous) { const bucket = buckets.get(key)!; bucket.delete(record); if (!bucket.size) buckets.delete(key); changed.add(key) }
        indexed.set(record, selected)
        for (const key of selected) { let bucket = buckets.get(key); if (!bucket) { bucket = new Set(); buckets.set(key, bucket) }; bucket.add(record); changed.add(key) }
      }
      for (const key of changed) views.delete(key)
      return changed
    },
    get(key: K): readonly R[] {
      let view = views.get(key)
      if (!view) { view = [...(buckets.get(key) ?? [])].sort(!explicitOrder && compare ? compare : ((a, b) => order.get(a)! - order.get(b)!)); views.set(key, view) }
      return view
    },
  }
}

interface Projection<T, A> { entries: DiagnosticIndex<T>; admission?: A }
interface PageQuery { offset: number; limit: number; seq?: number }
interface State<R, T, A> { through: number; records?: DiagnosticRecords<R>; index?: Projection<T, A>;
  update: (records: DiagnosticRecordInput<R>, added: readonly SessionEvent[]) => Projection<T, A> }

/** HTTP and subscriptions borrow the same owner-scoped Session projection. */
export function createDiagnosticPages<R, T, A>(history: SessionLog, types: readonly SessionEvent['type'][],
  create: () => (records: DiagnosticRecordInput<R>, added: readonly SessionEvent[]) => Projection<T, A>) {
  const stateKey: CacheKey<Session, State<R, T, A>> = { name: `diagnostic-index:${types.join(',')}`,
    validity: 'Native Session identity; relevant event cursor and immutable record-list identity.',
    create: () => ({ through: 0, update: create() }) }
  const bodyKey: CacheKey<DiagnosticEntry<T>, { cached?: { value: T; missing?: number } }> = { name: `diagnostic-body:${types.join(',')}`,
    validity: 'Immutable entry identity; a missing future evidence seq expires when that event exists.', create: () => ({}) }
  const page = (session: Session, records: DiagnosticRecords<R>, query: PageQuery) => {
    using log = history.live(session)
    let state = history.cache.use(session, stateKey)
    if (state.records && state.records !== records) {
      history.cache.invalidate(session, stateKey); state = history.cache.use(session, stateKey)
    }
    const added = log.select(types, state.through)
    const input = records.consume(state)
    const changed = input.added.length + input.removed.length > 0 || input.order !== undefined
    if (!state.index || added.length || changed) {
      try { state.index = state.update(input, added) }
      catch (error) {
        // A builder may already have changed its relation buckets before failing.
        // Rebuild from cached native facts on explicit retry, not that partial state.
        history.cache.invalidate(session, stateKey)
        throw error
      }
      state.records = records
      history.cache.worked(stateKey, added.length)
    }
    // Publish a cursor only after its index update succeeds.
    state.through = log.length
    const { index } = state
    const selected = query.seq === undefined ? undefined : index.entries.position(query.seq)
    const offset = selected === undefined ? query.offset : Math.floor(selected / query.limit) * query.limit
    const items = index.entries.slice(offset, offset + query.limit).map(entry => {
      const body = history.cache.use(entry, bodyKey), cached = body.cached
      if (cached && (cached.missing === undefined || cached.missing >= log.length)) return cached.value
      let missing: number | undefined
      const value = entry.materialize({ at(seq) {
        const event = log.at(seq)
        if (!event && seq >= log.length) missing = Math.min(missing ?? seq, seq)
        return event
      } })
      body.cached = { value, missing }
      history.cache.worked(bodyKey)
      return value
    })
    return { items, admission: index.admission, total: index.entries.size, offset,
      selectedFound: query.seq === undefined ? undefined : selected !== undefined,
      nextOffset: offset + items.length < index.entries.size ? offset + items.length : null }
  }
  return Object.assign(page, { close() { history.cache.clear(stateKey); history.cache.clear(bodyKey) } })
}
