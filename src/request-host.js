import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { RequestBudgetExceeded } from './context-budget.js'
import { openRequestJournal, requestFingerprint } from './request-journal.js'
import { withScopedPrompts } from './scoped-prompts.js'
import { openOutputFeedback } from './output-feedback.js'
import { calibrationHeaderKey, journalCalibration } from './input-calibration.js'

export const name = 'context-care-requests'
export const inject = ['agents', 'sessions', 'tools', 'llm', 'tokenMeter', 'storageDomain']
export const Config = z.object({}).strict().prefault({})

/** Host owns durable dispatch facts; scoped controllers contribute one visible policy. */
export async function apply(ctx) {
  const journal = await openRequestJournal({ storageDomain: ctx.storageDomain,
    report: error => ctx.logger.warn(`context-care: request journal failed: ${error instanceof Error ? error.message : String(error)}`) })
  let feedback
  try { feedback = await openOutputFeedback(ctx.storageDomain) }
  catch (error) {
    await journal.close().catch(closeError => ctx.logger.warn(`context-care: journal rollback failed: ${String(closeError)}`))
    throw error
  }
  let dispatchOrder = journal.list().reduce((latest, record) => Math.max(latest, record.data.dispatchOrder ?? 0), 0)
  const owners = new Set()
  const calls = new Map()
  const byRequest = new WeakMap()
  const forwarded = new WeakMap()
  const listeners = []
  const reconciled = new WeakSet()
  function ownerFor(agent) {
    if (agent === undefined) return undefined
    return [...owners].find(owner => owner.owns(agent))
  }
  function persist(call, phase, details = {}) {
    const previous = call.record ?? { callId: call.callId, logRevision: call.logRevision, sourceSeqs: call.sourceSeqs,
      sourceHeader: call.measurement.pricingBasis.header, sourceMessagesHash: requestFingerprint(call.sourceMessages), purpose: call.original.purpose ?? 'conversation' }
    call.record = { ...previous, ...details, dispatched: call.dispatched, phase }
    return journal.put(`call_${call.callId}`, call.session.id, 'request', call.record)
  }
  const service = {
    register(owner) { owners.add(owner); return () => { owners.delete(owner); for (const [id, call] of calls) if (call.owner === owner) calls.delete(id) } },
    snapshot(callId) { return calls.get(callId) },
    release(callId) { const call = calls.get(callId); for (const [id, value] of calls) if (value === call) calls.delete(id) },
    settle(callId, details) { const call = calls.get(callId); return call === undefined ? Promise.resolve() : persist(call, 'settled', details) },
    recordAction(session, data) { const key = `action_${randomUUID()}`; return journal.put(key, session.id, 'maintenance', { logRevision: session.seq, ...data }) },
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
    list: journal.list, async flush(sessionId) { await journal.flush(sessionId); await feedback.flush(sessionId) },
  }
  ctx.provide('contextCareRequests', service)
  const on = (event, callback) => listeners.push(ctx.on(event, callback))
  on('llm/request-opened', ({ callId, original }) => {
    const parent = forwarded.get(original)
    if (parent !== undefined) {
      parent.terminalCallId = callId
      calls.set(callId, parent)
      return
    }
    const agent = original.sessionId === undefined ? undefined : ctx.agents.get(original.sessionId)
    const owner = ownerFor(agent)
    if (owner === undefined) return
    const session = agent.session
    // Synchronous capture precedes middleware and the lazy stream's first await.
    const measurement = ctx.tokenMeter.measureInput(session)
    const call = { callId, owner, agent, session,
      logRevision: measurement.logRevision, generation: session.surface.replaceGeneration,
      sourceSeqs: [...session.surface.nodes], sourceMessages: session.deriveMessages(), original, measurement, dispatched: false }
    calls.set(callId, call)
    byRequest.set(original, call)
  })
  on('llm/stream', async function* (request, next) {
    // Delegate once. Its lazy iterator has not dispatched anything yet. When
    // adding input, a new public call owns the new immutable request; it shares
    // this caller's lifecycle and cannot recursively compose the same segments.
    const delegated = next()
    const call = byRequest.get(request)
    if (call === undefined || forwarded.has(request)) { yield* delegated; return }
    const completion = ctx.get('contextCareCompletion')
    await service.flush(call.session.id)
    if (!reconciled.has(call.session)) {
      const settled = journal.list(call.session.id).filter(record => record.kind === 'request' && record.data.dispatched
        && record.data.outcome === 'completed' && record.data.purpose === 'conversation').sort((a, b) => a.data.eventSeq - b.data.eventSeq)
      for (const record of settled) {
        const event = call.session.eventAt(record.data.eventSeq)
        if (event?.type === 'assistant/message' && !event.data.interrupted) await feedback.observe(call.session, event, record.data.route, call.owner.promptRules ?? [])
      }
      await completion?.reconcile(call.session)
      reconciled.add(call.session)
    }
    await completion?.flush(call.session.id)
    if (call.owner.prompts === undefined && (completion?.collect(call.session, request).length ?? 0) === 0) { yield* delegated; return }
    const prepared = await ctx.llm.prepareCall(request, request.signal)
    const bound = { ...request, ...prepared.config }
    const { segments, request: composed } = service.preview(call.session, bound)
    if (segments.length === 0) { yield* delegated; return }
    // A request/header is already log-only. Keep its existing header intact,
    // adding plugin metadata that records the request-only text and route.
    // Surface-producing messages require a surface intent and cannot serve as
    // log-only records; these segments therefore never join summary history.
    const decision = call.session.append('request/header', {
      header: call.session.requestHeader() ?? { config: prepared.config, tools: request.tools }, reason: 'series',
      contextCarePrompt: { callId: call.callId, segments, message: composed.messages.at(-1) },
    })
    call.promptDecision = { seq: decision.seq, segments }
    forwarded.set(composed, call)
    yield* prepared.stream(composed)
  })
  on('llm/request-ready', async ready => {
    const call = calls.get(ready.callId)
    if (call === undefined) return
    if (ownerFor(call.agent) !== call.owner) { calls.delete(ready.callId); return }
    call.ready = ready
    call.dispatchBudget = await call.owner.check(call, ready)
    const request = ready.request
    await persist(call, 'ready', { route: { provider: request.provider, model: request.model, maxTokens: request.maxTokens,
      reasoningEffort: request.reasoningEffort, temperature: request.temperature },
      system: request.system, tools: request.tools,
      inputHash: requestFingerprint({ system: request.system, messages: request.messages, tools: request.tools }),
      pricingBasis: call.dispatchPricing?.pricingBasis, budget: call.dispatchBudget,
      rawInput: call.dispatchPricing?.decomposeRequest(request), calibrationHeaderKey: calibrationHeaderKey(call.dispatchPricing?.pricingBasis.header),
      terminalCallId: ready.callId, promptDecision: call.promptDecision })
    if (call.dispatchBudget.hardInput !== undefined && call.dispatchBudget.inputTokens > call.dispatchBudget.hardInput) throw new RequestBudgetExceeded(call.dispatchBudget)
    await feedback.reserve(call.session, call.promptDecision?.segments ?? [], call.callId)
    await ctx.get('contextCareCompletion')?.reserve(call.session, call.promptDecision?.segments ?? [], call.callId)
  })
  on('llm/request-dispatched', ready => {
    const call = calls.get(ready.callId)
    if (call === undefined) return
    call.dispatched = true
    // Emit cannot await durability. Ready is already durable; flush is the ACK
    // for this dispatched update and every subsequent settlement update.
    void persist(call, 'dispatched', { dispatchOrder: ++dispatchOrder })
    void feedback.dispatched(call.session, call.promptDecision?.segments ?? [], call.callId, ready.request)
      .catch(error => ctx.logger.warn(`context-care: feedback dispatch failed: ${String(error)}`))
    void ctx.get('contextCareCompletion')?.dispatched(call.session, call.promptDecision?.segments ?? [], call.callId, ready.request)
      .catch(error => ctx.logger.warn(`context-care: completion notice dispatch failed: ${String(error)}`))
    call.owner.dispatched?.(call)
  })
  on('agent/assistant-stream', ({ agent, frame }) => {
    const conversation = [...new Set(calls.values())].filter(call => call.agent === agent
      && ['conversation', undefined].includes(call.original.purpose))
    if (frame.type === 'start') {
      // opened is synchronous, before this start marker. Only the new call can
      // claim this occurrence; failed calls remain available for overflow proof.
      const call = conversation.findLast(call => call.attemptId === undefined)
      if (call !== undefined) call.attemptId = frame.attemptId
      return
    }
    if (frame.type !== 'end') return
    const call = conversation.find(call => call.attemptId === frame.attemptId)
    if (call === undefined || call.settled) return
    call.settled = true
    const event = frame.outcome.kind === 'committed' ? agent.session.eventAt(frame.outcome.seq) : undefined
    const completed = event?.type === 'assistant/message' && !event.data.interrupted
    void persist(call, 'settled', { attemptId: frame.attemptId,
      outcome: completed ? 'completed' : event?.type === 'assistant/attempt' ? 'failed' : 'interrupted',
      eventSeq: event?.seq, eventType: event?.type, usage: event?.data.usage })
    if (completed && call.dispatched && call.ready !== undefined) {
      void feedback.observe(call.session, event, call.record.route, call.owner.promptRules ?? [])
        .catch(error => ctx.logger.warn(`context-care: output observation failed: ${String(error)}`))
    }
    if (completed) service.release(call.callId)
  })
  on('agent/idle', ({ agent }) => {
    for (const [id, call] of calls) if (call.agent === agent) calls.delete(id)
  })
  ctx.effect(() => async () => {
    for (const dispose of listeners) dispose()
    try { await journal.close() } finally { try { await feedback.close() } finally { calls.clear(); owners.clear() } }
  })
}
