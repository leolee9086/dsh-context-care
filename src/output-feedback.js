import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { detectOutputPatterns, patternTrigger } from './output-patterns.js'
import { requestFingerprint } from './request-journal.js'

/** Feedback is plugin-owned durable state; no new Session event vocabulary is needed. */
export const OUTPUT_FEEDBACK_DOMAIN = {
  name: 'context_care_output_feedback', version: 1, layout: 'per-record',
  tables: { episodes: { valueSchema: z.object({ version: z.literal(1), sessionId: z.string(), ruleId: z.string(),
    ruleVersion: z.string(), specHash: z.string(), route: z.object({ provider: z.string(), model: z.string() }).strict(),
    lastSeq: z.number().int().nonnegative(), completed: z.number().int().nonnegative(),
    cooldownUntil: z.number().int().nonnegative(), healthy: z.number().int().nonnegative(),
    window: z.array(z.json()), pending: z.json().optional(), lastDelivery: z.json().optional(),
  }).strict() } },
}

function keyFor(sessionId, rule) { return requestFingerprint({ sessionId: String(sessionId), rule }) }

/** Open durable episodes, then serialize each session's observations and delivery decisions. */
export async function openOutputFeedback(storageDomain, { eligible = () => true } = {}) {
  const handle = await storageDomain.open(OUTPUT_FEEDBACK_DOMAIN)
  const table = handle.table('episodes')
  const states = new Map(table.entries())
  const queues = new Map()
  function enqueue(sessionId, run) {
    const task = (queues.get(String(sessionId)) ?? Promise.resolve()).then(run)
    queues.set(String(sessionId), task)
    return task
  }
  async function save(key, value) {
    const detached = JSON.parse(JSON.stringify(value))
    await table.put(key, detached)
    states.set(key, detached)
  }
  async function observe(session, event, route, rules) {
    return enqueue(session.id, async () => {
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
      for (const rule of rules) {
        if (rule.trigger !== 'output-pattern' || rule.provider !== route.provider || rule.model !== route.model
          || !eligible(String(session.id), rule.ruleId, [event.seq])) continue
        const key = keyFor(session.id, rule)
        const saved = states.get(key)
        const old = saved && eligible(String(session.id), rule.ruleId, [saved.lastSeq]) ? saved : undefined
        if (old?.lastSeq >= event.seq) continue
        const state = old === undefined ? { version: 1, sessionId: String(session.id), ruleId: rule.ruleId, ruleVersion: rule.version,
          specHash: requestFingerprint(rule.detector), route: { provider: route.provider, model: route.model },
          lastSeq: 0, completed: 0, cooldownUntil: 0, healthy: 0, window: [] } : structuredClone(old)
        const sample = { ...detectOutputPatterns(text, rule.detector), seq: event.seq }
        state.lastSeq = event.seq
        state.completed++
        state.window = [...state.window, sample].slice(-rule.detector.windowOutputs)
        const trigger = patternTrigger(sample, state.window, rule.detector)
        // An unknown delivery stops consuming this episode's replay allowance,
        // but cannot permanently block later independently completed evidence.
        if (state.pending?.deliveries >= state.pending?.maxDeliveries) {
          state.lastDelivery = { ...state.lastDelivery, exhausted: true }
          delete state.pending
        }
        // Unavailable output breaks the consecutive healthy-evidence run.
        state.healthy = sample.status === 'measured' && sample.K === 0 ? state.healthy + 1 : 0
        if (state.healthy >= rule.detector.rearmHealthyOutputs) state.cooldownUntil = 0
        if (trigger !== undefined && state.pending === undefined && state.completed > state.cooldownUntil) {
          state.pending = { segmentId: randomUUID(), sourceSeqs: trigger === 'window' ? state.window.map(value => value.seq) : [event.seq],
            sample, trigger, deliveries: 0, maxDeliveries: rule.detector.maxDeliveries }
          state.cooldownUntil = state.completed + rule.detector.cooldownCompletedOutputs
        }
        await save(key, state)
      }
    })
  }
  function collect(session, request, rules) {
    if ((request.purpose ?? 'conversation') !== 'conversation') return []
    const segments = []
    const selected = new Set()
    for (const rule of rules) {
      if (rule.trigger !== 'output-pattern' || rule.provider !== request.provider || rule.model !== request.model) continue
      const ownKey = keyFor(session.id, rule)
      const candidates = [...states].filter(([key, state]) => key === ownKey || (rule.carryFromOtherRoute
        && state.sessionId === String(session.id) && (state.route.provider !== request.provider || state.route.model !== request.model)))
      for (const [feedbackKey, state] of candidates) {
      const pending = state.pending
      if (pending === undefined || pending.deliveries >= pending.maxDeliveries || selected.has(feedbackKey)
         || !eligible(String(session.id), rule.ruleId, pending.sourceSeqs)) continue
      selected.add(feedbackKey)
      const values = { boundModelLabel: `${request.provider}/${request.model}`, sourceModel: `${state.route.provider}/${state.route.model}`,
        H: pending.sample.H, K: pending.sample.K, N: pending.sample.N,
        examples: pending.sample.evidence.map(hit => `“${hit.text}”`).join('、') }
      let text = rule.text
      for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value))
      segments.push({ ruleId: rule.ruleId, version: rule.version, trigger: 'output-pattern', provider: request.provider, model: request.model,
        purpose: 'conversation', text, segmentId: pending.segmentId, sourceRoute: state.route, sourceSeqs: pending.sourceSeqs,
        metrics: pending.sample, feedbackKey })
      }
    }
    return segments
  }
  const reservations = new Map()
  function reserve(session, segments, callId) {
    return enqueue(session.id, async () => {
      for (const segment of segments.filter(value => value.feedbackKey !== undefined)) {
        const state = structuredClone(states.get(segment.feedbackKey))
        if (state?.pending?.segmentId !== segment.segmentId) throw new Error('context-care: pending feedback changed before dispatch')
        const previous = reservations.get(callId) ?? new Map()
        previous.set(segment.feedbackKey, structuredClone(state))
        reservations.set(callId, previous)
        state.pending.deliveries++
        state.lastDelivery = { segmentId: segment.segmentId, callId, status: 'delivery-unknown', attempts: state.pending.deliveries }
        await save(segment.feedbackKey, state)
      }
    })
  }
  function rollback(session, callId) {
    // Only a caller that knows handoff never started may restore this snapshot.
    // Crash/restart loses it intentionally: unknown deliveries remain bounded.
    const restore = async () => {
      for (const [key, previous] of reservations.get(callId) ?? []) {
        const current = states.get(key)
        if (current?.lastDelivery?.callId === callId && current.lastDelivery.status === 'delivery-unknown') await save(key, previous)
      }
      reservations.delete(callId)
    }
    // A failed reservation is already reported by the caller. Still run repair
    // after that settled write, without poisoning the repair queue itself.
    const task = (queues.get(String(session.id)) ?? Promise.resolve()).then(restore, restore)
    queues.set(String(session.id), task)
    return task
  }
  function dispatched(session, segments, callId, request) {
    return enqueue(session.id, async () => {
      for (const segment of segments.filter(value => value.feedbackKey !== undefined)) {
        const state = structuredClone(states.get(segment.feedbackKey))
        if (state?.pending?.segmentId !== segment.segmentId) continue
        delete state.pending
        state.lastDelivery = { ...state.lastDelivery, callId, status: 'dispatched' }
        await save(segment.feedbackKey, state)
      }
      reservations.delete(callId)
      if ((request?.purpose ?? 'conversation') === 'conversation') {
        for (const [key, old] of states) {
          if (old.sessionId !== String(session.id) || old.pending === undefined || request === undefined
            || (old.route.provider === request.provider && old.route.model === request.model)) continue
          const state = structuredClone(old)
          state.lastDelivery = { segmentId: state.pending.segmentId, callId, status: 'superseded' }
          delete state.pending
          await save(key, state)
        }
      }
    })
  }
  async function flush(sessionId) {
    await Promise.all([...queues].filter(([id]) => sessionId === undefined || id === String(sessionId)).map(([, task]) => task))
  }
  return { observe, collect, reserve, rollback, dispatched, flush,
    list: sessionId => [...states.values()].filter(value => sessionId === undefined || value.sessionId === String(sessionId)),
    async close() { try { await flush() } finally { await handle.close() } } }
}
