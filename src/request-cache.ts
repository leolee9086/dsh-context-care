import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId, EpochHeader } from '@deepseek-ai/dsh-session'
import type { LlmCallConfig, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { replayRequest } from './request-replay.js'
import { z } from 'zod'
import { createRequestHistory, type SessionRequestRecord } from './request-history.js'
import type { SessionLog } from './session-log.js'
import type { CacheKey } from './session-cache.js'

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
  revision: number
  listed?: { count: number; revision: number; rows: CacheRecord[] }
  publicRows: Map<SessionRequestRecord, { diagnostic?: CacheRecord; value: CacheRecord }>
}
interface Options {
  logs: SessionLog
  sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush' | 'prepare'>
  measureInput: (session: Session, request: GenerateOptions) => { textTokens: number; visualTokens: number }
  /** Current estimator/provider capability identities used by measureInput. */
  measurementDependencies?: (header: EpochHeader | undefined) => readonly unknown[]
  now?: () => number
  /** Publish the admitted record, so observers invalidate its own view only. */
  changed?: (sessionId: string, record: CacheRecord) => void
}
interface MeasuredInput {
  rawInput: { textTokens: number; visualTokens: number }
  calibrationHeaderKey: string
}
interface CalibrationInput {
  dependencies?: readonly unknown[]
  seq?: number
  value?: MeasuredInput
}
// Calibration values stay under one Host-managed Session entry. Weak function
// keys release temporary meters. Keep only the latest sample per actual full
// header: interleaved catalogs must not evict each other or replay old inputs.
const calibrationInputKey: CacheKey<Session, WeakMap<Options['measureInput'], Map<string, CalibrationInput>>> = {
  name: 'request-calibration-input',
  validity: 'Native Session and measurement function identity; latest successful sample and capabilities per full header.',
  create: () => new WeakMap(),
}

/**
 * Keep in-flight diagnostics in memory and read settled request facts from Session.
 * This cache owns no storage domain; clearing it cannot erase a committed request.
 * @param options - the live Session service and optional observation clock.
 * @returns the request query facade and its process-local recorder.
 */
export function createRequestCache({ sessions, logs, measureInput, measurementDependencies, now = Date.now, changed = () => {} }: Options) {
  const history = createRequestHistory(logs)
  const cacheKey: CacheKey<Session, SessionCache> = logs.cache.define('request-cache',
    'Native Session identity; transient diagnostic revisions advance only after accepted writes.',
    () => ({ active: new Map(), recent: new Map(), revision: 0, publicRows: new Map() }))
  function measuredFor(session: Session, header: EpochHeader | undefined, key: string): CalibrationInput {
    const values = logs.cache.use(session, calibrationInputKey)
    let headers = values.get(measureInput)
    if (!headers) { headers = new Map(); values.set(measureInput, headers) }
    const dependencies = measurementDependencies?.(header) ?? []
    let value = headers.get(key)
    if (!value || value.dependencies?.length !== dependencies.length
      || !dependencies.every((dependency, index) => Object.is(value?.dependencies?.[index], dependency))) {
      value = { dependencies: [...dependencies] }; headers.set(key, value)
    }
    return value
  }
  const getSession = (id: string) => sessions.get(id as SessionId)
  function cacheOf(session: Session): SessionCache { return logs.cache.use(session, cacheKey) }
  function listOne(session: Session): CacheRecord[] {
    // The immutable Session rows win if a live diagnostic disagrees about settlement.
    const committed = history.read(session)
    const cache = cacheOf(session), rowsBySource = cache.publicRows
    // The native fold appends immutable rows; unrelated events cannot change an
    // existing settlement. Keep one list until a settlement or live fact changes.
    if (cache.listed?.count === committed.length && cache.listed.revision === cache.revision) return cache.listed.rows
    const transient = [...(cache?.recent.values() ?? []), ...(cache?.active.values() ?? [])]
    const byEvent = new Map(transient.filter(row => row.kind === 'request' && typeof row.data.eventSeq === 'number')
      .map(row => [row.data.eventSeq, row]))
    const byCompaction = new Map(transient.filter(row => row.kind === 'request' && typeof row.data.compactionId === 'string')
      .map(row => [row.data.compactionId, row]))
    const rows: CacheRecord[] = committed.map(row => {
      const diagnostic = byEvent.get(row.data.eventSeq) ?? (row.data.compactionId ? byCompaction.get(row.data.compactionId) : undefined)
      const cached = rowsBySource.get(row)
      if (cached && cached.diagnostic === diagnostic) return cached.value
      // Keep the header by reference inside the private fold. Repeating its
      // entire tool schema in every public row is not request evidence.
      const { sourceHeader: _sourceHeader, ...facts } = row.data
      // These values already crossed the Session or diagnostic admission boundary.
      // Deep JSON validation here used to traverse every historical request diff
      // on every read, blocking unrelated Host HTTP handlers in the same process.
      const data = { ...diagnostic?.data, ...facts }
      const value = { ...row, data }
      rowsBySource.set(row, { diagnostic, value })
      return value
    })
    const settled = new Set(committed.map(row => row.data.eventSeq as number))
    const compactions = new Set(committed.map(row => row.data.compactionId).filter(id => id !== undefined))
    for (const row of transient) {
      const committedRequest = row.kind === 'request' && ((typeof row.data.eventSeq === 'number' && settled.has(row.data.eventSeq))
        || (typeof row.data.compactionId === 'string' && compactions.has(row.data.compactionId)))
      if (!committedRequest) rows.push(row)
    }
    rows.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    cache.listed = { count: committed.length, revision: cache.revision, rows }
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
        const measured = measuredFor(session, session.requestHeader(), data.calibrationHeaderKey)
        measured.seq = data.eventSeq
        measured.value = { rawInput: { textTokens: raw.textTokens, visualTokens: raw.visualTokens },
          calibrationHeaderKey: data.calibrationHeaderKey }
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
      cache.revision++
      changed(String(sessionId), value)
    },
    /** The durability checkpoint belongs to Session, not to a second writer. */
    async flush(sessionId?: string) {
      const selected = sessionId === undefined ? sessions.list() : [getSession(sessionId)].filter((session): session is Session => session !== undefined)
      await Promise.all(selected.map(session => sessions.flush(session)))
    },
    /** A stable read-only cut for diagnostic projections; list() still returns its own array. */
    view(sessionId: string): readonly CacheRecord[] {
      const session = getSession(sessionId)
      return session ? listOne(session) : []
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
      let previous: CacheRecord | undefined = history.previous(session, purpose)
      const cache = cacheOf(session)
      for (const rows of [cache.recent.values(), cache.active.values()]) for (const row of rows ?? []) {
        if (row.kind !== 'request' || row.data.dispatched !== true || row.data.purpose !== purpose) continue
        // A live diagnostic must never override the route of its own settlement.
        // Only an operation absent from the native committed index is transient.
        if (history.contains(session, row)) continue
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
      const sample = history.calibration(session, header)
      if (!sample) {
        const latest = history.read(session).at(-1)
        return latest ? [latest] : []
      }
      const expected = history.headerKey(header)
      const measured = measuredFor(session, header, expected)
      if (measured.seq !== sample.data.eventSeq || measured.value?.calibrationHeaderKey !== expected) {
        const replay = replayRequest(logs, session, sample)
        // Publish only after successful reconstruction and measurement. A failed
        // attempt leaves the prior immutable sample intact and retries naturally.
        const value = { rawInput: measureInput(replay.session, replay.request), calibrationHeaderKey: expected }
        measured.seq = sample.data.eventSeq; measured.value = value
        logs.cache.worked(calibrationInputKey)
      }
      if (!measured.value) throw new Error('context-care: calibration measurement missing')
      return [{ ...sample, data: { ...sample.data, ...measured.value } }]
    },
    /** Idle/unloaded Agents retain no unfinished request objects. */
    release(session: Session) {
      const cache = logs.cache.peek(session, cacheKey)
      if (cache?.active.size) { cache.active.clear(); cache.revision++ }
    },
    /** Forgetting transient diagnostics does not modify Session or storage. */
    async close() { logs.cache.clear(cacheKey) },
  }
}
