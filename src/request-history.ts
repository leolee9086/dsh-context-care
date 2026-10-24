import type { Session, SessionEvent, SessionSeq, EpochHeader } from '@deepseek-ai/dsh-session'
import type { TokenUsage, LlmCallConfig, AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction'
import { requestDecision } from './request-replay.js'

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

interface Projection {
  through: Session['seq']
  header?: EpochHeader
  requests: SessionRequestRecord[]
  prompt?: NonNullable<NonNullable<ReturnType<typeof requestDecision>>['prompt']> & { seq: number }
  workbench?: NonNullable<ReturnType<typeof requestDecision>>['workbench']
}

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
export function createRequestHistory() {
  let projections = new WeakMap<Session, Projection>()
  return {
    /** Read settled requests, consuming only events appended since the last read. */
    read(session: Session): readonly SessionRequestRecord[] {
      const previous = projections.get(session)
      const events = previous ? session.snapshotEvents(previous.through) : session.snapshotEvents()
      const state: Projection = previous ?? { through: session.seq, requests: [] }
      for (const event of events) {
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
          state.prompt = undefined; state.workbench = undefined
        }
      }
      state.through = session.seq
      projections.set(session, state)
      return state.requests
    },
    /** Drop derived rows; the next read reconstructs them from the same Session. */
    clear() { projections = new WeakMap() },
  }
}
