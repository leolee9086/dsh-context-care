import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, EpochHeader } from '@deepseek-ai/dsh-session'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { requestDecision } from './request-replay.js'
import type { SessionLog } from './session-log.js'
import type { CacheKey } from './session-cache.js'

interface Route { provider: string; model: string }
interface Candidate { label: string; line: string }
export interface CompletionRequest extends Route { purpose?: string }
/** An observation of wording, not a declaration that the underlying task is complete. */
export interface CompletionNotice extends Candidate {
  sessionId: string
  eventSeq: number
  route: Route
  deliveries: number
  maxDeliveries: number
  status: 'pending' | 'delivery-unknown' | 'dispatched' | 'superseded'
  callId?: string
}
/** Exact prompt input; the request Host commits this segment with its real header. */
export interface CompletionSegment extends Route {
  ruleId: 'completion-observation'
  version: '1'
  trigger: 'completion'
  purpose: 'conversation'
  sourceSeqs: number[]
  completionKey: string
  text: string
}
interface Receipt {
  callId: string
  keys: Set<string>
}
interface Projection {
  through: Session['seq']
  since: number
  header?: EpochHeader
  lastCompletedAt?: number
  notices: Map<string, CompletionNotice>
  receipts: Map<string, Receipt>
  prompt?: Receipt
}
interface Options {
  logs: SessionLog
  sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>
  cooldownMs: number
  maxObservedChars: number
  maxDeliveries: number
  active: (session: Session) => boolean
  since: (session: Session) => number
  parse: (text: string) => Candidate | undefined
}

function keyOf(sessionId: string, eventSeq: number) {
  return createHash('sha256').update(JSON.stringify({ sessionId, eventSeq })).digest('hex')
}
function receivedOutput(stream: readonly AssistantStreamRecord[]) {
  return stream.some(record => record.type !== 'chunk'
    || record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop')
}
function sameRoute(left: Route, right: Route) {
  return left.provider === right.provider && left.model === right.model
}

/**
 * Derive completion wording, cooldown and delivery from native Session facts.
 * Reservations only serialize live request preparation; no domain file is read or written.
 * @param options - native sessions, rule settings and bounded wording parser.
 * @returns the completion request contribution and disposable projection owner.
 */
export function createSessionCompletions(options: Options) {
  const stateKey: CacheKey<Session, Projection> = options.logs.cache.define('completion-projection',
    'Native Session identity and completion-control since-seq; only committed relevant events advance the projection.',
    (_session, [since]) => {
      if (typeof since !== 'number') throw new Error('context-care: completion projection requires since-seq')
      return { through: 0 as Session['seq'], since, notices: new Map(), receipts: new Map() }
    })
  const reservations = new Map<string, { sessionId: string; keys: Set<string> }>()
  const stateOf = (session: Session) => options.logs.cache.use(session, stateKey, [options.since(session)])

  function apply(state: Projection, session: Session, event: SessionEvent) {
    if (event.type === 'request/header') state.header = event.data.header
    // A fork inherits readable text, not its parent's local observation cooldown.
    if (event.seq < session.inheritedEventCount) return
    if (event.type === 'step/start') state.prompt = undefined
    const decision = requestDecision(event)
    if (decision?.prompt) {
      const keys = new Set(decision.prompt.segments.flatMap(segment =>
        segment.ruleId === 'completion-observation' && typeof segment.completionKey === 'string'
          ? [segment.completionKey] : []))
      const receipt = { callId: decision.prompt.callId, keys }
      state.receipts.set(receipt.callId, receipt)
      state.prompt = receipt
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return
    const prompt = state.prompt
    state.prompt = undefined
    const completed = event.type === 'assistant/message' && !event.data.interrupted
    if (prompt?.keys.size && (completed || receivedOutput(event.data.stream)) && state.header) {
      for (const [key, notice] of state.notices) {
        if (notice.eventSeq >= event.seq || !sameRoute(notice.route, state.header.config)
          || notice.status === 'dispatched' || notice.status === 'superseded') continue
        notice.status = prompt?.keys.has(key) ? 'dispatched' : 'superseded'
        if (prompt?.keys.has(key)) notice.callId = prompt.callId
      }
    }
    if (!completed || event.type !== 'assistant/message' || !state.header || event.seq <= state.since) return
    let length = 0
    const parts: string[] = []
    for (const block of event.data.message.content) {
      if (block.type !== 'text') continue
      length += block.text.length + (parts.length ? 2 : 0)
      if (length > options.maxObservedChars) return
      parts.push(block.text)
    }
    const candidate = options.parse(parts.join('\n\n'))
    if (!candidate || (state.lastCompletedAt !== undefined && event.time < state.lastCompletedAt + options.cooldownMs)) return
    state.lastCompletedAt = event.time
    state.notices.set(keyOf(String(session.id), event.seq), {
      sessionId: String(session.id), eventSeq: event.seq,
      route: { provider: state.header.config.provider, model: state.header.config.model },
      ...candidate, deliveries: 0, maxDeliveries: options.maxDeliveries, status: 'pending',
    })
  }

  function read(session: Session): Projection {
    const state = stateOf(session)
    using log = options.logs.live(session)
    try {
      for (const event of log.select(['request/header', 'step/start', 'assistant/message', 'assistant/attempt'], state.through)) {
        apply(state, session, event)
        state.through = (event.seq + 1) as Session['seq']
      }
      state.through = log.length as Session['seq']
      return state
    } catch (error) {
      options.logs.cache.invalidate(session, stateKey)
      throw error
    }
  }

  function notices(session: Session): Map<string, CompletionNotice> {
    const state = read(session)
    const result = new Map<string, CompletionNotice>()
    for (const [key, cached] of state.notices) {
      const matching = [...state.receipts.values()].filter(receipt => receipt.keys.has(key))
      result.set(key, { ...cached, route: { ...cached.route }, deliveries: matching.length,
        ...(matching.length && cached.status === 'pending' ? { status: 'delivery-unknown' as const,
          callId: matching[matching.length - 1].callId } : {}) })
    }
    return result
  }
  function selected(sessionId?: string) {
    if (sessionId === undefined) return options.sessions.list()
    const session = options.sessions.get(sessionId as Session['id'])
    return session ? [session] : []
  }

  return {
    /** Native persistence owns all durable work; this does not ACK a second store. */
    async flush(sessionId?: string) {
      await Promise.all(selected(sessionId).map(session => options.sessions.flush(session)))
    },
    async reconcile(session: Session) { if (options.active(session)) read(session) },
    collect(session: Session, request: CompletionRequest): CompletionSegment[] {
      if (!options.active(session) || (request.purpose ?? 'conversation') !== 'conversation') return []
      const held = new Set([...reservations.values()].filter(value => value.sessionId === String(session.id))
        .flatMap(value => [...value.keys]))
      return [...notices(session)].filter(([key, notice]) => !held.has(key)
        && (notice.status === 'pending' || notice.status === 'delivery-unknown')
        && notice.deliveries < notice.maxDeliveries && sameRoute(notice.route, request))
        .sort((left, right) => right[1].eventSeq - left[1].eventSeq).slice(0, 1).map(([key, notice]) => ({
          ruleId: 'completion-observation', version: '1', trigger: 'completion',
          provider: request.provider, model: request.model, purpose: 'conversation',
          sourceSeqs: [notice.eventSeq], completionKey: key,
          text: `上一份输出使用了“${notice.label}”等完成表述。它是输出措辞的观察结果。请依据实际请求、交付内容和验证记录核对完成范围；若仍有已授权工作，继续完成。`,
        }))
    },
    async reserve(session: Session, segments: readonly { completionKey?: string }[], callId: string) {
      reservations.set(callId, { sessionId: String(session.id),
        keys: new Set(segments.flatMap(segment => segment.completionKey === undefined ? [] : [segment.completionKey])) })
    },
    async rollback(_session: Session, callId: string) { reservations.delete(callId) },
    async dispatched(session: Session, _segments: readonly { completionKey?: string }[], callId: string, _request: CompletionRequest) {
      reservations.delete(callId)
      read(session)
    },
    list(sessionId?: string): CompletionNotice[] {
      return selected(sessionId).filter(options.active).flatMap(session => [...notices(session).values()])
    },
    /** Release derived state; the next request reconstructs it from the same events. */
    clear() { options.logs.cache.clear(stateKey); reservations.clear() },
    close() { options.logs.cache.clear(stateKey); reservations.clear() },
  }
}
