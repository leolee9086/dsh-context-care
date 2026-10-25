import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, EpochHeader } from '@deepseek-ai/dsh-session'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { requestDecision } from './request-replay.js'
import type { SessionLog } from './session-log.js'
import type { CacheKey } from './session-cache.js'

export interface Route { provider: string; model: string }
export interface DetectorBounds {
  windowOutputs: number
  cooldownCompletedOutputs: number
  rearmHealthyOutputs: number
  maxDeliveries: number
}
export interface FeedbackRule<D> extends Route {
  ruleId: string
  version: string
  trigger: string
  text: string
  detector?: D
  carryFromOtherRoute?: boolean
}
export interface FeedbackMetrics {
  status: string
  H?: number
  K?: number
  N?: number
  evidence?: readonly { text: string }[]
}
type Sample<M> = M & { seq: number }
type Measured<M> = Sample<M> & { H: number; K: number; N: number; evidence: readonly { text: string }[] }
interface Pending<M> {
  segmentId: string
  sourceSeqs: number[]
  sample: Measured<M>
  trigger: string
  deliveries: number
  maxDeliveries: number
}
interface Delivery { segmentId: string; callId: string; status: string; attempts?: number; exhausted?: boolean }
export interface Episode<M> {
  version: 1
  sessionId: string
  ruleId: string
  ruleVersion: string
  specHash: string
  route: Route
  lastSeq: number
  completed: number
  cooldownUntil: number
  healthy: number
  window: Sample<M>[]
  pending?: Pending<M>
  lastDelivery?: Delivery
}
interface Receipt { callId: string; keys: Set<string> }
interface Projection<M> {
  /** Next event index; converted to a native position only below session.seq. */
  through: number
  header?: EpochHeader
  prompt?: Receipt
  receipts: Set<string>
  episodes: Map<string, Episode<M>>
}
export interface Segment<M> extends Route {
  ruleId: string
  version: string
  trigger: 'output-pattern'
  purpose: 'conversation'
  text: string
  segmentId: string
  sourceRoute: Route
  sourceSeqs: number[]
  metrics: Sample<M>
  feedbackKey: string
}
interface Options<D, M> {
  sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>
  logs: SessionLog
  detect(text: string, config: D): M
  trigger(sample: Sample<M>, window: readonly Sample<M>[], config: D): string | undefined
  rulesFor(sessionId: string): readonly FeedbackRule<D>[]
  eligible(sessionId: string, ruleId: string, seqs: number[]): boolean
  revision(sessionId: string): number
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const keyFor = (sessionId: string, rule: unknown) => fingerprint({ sessionId, rule })
const sameRoute = (left: Route, right: Route) => left.provider === right.provider && left.model === right.model
function receivedOutput(stream: readonly AssistantStreamRecord[]) {
  return stream.some(record => record.type !== 'chunk'
    || record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop')
}
function requireMeasured<M extends FeedbackMetrics>(sample: Sample<M>): asserts sample is Measured<M> {
  if (sample.status !== 'measured' || typeof sample.H !== 'number' || typeof sample.K !== 'number'
    || typeof sample.N !== 'number' || !Array.isArray(sample.evidence)) {
    throw new Error('context-care: output trigger requires measured native evidence')
  }
}

/**
 * Derive output-pattern episodes from successful native output and actual request inputs.
 * The only live-only state coordinates preparation; no feedback domain is opened.
 * @param options - existing Session service, rule definitions and deterministic parser.
 * @returns the request contribution and disposable native projection owner.
 */
export function createSessionOutputFeedback<D extends DetectorBounds, M extends FeedbackMetrics>(options: Options<D, M>) {
  const stateKey: CacheKey<Session, Projection<M>> = options.logs.cache.define('output-feedback',
    'Native Session identity; rule signature, settings revision and committed event cursor.', () => ({
      through: 0, receipts: new Set(), episodes: new Map(),
    }))
  const reservations = new Map<string, { sessionId: string; keys: Set<string> }>()

  function apply(state: Projection<M>, session: Session, event: SessionEvent, rules: readonly FeedbackRule<D>[]) {
    if (event.type === 'request/header') state.header = event.data.header
    if (event.seq < session.inheritedEventCount) return
    if (event.type === 'step/start') state.prompt = undefined
    const decision = requestDecision(event)
    if (decision?.prompt) {
      const prompt = decision.prompt
      const keys = new Set<string>()
      const duplicate = state.receipts.has(prompt.callId)
      for (const segment of prompt.segments) {
        if (typeof segment.feedbackKey !== 'string' || !Array.isArray(segment.sourceSeqs) || keys.has(segment.feedbackKey)) continue
        const episode = state.episodes.get(segment.feedbackKey), pending = episode?.pending
        // The logged source positions identify the episode even for older random segment ids.
        if (!episode || !pending || JSON.stringify(segment.sourceSeqs) !== JSON.stringify(pending.sourceSeqs)) continue
        keys.add(segment.feedbackKey)
        if (duplicate) continue
        pending.deliveries++
        episode.lastDelivery = { segmentId: pending.segmentId, callId: prompt.callId,
          status: 'delivery-unknown', attempts: pending.deliveries }
      }
      state.prompt = { callId: prompt.callId, keys }
      if (keys.size) state.receipts.add(prompt.callId)
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return
    const prompt = state.prompt
    state.prompt = undefined
    const completed = event.type === 'assistant/message' && !event.data.interrupted
    const route = state.header?.config
    if (!route) return
    if (completed || receivedOutput(event.data.stream)) {
      for (const [key, episode] of state.episodes) {
        const pending = episode.pending
        if (!pending || episode.lastSeq >= event.seq) continue
        if (prompt?.keys.has(key)) {
          episode.lastDelivery = { ...episode.lastDelivery, segmentId: pending.segmentId, callId: prompt.callId, status: 'dispatched' }
          delete episode.pending
        } else if (!sameRoute(episode.route, route)) {
          episode.lastDelivery = { segmentId: pending.segmentId, callId: prompt?.callId ?? `session:${session.id}:request:${event.seq}`, status: 'superseded' }
          delete episode.pending
        }
      }
    }
    if (!completed || event.type !== 'assistant/message') return
    const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
    for (const rule of rules) {
      const detector = rule.detector
      if (rule.trigger !== 'output-pattern' || !detector || !sameRoute(rule, route)
        || !options.eligible(String(session.id), rule.ruleId, [event.seq])) continue
      const key = keyFor(String(session.id), rule)
      let episode = state.episodes.get(key)
      if (!episode) {
        episode = { version: 1, sessionId: String(session.id), ruleId: rule.ruleId, ruleVersion: rule.version,
          specHash: fingerprint(detector), route: { provider: route.provider, model: route.model },
          lastSeq: event.seq, completed: 0, cooldownUntil: 0, healthy: 0, window: [] }
        state.episodes.set(key, episode)
      }
      const sample: Sample<M> = { ...options.detect(text, detector), seq: event.seq }
      episode.lastSeq = event.seq
      episode.completed++
      episode.window = [...episode.window, sample].slice(-detector.windowOutputs)
      const trigger = options.trigger(sample, episode.window, detector)
      if (episode.pending && episode.pending.deliveries >= episode.pending.maxDeliveries) {
        if (episode.lastDelivery) episode.lastDelivery.exhausted = true
        delete episode.pending
      }
      episode.healthy = sample.status === 'measured' && sample.K === 0 ? episode.healthy + 1 : 0
      if (episode.healthy >= detector.rearmHealthyOutputs) episode.cooldownUntil = 0
      if (trigger !== undefined && !episode.pending && episode.completed > episode.cooldownUntil) {
        requireMeasured(sample)
        const sourceSeqs = trigger === 'window' ? episode.window.map(value => value.seq) : [event.seq]
        episode.pending = { segmentId: fingerprint({ key, sourceSeqs }), sourceSeqs, sample, trigger,
          deliveries: 0, maxDeliveries: detector.maxDeliveries }
        episode.cooldownUntil = episode.completed + detector.cooldownCompletedOutputs
      }
    }
  }
  function read(session: Session, rules = options.rulesFor(String(session.id))) {
    const signature = fingerprint({ rules, revision: options.revision(String(session.id)) })
    const state = options.logs.cache.use(session, stateKey, [signature])
    // With no output detector there is no episode to reconstruct. Adding one
    // changes the signature and starts a fresh fold from the native history.
    if (!rules.some(rule => rule.trigger === 'output-pattern')) {
      state.through = session.seq
      return state
    }
    try {
      using log = options.logs.live(session)
      for (const event of log.select(['request/header', 'step/start', 'assistant/message', 'assistant/attempt'], state.through)) {
        apply(state, session, event, rules)
        state.through = event.seq + 1
        options.logs.cache.worked(stateKey)
      }
      state.through = log.length
      return state
    } catch (error) {
      // Parser failures must not publish partial counters; the next read replays native facts.
      options.logs.cache.invalidate(session, stateKey)
      throw error
    }
  }
  function selected(sessionId?: string) {
    if (sessionId === undefined) return options.sessions.list()
    const session = options.sessions.get(sessionId as Session['id'])
    return session ? [session] : []
  }
  return {
    /** Canonical output already exists in Session; callback copies cannot change it. */
    async observe(session: Session, _event: SessionEvent, _route: unknown, rules: readonly FeedbackRule<D>[]) { read(session, rules) },
    collect(session: Session, request: Route & { purpose?: string }, rules: readonly FeedbackRule<D>[]): Segment<M>[] {
      if ((request.purpose ?? 'conversation') !== 'conversation') return []
      const state = read(session, rules), segments: Segment<M>[] = [], used = new Set<string>()
      const held = new Set([...reservations.values()].filter(value => value.sessionId === String(session.id)).flatMap(value => [...value.keys]))
      for (const rule of rules) {
        if (rule.trigger !== 'output-pattern' || !sameRoute(rule, request)) continue
        const ownKey = keyFor(String(session.id), rule)
        for (const [key, episode] of state.episodes) {
          if (key !== ownKey && !(rule.carryFromOtherRoute && !sameRoute(episode.route, request))) continue
          const pending = episode.pending
          if (!pending || pending.deliveries >= pending.maxDeliveries || used.has(key) || held.has(key)
            || !options.eligible(String(session.id), rule.ruleId, pending.sourceSeqs)) continue
          used.add(key)
          const values = { boundModelLabel: `${request.provider}/${request.model}`, sourceModel: `${episode.route.provider}/${episode.route.model}`,
            H: pending.sample.H, K: pending.sample.K, N: pending.sample.N, examples: pending.sample.evidence.map(hit => `“${hit.text}”`).join('、') }
          let text = rule.text
          for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value))
          segments.push({ ruleId: rule.ruleId, version: rule.version, trigger: 'output-pattern', provider: request.provider, model: request.model,
            purpose: 'conversation', text, segmentId: pending.segmentId, sourceRoute: { ...episode.route }, sourceSeqs: [...pending.sourceSeqs],
            metrics: structuredClone(pending.sample), feedbackKey: key })
        }
      }
      return segments
    },
    async reserve(session: Session, segments: readonly { feedbackKey?: string }[], callId: string) {
      reservations.set(callId, { sessionId: String(session.id), keys: new Set(segments.flatMap(segment => segment.feedbackKey ? [segment.feedbackKey] : [])) })
    },
    async rollback(_session: Session, callId: string) { reservations.delete(callId) },
    async dispatched(session: Session, _segments: readonly { feedbackKey?: string }[], callId: string, _request?: Route) {
      reservations.delete(callId)
      read(session)
    },
    async flush(sessionId?: string) { await Promise.all(selected(sessionId).map(session => options.sessions.flush(session))) },
    list(sessionId?: string) { return selected(sessionId).flatMap(session => [...read(session).episodes.values()].map(value => structuredClone(value))) },
    clear() { options.logs.cache.clear(stateKey); reservations.clear() },
    async close() { options.logs.cache.clear(stateKey); reservations.clear() },
  }
}
