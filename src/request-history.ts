import type { Session, SessionEvent, SessionSeq, EpochHeader } from '@deepseek-ai/dsh-session'
import type { TokenUsage, LlmCallConfig, AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction'
import { requestDecision } from './request-replay.js'
import type { SessionLog } from './session-log.js'
import type { CacheKey } from './session-cache.js'
import { createHash } from 'node:crypto'

/** Request settlement facts read from the Session, not a second durable ledger. */
export interface SessionRequestRecord {
  key: string
  version: 1
  sessionId: string
  kind: 'request'
  at: number
  data: {
    callId: string
    logRevision: number
    dispatchOrder: number
    purpose: 'conversation' | 'compaction'
    compactionId?: string
    phase: 'settled'
    /** Absent when a failed attempt does not establish that the provider was entered. */
    dispatched?: boolean
    outcome: 'completed' | 'interrupted' | 'failed'
    eventSeq: SessionSeq
    eventType: 'assistant/message' | 'assistant/attempt' | 'compaction/summary'
    route?: LlmCallConfig
    sourceHeader?: EpochHeader
    usage?: TokenUsage
    promptDecision?: NonNullable<NonNullable<ReturnType<typeof requestDecision>>['prompt']> & { seq: number }
    workbenchDecision?: NonNullable<ReturnType<typeof requestDecision>>['workbench']
  }
}

interface CalibrationBucket {
  /** Only actual eligible settlements, newest candidates consumed lazily on query. */
  pending: SessionRequestRecord[]
  indexed: Map<string, SessionRequestRecord>
}
interface Projection {
  through: number
  header?: EpochHeader
  requests: SessionRequestRecord[]
  keys: Set<string>
  events: Set<number>
  compactions: Set<string>
  previous: Map<string, SessionRequestRecord>
  calibration: Map<string | undefined, CalibrationBucket>
  prompt?: NonNullable<NonNullable<ReturnType<typeof requestDecision>>['prompt']> & { seq: number }
  workbench?: NonNullable<ReturnType<typeof requestDecision>>['workbench']
}

// Definitions contain no Host values. Native owners and all stored values live in
// the same manager, including header hashes shared by separate query facades.
const requestHistoryKey: CacheKey<Session, Projection> = { name: 'request-history',
  validity: 'Native Session identity; consumes only relevant events beyond its successful cursor.',
  create: () => ({ through: 0, requests: [], keys: new Set(), events: new Set(), compactions: new Set(), previous: new Map(), calibration: new Map() }) }
const headerHashKey: CacheKey<EpochHeader, { value?: string }> = { name: 'request-header-hash',
  validity: 'Exact immutable native request header identity.', create: () => ({}) }
const toolHeaderHashesKey: CacheKey<NonNullable<EpochHeader['tools']>, { config?: string; value?: string }> = { name: 'request-tool-header-hashes',
  validity: 'Immutable tool catalog identity; only the latest requested configuration is retained.', create: () => ({}) }
const calibrationQueryKey: CacheKey<Session, undefined> = { name: 'request-calibration-selection',
  validity: 'Actual configuration buckets; each queried candidate header is indexed at most once, newest first.', create: () => undefined }
const emptyHeaderKey = createHash('sha256').update('{}').digest('hex')

/** A received non-error chunk establishes a stream; an error alone does not establish handoff. */
function receivedOutput(stream: readonly AssistantStreamRecord[]): boolean {
  return stream.some(record => record.type !== 'chunk'
    || (record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop'))
}

function requestRecord(sessionId: string, event: SessionEvent, header: EpochHeader | undefined): SessionRequestRecord | undefined {
  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    const completed = event.type === 'assistant/message' && !event.data.interrupted
    const callId = `session:${sessionId}:request:${event.seq}`
    return { key: `call_${callId}`, version: 1, sessionId, kind: 'request', at: event.time,
      data: { callId, logRevision: event.seq, dispatchOrder: event.seq, purpose: 'conversation', phase: 'settled',
        ...(completed || receivedOutput(event.data.stream) ? { dispatched: true } : {}),
        outcome: completed ? 'completed' : event.type === 'assistant/message' ? 'interrupted' : 'failed',
        eventSeq: event.seq, eventType: event.type,
        ...(header === undefined ? {} : { route: header.config, sourceHeader: header }),
        ...(event.type === 'assistant/message' && event.data.usage !== undefined ? { usage: event.data.usage } : {}) } }
  }
  if (event.type === 'compaction/summary' && event.data.llmStreamCall === true) {
    const callId = `session:${sessionId}:compaction:${event.data.compactionId}`
    return { key: `call_${callId}`, version: 1, sessionId, kind: 'request', at: event.time,
      data: { callId, logRevision: event.seq, dispatchOrder: event.seq, purpose: 'compaction', phase: 'settled',
        dispatched: true, outcome: 'completed', eventSeq: event.seq, eventType: event.type, compactionId: event.data.compactionId,
        route: { provider: event.data.provider, model: event.data.model },
        ...(event.data.usage === undefined ? {} : { usage: event.data.usage }) } }
  }
  return undefined
}

/**
 * Own a disposable incremental request index. Cached rows reference immutable log
 * values; no request body, tool schema, or header is serialized into another file.
 * @returns Session-scoped read and release operations.
 */
export function createRequestHistory(logs: SessionLog) {
  /** Header wrappers may be fresh while their immutable tool catalog is shared. */
  function headerKey(header: EpochHeader | undefined): string {
    if (!header) return emptyHeaderKey
    const cached = logs.cache.use(header, headerHashKey)
    if (cached.value !== undefined) return cached.value
    const config = JSON.stringify(header.config)
    const catalogs = header.tools === undefined ? undefined : logs.cache.use(header.tools, toolHeaderHashesKey)
    let key = catalogs?.config === config ? catalogs.value : undefined
    if (key === undefined) {
      key = createHash('sha256').update(JSON.stringify({ config: header.config, tools: header.tools })).digest('hex')
      if (catalogs) { catalogs.config = config; catalogs.value = key }
      logs.cache.worked(headerHashKey)
    }
    return cached.value = key
  }
  const service = {
    headerKey,
    /** Read settled requests, consuming only events appended since the last read. */
    read(session: Session): readonly SessionRequestRecord[] {
      using log = logs.live(session)
      const state = logs.cache.use(session, requestHistoryKey)
      // Range/type indexes are shared with diagnostics and the workbench. A
      // second consumer never takes another native snapshot or re-reads events.
      try {
        for (const event of log.select(['request/header', 'step/start', 'assistant/message', 'assistant/attempt', 'compaction/summary'], state.through)) {
          if (event.type === 'request/header') state.header = event.data.header
          if (event.type === 'step/start') { state.prompt = undefined; state.workbench = undefined }
          const decision = requestDecision(event)
          if (decision?.prompt) state.prompt = { ...decision.prompt, seq: decision.seq }
          state.workbench = decision?.workbench ?? state.workbench
          const request = requestRecord(String(session.id), event, state.header)
          if (request) {
            const loggedId = state.prompt?.callId ?? state.workbench?.callId
            if (loggedId) { request.data.callId = loggedId; request.key = `call_${loggedId}` }
            if (state.prompt) request.data.promptDecision = state.prompt
            if (state.workbench) request.data.workbenchDecision = state.workbench
            state.requests.push(request)
            state.keys.add(request.key); state.events.add(request.data.eventSeq)
            if (request.data.compactionId !== undefined) state.compactions.add(request.data.compactionId)
            if (request.data.dispatched) state.previous.set(request.data.purpose, request)
            if (request.data.purpose === 'conversation' && request.data.outcome === 'completed'
              && request.data.usage?.inputTokens !== undefined) {
              const configuration = JSON.stringify(request.data.sourceHeader?.config)
              let bucket = state.calibration.get(configuration)
              if (!bucket) { bucket = { pending: [], indexed: new Map() }; state.calibration.set(configuration, bucket) }
              bucket.pending.push(request)
            }
            state.prompt = undefined; state.workbench = undefined
          }
          state.through = event.seq + 1
          logs.cache.worked(requestHistoryKey)
        }
        state.through = log.length
        return state.requests
      } catch (error) { logs.cache.invalidate(session, requestHistoryKey); throw error }
    },
    /** One native settlement lookup, without searching the full request array per diagnostic. */
    contains(session: Session, row: { key: string; data: Readonly<Record<string, unknown>> }): boolean {
      const state = logs.cache.use(session, requestHistoryKey)
      return state.keys.has(row.key) || typeof row.data.eventSeq === 'number' && state.events.has(row.data.eventSeq)
        || typeof row.data.compactionId === 'string' && state.compactions.has(row.data.compactionId)
    },
    previous(session: Session, purpose: string): SessionRequestRecord | undefined {
      service.read(session)
      return logs.cache.use(session, requestHistoryKey).previous.get(purpose)
    },
    /** Do not serialize every historical catalog merely to list requests. Each actual
     * configuration has one pending newest-first lane and a positive header index.
     * Unknown configurations allocate nothing; repeated negative queries do no fold work. */
    calibration(session: Session, header: EpochHeader | undefined): SessionRequestRecord | undefined {
      service.read(session)
      const bucket = logs.cache.use(session, requestHistoryKey).calibration.get(JSON.stringify(header?.config))
      if (!bucket) return undefined
      const expected = headerKey(header)
      let found = bucket.indexed.get(expected)
      for (;;) {
        const candidate = bucket.pending.at(-1)
        if (!candidate || found && candidate.data.eventSeq <= found.data.eventSeq) return found
        // Publish only after the immutable header has been successfully hashed.
        const key = headerKey(candidate.data.sourceHeader)
        const prior = bucket.indexed.get(key)
        if (!prior || prior.data.eventSeq < candidate.data.eventSeq) bucket.indexed.set(key, candidate)
        bucket.pending.pop(); logs.cache.worked(calibrationQueryKey)
        if (key === expected) found = bucket.indexed.get(key)
      }
    },
  }
  return service
}
