import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId, EpochHeader } from '@deepseek-ai/dsh-session'
import type { LlmCallConfig, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { replayRequest } from './request-replay.js'
import { z } from 'zod'
import { createRequestHistory, type SessionRequestRecord } from './request-history.js'
import type { SessionLog } from './session-log.js'
import type { CacheKey } from './session-cache.js'
import { createDiagnosticRecordFeed, compareDiagnosticRecords } from './diagnostic-pages.js'

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
  syncedRevision?: number
  through: number
  committed?: readonly SessionRequestRecord[]
  byEvent: Map<number, SessionRequestRecord>
  byCompaction: Map<string, Set<SessionRequestRecord>>
  diagnostics: Map<string, CacheRecord>
  feed: ReturnType<typeof createDiagnosticRecordFeed<CacheRecord>>
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
    () => ({ active: new Map(), recent: new Map(), revision: 0, through: 0, byEvent: new Map(), byCompaction: new Map(),
      diagnostics: new Map(), feed: createDiagnosticRecordFeed<CacheRecord>(compareDiagnosticRecords), publicRows: new Map() }))
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
  function diagnosticFeed(session: Session) {
    const committed = history.read(session), cache = cacheOf(session)
    // A failed native projection may rebuild its array. Only that exceptional
    // identity change resets consumers; normal appends retain the exact cursor.
    if (cache.committed && cache.committed !== committed) {
      cache.through = 0; cache.syncedRevision = undefined
      cache.byEvent.clear(); cache.byCompaction.clear(); cache.publicRows.clear(); cache.diagnostics.clear()
      cache.feed = createDiagnosticRecordFeed<CacheRecord>(compareDiagnosticRecords)
    }
    cache.committed = committed
    if (cache.through === committed.length && cache.syncedRevision === cache.revision) return cache.feed
    const dirty = new Set<SessionRequestRecord>()
    for (; cache.through < committed.length; cache.through++) {
      const row = committed[cache.through]
      cache.byEvent.set(row.data.eventSeq, row)
      if (row.data.compactionId !== undefined) {
        let bucket = cache.byCompaction.get(row.data.compactionId)
        if (!bucket) { bucket = new Set(); cache.byCompaction.set(row.data.compactionId, bucket) }
        bucket.add(row)
      }
      dirty.add(row)
    }
    // This is only the bounded current-operation/live-request set, never all
    // settled requests. Changed identities find their exact native dependents.
    const transient = new Map([...cache.recent.values(), ...cache.active.values()].map(row => [row.key, row]))
    const byEvent = new Map<number, CacheRecord>(), byCompaction = new Map<string, CacheRecord>()
    const affect = (row: CacheRecord) => {
      if (row.kind !== 'request') return
      if (typeof row.data.eventSeq === 'number') { const source = cache.byEvent.get(row.data.eventSeq); if (source) dirty.add(source) }
      if (typeof row.data.compactionId === 'string') for (const source of cache.byCompaction.get(row.data.compactionId) ?? []) dirty.add(source)
    }
    for (const [key, previous] of cache.diagnostics) if (transient.get(key) !== previous) { affect(previous); cache.feed.delete(`live:${key}`) }
    for (const [key, row] of transient) {
      if (cache.diagnostics.get(key) !== row) affect(row)
      if (row.kind === 'request') {
        if (typeof row.data.eventSeq === 'number') byEvent.set(row.data.eventSeq, row)
        if (typeof row.data.compactionId === 'string') byCompaction.set(row.data.compactionId, row)
      }
      const settled = row.kind === 'request' && (typeof row.data.eventSeq === 'number' && cache.byEvent.has(row.data.eventSeq)
        || typeof row.data.compactionId === 'string' && cache.byCompaction.has(row.data.compactionId))
      if (settled) cache.feed.delete(`live:${key}`)
      else cache.feed.set(`live:${key}`, row)
    }
    for (const row of dirty) {
      const diagnostic = byEvent.get(row.data.eventSeq) ?? (row.data.compactionId ? byCompaction.get(row.data.compactionId) : undefined)
      const cached = cache.publicRows.get(row)
      if (cached && cached.diagnostic === diagnostic) continue
      const { sourceHeader: _sourceHeader, ...facts } = row.data
      const value = { ...row, data: { ...diagnostic?.data, ...facts } }
      cache.publicRows.set(row, { diagnostic, value }); cache.feed.set(`native:${row.data.eventSeq}`, value)
      logs.cache.worked(cacheKey)
    }
    cache.diagnostics = transient; cache.syncedRevision = cache.revision
    return cache.feed
  }
  function listOne(session: Session): readonly CacheRecord[] { return diagnosticFeed(session).snapshot() }
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
    /** Production pages consume exact coalesced changes, not a full sorted snapshot. */
    diagnosticFeed(sessionId: string) {
      const session = getSession(sessionId)
      if (!session) throw new Error(`context-care: request session unavailable: ${sessionId}`)
      return diagnosticFeed(session)
    },
    /** Rewrite diagnostics are bounded maintenance rows, not native settlements.
     * Reading them must not initialize or enumerate the full request directory. */
    rewriteRecords(sessionId?: string): readonly unknown[] {
      const selected = sessionId === undefined ? sessions.list() : [getSession(sessionId)].filter((session): session is Session => session !== undefined)
      const values: unknown[] = []
      for (const session of selected) for (const row of cacheOf(session).recent.values()) {
        if (row.kind === 'maintenance' && row.data.action === 'request-rewrite' && row.data.rewrite !== undefined) values.push(row.data.rewrite)
      }
      return values
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
