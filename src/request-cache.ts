import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId, EpochHeader } from '@deepseek-ai/dsh-session'
import type { LlmCallConfig, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { replayRequest } from './request-replay.js'
import { z } from 'zod'
import { createRequestHistory } from './request-history.js'

const JsonRecord = z.record(z.string(), z.json())
type Data = Readonly<Record<string, unknown>>
export interface CacheRecord {
  key: string
  version: 1
  sessionId: string
  kind: 'request' | 'maintenance'
  /** Live diagnostics are not independent durable audit records. */
  transient?: true
  at: number
  data: Data
}
interface SessionCache {
  active: Map<string, CacheRecord>
  /** Only the latest completed operation of each purpose/action, not every past phase. */
  recent: Map<string, CacheRecord>
}
interface Options {
  sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush' | 'prepare'>
  measureInput: (session: Session, request: GenerateOptions) => { textTokens: number; visualTokens: number }
  now?: () => number
  /** Publish the admitted record, so observers invalidate its own view only. */
  changed?: (sessionId: string, record: CacheRecord) => void
}

/**
 * Keep in-flight diagnostics in memory and read settled request facts from Session.
 * This cache owns no storage domain; clearing it cannot erase a committed request.
 * @param options - the live Session service and optional observation clock.
 * @returns the request query facade and its process-local recorder.
 */
export function createRequestCache({ sessions, measureInput, now = Date.now, changed = () => {} }: Options) {
  const history = createRequestHistory()
  let measurements = new WeakMap<Session, Map<number, { rawInput: ReturnType<Options['measureInput']>; calibrationHeaderKey: string }>>()
  let caches = new WeakMap<Session, SessionCache>()
  let headerKeys = new WeakMap<EpochHeader, string>()
  // Native request headers are immutable, so hashing each large tool catalog
  // once is enough even when hundreds of settlements reference that header.
  const headerKey = (value: EpochHeader | undefined): string => {
    const cached = value === undefined ? undefined : headerKeys.get(value)
    if (cached !== undefined) return cached
    const key = createHash('sha256').update(JSON.stringify({ config: value?.config, tools: value?.tools })).digest('hex')
    if (value !== undefined) headerKeys.set(value, key)
    return key
  }
  const getSession = (id: string) => sessions.get(id as SessionId)
  function cacheOf(session: Session): SessionCache {
    let cache = caches.get(session)
    if (!cache) { cache = { active: new Map(), recent: new Map() }; caches.set(session, cache) }
    return cache
  }
  function listOne(session: Session): CacheRecord[] {
    // The immutable Session rows win if a live diagnostic disagrees about settlement.
    const committed = history.read(session)
    const cache = caches.get(session)
    const transient = [...(cache?.recent.values() ?? []), ...(cache?.active.values() ?? [])]
    const byEvent = new Map(transient.filter(row => row.kind === 'request' && typeof row.data.eventSeq === 'number')
      .map(row => [row.data.eventSeq, row]))
    const byCompaction = new Map(transient.filter(row => row.kind === 'request' && typeof row.data.compactionId === 'string')
      .map(row => [row.data.compactionId, row]))
    const rows: CacheRecord[] = committed.map(row => {
      const diagnostic = byEvent.get(row.data.eventSeq) ?? (row.data.compactionId ? byCompaction.get(row.data.compactionId) : undefined)
      // Keep the header by reference inside the private fold. Repeating its
      // entire tool schema in every public row is not request evidence.
      const { sourceHeader: _sourceHeader, ...facts } = row.data
      // These values already crossed the Session or diagnostic admission boundary.
      // Deep JSON validation here used to traverse every historical request diff
      // on every read, blocking unrelated Host HTTP handlers in the same process.
      const data = { ...diagnostic?.data, ...facts }
      return { ...row, data }
    })
    const settled = new Set(committed.map(row => row.data.eventSeq as number))
    const compactions = new Set(committed.map(row => row.data.compactionId).filter(id => id !== undefined))
    for (const row of transient) {
      const committedRequest = row.kind === 'request' && ((typeof row.data.eventSeq === 'number' && settled.has(row.data.eventSeq))
        || (typeof row.data.compactionId === 'string' && compactions.has(row.data.compactionId)))
      if (!committedRequest) rows.push(row)
    }
    return rows
  }
  return {
    /** Record only an operation currently owned by this process; never write a JSON side record. */
    async put(key: string, sessionId: string, kind: CacheRecord['kind'], input: Record<string, unknown>) {
      const session = getSession(String(sessionId))
      if (!session) throw new Error(`context-care: request session unavailable: ${sessionId}`)
      const data = JsonRecord.parse(JSON.parse(JSON.stringify(input)))
      const value: CacheRecord = { key, version: 1, sessionId: String(sessionId), kind, transient: true, at: now(), data }
      const cache = cacheOf(session)
      const raw = data.rawInput
      if (kind === 'request' && data.phase === 'settled' && data.outcome === 'completed'
        && typeof data.eventSeq === 'number' && typeof data.calibrationHeaderKey === 'string'
        && raw !== null && typeof raw === 'object' && 'textTokens' in raw && 'visualTokens' in raw
        && typeof raw.textTokens === 'number' && typeof raw.visualTokens === 'number') {
        // Reuse the actual hot-path measurement. Cold recovery computes the same
        // two scalars from the logged input instead of restoring a second ledger.
        measurements.set(session, new Map([[data.eventSeq, { rawInput: { textTokens: raw.textTokens, visualTokens: raw.visualTokens },
          calibrationHeaderKey: data.calibrationHeaderKey }]]))
      }
      if (kind === 'request' && data.phase !== 'settled' && data.phase !== 'failed') {
        cache.active.set(key, value)
      } else {
        cache.active.delete(key)
        if (kind === 'request') {
          cache.recent.set(`request:${String(data.purpose ?? 'conversation')}`, value)
        } else {
          // Retain the finite phases of the current operation, not one file per
          // action and not just the final phase (which would hide a real repair).
          const family = `action:${String(data.action)}:`
          const identity = data.operationId ?? data.compactionId
          let previous: CacheRecord | undefined
          for (const [slot, record] of cache.recent) {
            if (!slot.startsWith(family)) continue
            if ((record.data.operationId ?? record.data.compactionId) !== identity) cache.recent.delete(slot)
            else if (!previous || record.at >= previous.at) previous = record
          }
          const merged = previous ? { ...value, data: { ...previous.data, ...data } } : value
          cache.recent.set(`${family}${String(data.phase)}`, merged)
        }
      }
      changed(String(sessionId), value)
    },
    /** The durability checkpoint belongs to Session, not to a second writer. */
    async flush(sessionId?: string) {
      const selected = sessionId === undefined ? sessions.list() : [getSession(sessionId)].filter((session): session is Session => session !== undefined)
      await Promise.all(selected.map(session => sessions.flush(session)))
    },
    /** Read actual settlements plus bounded live diagnostics for loaded sessions. */
    list(sessionId?: string): CacheRecord[] {
      const selected = sessionId === undefined ? sessions.list() : [getSession(sessionId)].filter((session): session is Session => session !== undefined)
      return selected.flatMap(listOne).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    },
    /** Read a previous dispatched route without trusting a persisted context-care table. */
    previousRoute(session: Session, purpose: string): LlmCallConfig | undefined {
      // Route selection needs one scalar from the newest dispatched request. It
      // must not materialize all historical diagnostics or copy their input diffs.
      const committed = history.read(session)
      let previous: CacheRecord | undefined
      for (let index = committed.length - 1; index >= 0; index--) {
        const row = committed[index]
        if (row.data.dispatched === true && row.data.purpose === purpose) { previous = row; break }
      }
      const cache = caches.get(session)
      for (const rows of [cache?.recent.values(), cache?.active.values()]) for (const row of rows ?? []) {
        if (row.kind !== 'request' || row.data.dispatched !== true || row.data.purpose !== purpose) continue
        // A live diagnostic must never override the route of its own settlement.
        // Only an operation absent from the native committed index is transient.
        if (committed.some(settled => settled.key === row.key
          || typeof row.data.eventSeq === 'number' && settled.data.eventSeq === row.data.eventSeq
          || typeof row.data.compactionId === 'string' && settled.data.compactionId === row.data.compactionId)) continue
        if (!previous || row.at >= previous.at) previous = row
      }
      const route = previous?.data.route
      if (!route || typeof route !== 'object' || Array.isArray(route)
        || !('provider' in route) || !('model' in route)
        || typeof route.provider !== 'string' || typeof route.model !== 'string') return undefined
      return { provider: route.provider, model: route.model }
    },
    settled: history.read,
    /** Reprice a logged input only once per settlement; no cached row is required after restart. */
    calibrationRecords(session: Session, header: EpochHeader | undefined): CacheRecord[] {
      const records = history.read(session)
      const expected = headerKey(header)
      let sample: (typeof records)[number] | undefined
      for (let index = records.length - 1; index >= 0; index--) {
        const record = records[index]
        if (record.data.purpose !== 'conversation' || record.data.outcome !== 'completed'
          || record.data.usage?.inputTokens === undefined) continue
        const source = record.data.sourceHeader
        // A different route cannot share a calibration. Reject it before hashing
        // a dormant epoch's potentially large tool schema.
        if (source?.config.provider === header?.config.provider && source?.config.model === header?.config.model
          && headerKey(source) === expected) { sample = record; break }
      }
      if (!sample) return records.length ? [{ ...records[records.length - 1], data: { ...records[records.length - 1].data } }] : []
      let values = measurements.get(session)
      if (!values) { values = new Map(); measurements.set(session, values) }
      let measured = values.get(sample.data.eventSeq)
      if (!measured) {
        const replay = replayRequest(sessions, session, sample)
        measured = { rawInput: measureInput(replay.session, replay.request), calibrationHeaderKey: expected }
        values.clear(); values.set(sample.data.eventSeq, measured)
      }
      return [{ ...sample, data: { ...sample.data, ...measured } }]
    },
    /** Idle/unloaded Agents retain no unfinished request objects. */
    release(session: Session) { caches.get(session)?.active.clear() },
    /** Forgetting the cache does not modify any Session or existing storage files. */
    async close() { history.clear(); caches = new WeakMap(); measurements = new WeakMap(); headerKeys = new WeakMap() },
  }
}
