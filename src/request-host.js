import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { RequestBudgetExceeded } from './context-budget.js'
import { captureInputPricing } from './input-pricing.js'
import { openRequestJournal, requestFingerprint } from './request-journal.js'
import { withScopedPrompts } from './scoped-prompts.js'
import { openOutputFeedback } from './output-feedback.js'
import { calibrationHeaderKey, journalCalibration } from './input-calibration.js'

export const name = 'context-care-requests'
export const inject = ['agents', 'sessions', 'tools', 'llm', 'tokenMeter', 'storageDomain']
export const Config = z.object({}).strict().prefault({})

/** Own request identities and journals using the official rc.2 stream waterfall. */
export async function apply(ctx) {
  const journal = await openRequestJournal({ storageDomain: ctx.storageDomain,
    report: error => ctx.logger.warn(`context-care: request journal failed: ${String(error)}`) })
  let feedback
  try { feedback = await openOutputFeedback(ctx.storageDomain) }
  catch (error) {
    await journal.close().catch(closeError => ctx.logger.warn(`context-care: journal rollback failed: ${String(closeError)}`))
    throw error
  }
  let dispatchOrder = journal.list().reduce((latest, record) => Math.max(latest, record.data.dispatchOrder ?? 0), 0)
  const owners = new Set()
  const calls = new Map()
  const preparedRequests = new WeakMap()
  const forwarded = new WeakMap()
  const attempts = new WeakMap()
  const reconciled = new WeakSet()
  const listeners = []
  const ownerFor = agent => agent === undefined ? undefined : [...owners].find(owner => owner.owns(agent))
  function persist(call, phase, details = {}) {
    const previous = call.record ?? { callId: call.callId, logRevision: call.logRevision, sourceSeqs: call.sourceSeqs,
      sourceHeader: call.measurement.pricingBasis.header, sourceMessagesHash: requestFingerprint(call.sourceMessages),
      purpose: call.original.purpose ?? 'conversation' }
    call.record = { ...previous, ...details, dispatched: call.dispatched, phase }
    return journal.put(`call_${call.callId}`, call.session.id, 'request', call.record)
  }
  const service = {
    register(owner) { owners.add(owner); return () => { owners.delete(owner); for (const [id, call] of calls) if (call.owner === owner) calls.delete(id) } },
    snapshot: callId => calls.get(callId),
    failed(agent) { return [...calls.values()].findLast(call => call.agent === agent && call.settled && call.failure !== undefined && ['conversation', undefined].includes(call.original.purpose)) },
    release: callId => calls.delete(callId),
    settle(callId, details) { const call = calls.get(callId); return call === undefined ? Promise.resolve() : persist(call, 'settled', details) },
    recordAction(session, data) { return journal.put(`action_${randomUUID()}`, session.id, 'maintenance', { logRevision: session.seq, ...data }) },
    // Auxiliary callers use this handle so their journal id never depends on a
    // nonexistent prepared.callId in the host. Each stream may be consumed once.
    async prepareCall(config, signal) {
      const prepared = await ctx.llm.prepareCall(config, signal)
      const callId = randomUUID()
      let consumed = false
      return Object.freeze({ ...prepared, callId, stream(request) {
        if (consumed) throw new Error('context-care: prepared request already consumed')
        consumed = true
        preparedRequests.set(request, { prepared, callId })
        // Enter the public waterfall before consuming the bound adapter handle.
        // The observer composes request-only text and dispatches this same handle.
        return ctx.llm.stream(request)
      } })
    },
    preview(session, request) {
      const owner = ownerFor(ctx.agents.get(session.id))
      const purpose = request.purpose ?? 'conversation'
      const previous = journal.list(session.id).filter(record => record.kind === 'request' && record.data.dispatched
        && record.data.purpose === purpose).sort((a, b) => (a.data.dispatchOrder ?? 0) - (b.data.dispatchOrder ?? 0)).at(-1)?.data.route
      const segments = [...(owner?.prompts?.(request, previous) ?? []), ...feedback.collect(session, request, owner?.promptRules ?? []),
        ...(ctx.get('contextCareCompletion')?.collect(session, request) ?? [])]
      return { segments, request: withScopedPrompts(request, segments) }
    },
    calibration: (session, header, fallback) => journalCalibration(journal.list(session.id), header, fallback),
    feedback: feedback.list,
    list: journal.list,
    async flush(sessionId) { await journal.flush(sessionId); await feedback.flush(sessionId) },
  }
  ctx.provide('contextCareRequests', service)
  const on = (event, callback) => listeners.push(ctx.on(event, callback))
  on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'start') { attempts.set(agent, frame.attemptId); return }
    if (frame.type !== 'end') return
    const call = [...calls.values()].findLast(call => call.agent === agent && call.attemptId === frame.attemptId)
    if (call === undefined) return
    call.settled = true
    const event = frame.outcome.kind === 'committed' ? agent.session.eventAt(frame.outcome.seq) : undefined
    const completed = event?.type === 'assistant/message' && !event.data.interrupted
    void persist(call, 'settled', { attemptId: frame.attemptId,
      outcome: completed ? 'completed' : event?.type === 'assistant/attempt' ? 'failed' : 'interrupted',
      eventSeq: event?.seq, eventType: event?.type, usage: event?.data.usage })
    if (completed && call.dispatched) {
      void feedback.observe(call.session, event, call.record.route, call.owner.promptRules ?? [])
        .catch(error => ctx.logger.warn(`context-care: output observation failed: ${String(error)}`))
    }
    if (completed) service.release(call.callId)
    attempts.delete(agent)
  })
  on('llm/stream', async function* (request, next) {
    // A forwarded prepared request re-enters this waterfall exactly once.
    // Calling next retains every other official middleware and its disposer.
    const delegated = next()
    if (forwarded.has(request)) { yield* delegated; return }
    const agent = request.sessionId === undefined ? undefined : ctx.agents.get(request.sessionId)
    const owner = ownerFor(agent)
    if (owner === undefined) { yield* delegated; return }
    const session = agent.session
    const handle = preparedRequests.get(request)
    const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session, requests: service })
    const call = { callId: handle?.callId ?? randomUUID(), owner, agent, session,
      logRevision: session.seq, generation: session.surface.replaceGeneration,
      sourceSeqs: [...session.surface.nodes], sourceMessages: session.deriveMessages(), original: request,
      measurement: pricing.measure(), dispatched: false,
      attemptId: ['conversation', undefined].includes(request.purpose) ? attempts.get(agent) : undefined }
    calls.set(call.callId, call)
    try {
      await service.flush(session.id)
      const completion = ctx.get('contextCareCompletion')
      if (!reconciled.has(session)) {
        const records = journal.list(session.id).filter(record => record.kind === 'request' && record.data.dispatched
          && record.data.outcome === 'completed' && record.data.purpose === 'conversation').sort((a, b) => a.data.eventSeq - b.data.eventSeq)
        for (const record of records) {
          const event = session.eventAt(record.data.eventSeq)
          if (event?.type === 'assistant/message' && !event.data.interrupted) await feedback.observe(session, event, record.data.route, owner.promptRules ?? [])
        }
        await completion?.reconcile(session)
        reconciled.add(session)
      }
      await completion?.flush(session.id)
      const prepared = handle?.prepared ?? await ctx.llm.prepareCall(request, request.signal)
      const bound = { ...request, ...prepared.config }
      const { segments, request: composed } = service.preview(session, bound)
      if (segments.length) {
        const decision = session.append('request/header', {
          header: session.requestHeader() ?? { config: prepared.config, ...(request.tools === undefined ? {} : { tools: request.tools }) }, reason: 'series',
          contextCarePrompt: { callId: call.callId, segments, message: composed.messages.at(-1) },
        })
        call.promptDecision = { seq: decision.seq, segments }
      }
      const model = await ctx.llm.resolveModelInfo(composed.provider, composed.model, request.signal)
      call.ready = { request: composed, model: { ...model, ...(prepared.context ? { context: prepared.context } : {}) },
        imageRequestPricing: ctx.llm.imageRequestPricing(composed.provider, composed.model) }
      call.dispatchBudget = await owner.check(call, call.ready)
      await persist(call, 'ready', { route: { provider: composed.provider, model: composed.model, maxTokens: composed.maxTokens,
        reasoningEffort: composed.reasoningEffort, temperature: composed.temperature }, system: composed.system, tools: composed.tools,
        inputHash: requestFingerprint({ system: composed.system, messages: composed.messages, tools: composed.tools }),
        pricingBasis: call.dispatchPricing.pricingBasis, budget: call.dispatchBudget,
        rawInput: call.dispatchPricing.decomposeRequest(composed), calibrationHeaderKey: calibrationHeaderKey(call.dispatchPricing.pricingBasis.header),
        promptDecision: call.promptDecision })
      if (call.dispatchBudget.hardInput !== undefined && call.dispatchBudget.inputTokens > call.dispatchBudget.hardInput) throw new RequestBudgetExceeded(call.dispatchBudget)
      await feedback.reserve(session, segments, call.callId)
      await completion?.reserve(session, segments, call.callId)
      // The official waterfall owns handoff to the bound stream, not adapter-
      // internal HTTP dispatch. The journal describes that handoff precisely.
      call.dispatched = true
      await persist(call, 'dispatched', { dispatchOrder: ++dispatchOrder, dispatchBasis: 'prepared-stream-handoff' })
      await feedback.dispatched(session, segments, call.callId, composed)
      await completion?.dispatched(session, segments, call.callId, composed)
      owner.dispatched?.(call)
      forwarded.set(composed, call)
      // Auxiliary calls retain the exact registration captured during planning;
      // composition changes messages only, never the prepared configuration.
      const stream = prepared.stream(composed)
      for await (const chunk of stream) {
        if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason.kind)) {
          call.failure = chunk.reason.failure
          await persist(call, 'failed', { failure: call.failure })
        }
        yield chunk
      }
    } catch (error) {
      // Budget failures must enter the ordinary request-error recovery path.
      // Storage and programming failures remain thrown, with their original stack.
      if (!(error instanceof RequestBudgetExceeded)) throw error
      call.failure = { code: error.code, message: error.message }
      await persist(call, 'failed', { failure: call.failure })
      yield { type: 'finish', reason: { kind: 'error', failure: call.failure } }
    }
  })
  on('agent/idle', ({ agent }) => {
    attempts.delete(agent)
    for (const [id, call] of calls) if (call.agent === agent) calls.delete(id)
  })
  ctx.effect(() => async () => {
    for (const dispose of listeners) dispose()
    try { await journal.close() } finally { try { await feedback.close() } finally { calls.clear(); owners.clear() } }
  })
}
