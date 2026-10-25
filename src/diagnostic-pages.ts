import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionLog, SessionLogRead } from './session-log.js'
import type { CacheKey } from './session-cache.js'

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
export function createDiagnosticRelations<R, K>(keys: (record: R) => readonly K[]) {
  const indexed = new Map<R, readonly K[]>(), buckets = new Map<K, Set<R>>()
  let order = new Map<R, number>()
  const views = new Map<K, readonly R[]>()
  return {
    update(records: readonly R[], rekey = false): ReadonlySet<K> {
      const next = new Map(records.map((record, index) => [record, index])), changed = new Set<K>()
      for (const [record, previous] of indexed) if (!next.has(record) || (rekey && (() => {
        const selected = [...new Set(keys(record))]
        return selected.length !== previous.length || selected.some((key, index) => key !== previous[index])
      })())) {
        for (const key of previous) { const bucket = buckets.get(key)!; bucket.delete(record); if (!bucket.size) buckets.delete(key); changed.add(key) }
        indexed.delete(record)
      }
      for (const record of records) if (!indexed.has(record)) {
        const selected = [...new Set(keys(record))]; indexed.set(record, selected)
        for (const key of selected) { let bucket = buckets.get(key); if (!bucket) { bucket = new Set(); buckets.set(key, bucket) }; bucket.add(record); changed.add(key) }
      }
      // A list revision may reorder retained records. Absolute positions shift
      // after unrelated inserts; invalidate only inversions inside a bucket.
      const last = new Map<K, number>()
      for (const record of records) {
        const previous = order.get(record)
        if (previous === undefined) continue
        for (const key of indexed.get(record) ?? []) {
          if ((last.get(key) ?? -1) > previous) changed.add(key)
          last.set(key, previous)
        }
      }
      order = next
      for (const key of changed) views.delete(key)
      return changed
    },
    get(key: K): readonly R[] {
      let view = views.get(key)
      if (!view) { view = [...(buckets.get(key) ?? [])].sort((a, b) => order.get(a)! - order.get(b)!); views.set(key, view) }
      return view
    },
  }
}

interface Projection<T, A> { entries: DiagnosticIndex<T>; admission?: A }
interface PageQuery { offset: number; limit: number; seq?: number }
interface State<R, T, A> { through: number; records?: readonly R[]; index?: Projection<T, A>;
  update: (records: readonly R[], added: readonly SessionEvent[]) => Projection<T, A> }

/** HTTP and subscriptions borrow the same owner-scoped Session projection. */
export function createDiagnosticPages<R, T, A>(history: SessionLog, types: readonly SessionEvent['type'][],
  create: () => (records: readonly R[], added: readonly SessionEvent[]) => Projection<T, A>) {
  const stateKey: CacheKey<Session, State<R, T, A>> = { name: `diagnostic-index:${types.join(',')}`,
    validity: 'Native Session identity; relevant event cursor and immutable record-list identity.',
    create: () => ({ through: 0, update: create() }) }
  const bodyKey: CacheKey<DiagnosticEntry<T>, { cached?: { value: T; missing?: number } }> = { name: `diagnostic-body:${types.join(',')}`,
    validity: 'Immutable entry identity; a missing future evidence seq expires when that event exists.', create: () => ({}) }
  const page = (session: Session, records: readonly R[], query: PageQuery) => {
    using log = history.live(session)
    const state = history.cache.use(session, stateKey)
    const added = log.select(types, state.through)
    if (!state.index || added.length || state.records !== records) {
      try { state.index = state.update(records, added) }
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
