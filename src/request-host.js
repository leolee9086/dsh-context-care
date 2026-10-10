import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { RequestBudgetExceeded } from './context-budget.js'
import { captureInputPricing } from './input-pricing.js'
import { openRequestJournal, requestFingerprint } from './request-journal.js'
import { withScopedPrompts } from './scoped-prompts.js'
import { requestCareInstructions } from './prompt-view-data.js'
import { openOutputFeedback } from './output-feedback.js'
import { calibrationHeaderKey, journalCalibration } from './input-calibration.js'
import { openRuleControls } from './rule-controls.js'
import { recordSecondaryFailure } from './secondary-failure.js'
import { releaseResources } from './resource-cleanup.js'
import { openWorkbenchHost } from './workbench-host.js'
import { MatcherFailure } from './bounded-matcher.js'

export const name = 'context-care-requests'
export const inject = ['agents', 'sessions', 'tools', 'llm', 'tokenMeter', 'storageDomain']
export const Config = z.object({ ruleFiles: z.array(z.string().min(1).max(4096)).max(64).default([]).refine(paths => new Set(paths).size === paths.length, 'duplicate rule file path'),
  executors: z.array(z.object({ executorRef: z.string().min(1), toolName: z.string().min(1), inputSchema: z.json(),
  requiresApproval: z.boolean().default(true), timeoutMs: z.number().int().min(1).max(86400000).default(10000),
  maxResultBytes: z.number().int().min(1).max(4194304).default(65536) }).strict()).max(64).default([]),
  maxCascadePasses: z.number().int().min(1).max(32).default(4),
  maxInjectedChars: z.number().int().min(1).max(1048576).default(65536),
  maxInjectedTokens: z.number().int().min(1).max(1048576).default(65536),
  maxCacheChangedBytes: z.number().int().min(0).max(33554432).optional(),
  maxRequestBytes: z.number().int().min(1).max(33554432).default(8388608),
  maxQueued: z.number().int().min(1).max(1000).default(128),
  maxConcurrent: z.number().int().min(1).max(64).default(8),
  maxDeltaChars: z.number().int().min(1).max(1048576).default(32768),
  maxDeltaBlocks: z.number().int().min(1).max(128).default(16),
  matcher: z.object({ timeoutMs: z.number().int().min(1).max(60000).default(250),
    startupMs: z.number().int().min(1).max(60000).default(10000),
    maxBytes: z.number().int().min(1).max(33554432).default(4194304),
    maxPending: z.number().int().min(1).max(64).default(4),
    maxIdle: z.number().int().min(0).max(64).default(2) }).strict().prefault({}),
  // Only an explicit requirement can stop dispatch on a failed request transformation.
  requiredStages: z.array(z.literal('request.assemble')).max(1).default([]),
}).strict().prefault({})

/** prepareCall clones its config. Keep native cancellation and request data out
 * of that clone; only the public LlmCallConfig fields belong in it. */
function callConfig(request) {
  return Object.fromEntries(['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens', 'stop']
    .filter(key => request[key] !== undefined).map(key => [key, request[key]]))
}

/** Own request identities and journals using the official rc.2 stream waterfall. */
export async function apply(ctx, config = {}) {
  const journal = await openRequestJournal({ storageDomain: ctx.storageDomain,
    report: error => ctx.logger.warn(`context-care: request journal failed: ${String(error)}`) })
  let controls
  let feedback
  try { feedback = await openOutputFeedback(ctx.storageDomain, { eligible: (id, ruleId, seqs) => controls === undefined
    || (controls.enabled(id, 'dsh-context-care', `prompt:${ruleId}`, 'notice')
      && seqs.every(seq => seq > controls.sinceSeq(id, 'dsh-context-care', `prompt:${ruleId}`))) }) }
  catch (error) {
    await journal.close().catch(closeError => ctx.logger.warn(`context-care: journal rollback failed: ${String(closeError)}`))
    throw error
  }
  try { controls = await openRuleControls(ctx.storageDomain, { boundary: id => (ctx.sessions.get(id)?.seq ?? 0) - 1 }) }
  catch (error) {
    for (const [label, resource] of [['feedback', feedback], ['journal', journal]]) {
      await resource.close().catch(closeError => ctx.logger.warn(`context-care: ${label} rollback failed: ${String(closeError)}`))
    }
    throw error
  }
  ctx.effect(() => () => controls.close())
  ctx.provide('contextCareControls', controls)
  let workbench
  try { workbench = await openWorkbenchHost(ctx, controls, Config.parse(config)) }
  catch (error) {
    for (const [label, resource] of [['controls', controls], ['feedback', feedback], ['journal', journal]]) {
      try { await resource.close() } catch (secondary) { recordSecondaryFailure(error, secondary, `workbench-open-${label}`) }
    }
    throw error
  }
  ctx.provide('contextCareWorkbench', workbench)
  ctx.effect(() => () => workbench.close())
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
  ctx.effect(() => controls.registerProvider(sessionId => ownerFor(ctx.agents.get(sessionId))?.controlSources?.(sessionId) ?? []))
  const service = {
    controls,
    register(owner) { owners.add(owner); return () => { owners.delete(owner); for (const [id, call] of calls) if (call.owner === owner) calls.delete(id) } },
    snapshot: callId => calls.get(callId),
    failed(agent) { return [...calls.values()].findLast(call => call.agent === agent && call.settled && call.failure !== undefined && ['conversation', undefined].includes(call.original.purpose)) },
    release: callId => calls.delete(callId),
    settle(callId, details) { const call = calls.get(callId); return call === undefined ? Promise.resolve() : persist(call, 'settled', details) },
    recordAction(session, data) { return journal.put(`action_${randomUUID()}`, session.id, 'maintenance', { logRevision: session.seq, ...data }) },
    // Auxiliary callers use this handle so their journal id never depends on a
    // nonexistent prepared.callId in the host. Each stream may be consumed once.
    async prepareCall(config, signal) {
      const prepared = await ctx.llm.prepareCall(callConfig(config), signal)
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
      const segments = [...(owner?.prompts?.({ ...request, sessionId: String(session.id) }, previous) ?? []), ...feedback.collect(session, request, owner?.promptRulesFor?.(session.id) ?? owner?.promptRules ?? []),
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
  on('tools/pre-execute', async (exec, next) => {
    const previous = await next()
    if (previous.kind !== 'allow') return previous
    return await workbench.beforeExecute(exec) ?? previous
  })
  on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind !== 'reject' && !signal.aborted) await workbench.preStep(agent, signal)
    return decision
  })
  // This awaited hook runs before turn/end, so output-triggered tools retain
  // an open turn for the official approval service and can deliver next-step input.
  on('agent/turn-stopping', async ({ agent, signal }) => { await workbench.preStep(agent, signal) })
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
      void feedback.observe(call.session, event, call.record.route, call.owner.promptRulesFor?.(call.session.id) ?? call.owner.promptRules ?? [])
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
    let completion
    let iterator
    let delta
    let reservationsStarted = false
    let primaryError
    try {
      await service.flush(session.id)
      completion = ctx.get('contextCareCompletion')
      if (!reconciled.has(session)) {
        const records = journal.list(session.id).filter(record => record.kind === 'request' && record.data.dispatched
          && record.data.outcome === 'completed' && record.data.purpose === 'conversation').sort((a, b) => a.data.eventSeq - b.data.eventSeq)
        for (const record of records) {
          const event = session.eventAt(record.data.eventSeq)
          if (event?.type === 'assistant/message' && !event.data.interrupted) await feedback.observe(session, event, record.data.route, owner.promptRulesFor?.(session.id) ?? owner.promptRules ?? [])
        }
        await completion?.reconcile(session)
        reconciled.add(session)
      }
      await completion?.flush(session.id)
      const prepared = handle?.prepared ?? await ctx.llm.prepareCall(callConfig(request), request.signal)
      const bound = { ...request, ...prepared.config }
      const controlRevision = controls.revision(String(session.id))
      const controlEpoch = controls.epoch(String(session.id), 'dsh-context-care', 'state')
      const { segments, request: promptRequest } = service.preview(session, bound)
      call.workbenchPlan = await workbench.assemble(agent, promptRequest)
      const composed = call.workbenchPlan.request
      if (call.workbenchPlan.records.length) {
        const decision = session.append('request/header', {
          header: session.requestHeader() ?? { config: prepared.config, ...(request.tools === undefined ? {} : { tools: request.tools }) }, reason: 'series',
          contextCareWorkbench: JSON.parse(JSON.stringify({ callId: call.callId, token: call.workbenchPlan.token, documents: call.workbenchPlan.documents,
            records: call.workbenchPlan.records, diff: call.workbenchPlan.diff,
            injectionBudget: call.workbenchPlan.injectionBudget, impact: call.workbenchPlan.impact })),
        })
        call.workbenchDecision = { seq: decision.seq, records: call.workbenchPlan.records, documents: call.workbenchPlan.documents }
      }
      if (segments.length) {
        const decision = session.append('request/header', {
          header: session.requestHeader() ?? { config: prepared.config, ...(request.tools === undefined ? {} : { tools: request.tools }) }, reason: 'series',
          contextCarePrompt: { callId: call.callId, segments, message: composed.messages.at(-1) },
        })
        call.promptDecision = { seq: decision.seq, segments, message: composed.messages.at(-1) }
      }
      const model = await ctx.llm.resolveModelInfo(composed.provider, composed.model, request.signal)
      call.ready = { request: composed, model: { ...model, ...(prepared.context ? { context: prepared.context } : {}) },
        imageRequestPricing: ctx.llm.imageRequestPricing(composed.provider, composed.model) }
      call.dispatchBudget = await owner.check(call, call.ready)
      const careInstructions = requestCareInstructions(composed)
      const summaryInstruction = careInstructions.find(instruction => instruction.kind === 'summary-instruction')
      const systemSeq = call.sourceSeqs.find(seq => session.eventAt(seq)?.type === 'system/message')
      await persist(call, 'ready', { route: { provider: composed.provider, model: composed.model, maxTokens: composed.maxTokens,
        reasoningEffort: composed.reasoningEffort, temperature: composed.temperature }, system: composed.system, tools: composed.tools,
        inputHash: requestFingerprint({ system: composed.system, messages: composed.messages, tools: composed.tools }),
        pricingBasis: call.dispatchPricing.pricingBasis, budget: call.dispatchBudget,
        rawInput: call.dispatchPricing.decomposeRequest(composed), calibrationHeaderKey: calibrationHeaderKey(call.dispatchPricing.pricingBasis.header),
        promptDecision: call.promptDecision, workbenchDecision: call.workbenchDecision,
        requestSourceSeqs: summaryInstruction ? [...(systemSeq === undefined ? [] : [systemSeq]), ...summaryInstruction.sourceSeqs] : call.sourceSeqs,
        careInstructions: careInstructions.map(instruction => ({ ...instruction,
          sourceSeq: instruction.kind === 'guidance' ? systemSeq : undefined })) })
      if (call.dispatchBudget.hardInput !== undefined && call.dispatchBudget.inputTokens > call.dispatchBudget.hardInput) throw new RequestBudgetExceeded(call.dispatchBudget)
      const assertCurrent = () => {
         workbench.assertCurrent(agent, call.workbenchPlan)
        // Failed saves do not advance revision, but change the fail-closed
        // epoch; source disposal also changes it and invalidates old plans.
        if (controls.revision(String(session.id)) !== controlRevision
          || controls.epoch(String(session.id), 'dsh-context-care', 'state') !== controlEpoch) throw Object.assign(
          new Error('context-care: rule preferences changed before dispatch; prepare the request again'), { code: 'CONTROL_CHANGED' })
      }
      assertCurrent()
      reservationsStarted = true
      await feedback.reserve(session, segments, call.callId)
      assertCurrent()
      await completion?.reserve(session, segments, call.callId)
      assertCurrent()
      await workbench.reserve(agent, call.workbenchPlan, call.callId)
      // Keep a durable unknown reservation for crashes, but do not certify an
      // actual handoff until every preflight ACK and its final check have passed.
      await persist(call, 'dispatch-reserved')
      assertCurrent()
      forwarded.set(composed, call)
      iterator = prepared.stream(composed)[Symbol.asyncIterator]()
      assertCurrent()
      // Calling next starts the bound stream synchronously, with no await gap
      // after the final control check. Its first rejection is captured while
      // the post-handoff audit/outbox acknowledgements are in flight.
      const start = iterator.next()
      call.dispatched = true
      let pending = Promise.resolve(start).then(result => ({ result }), error => ({ error }))
      await persist(call, 'dispatched', { dispatchOrder: ++dispatchOrder, dispatchBasis: 'prepared-stream-handoff' })
      await feedback.dispatched(session, segments, call.callId, composed)
      await completion?.dispatched(session, segments, call.callId, composed)
      await workbench.dispatched(agent, call.workbenchPlan, call.callId)
      owner.dispatched?.(call)
      // Only the actual conversational attempt owns streaming evidence. Auxiliary
      // summary/provider calls must not be mistaken for this Agent's response.
      if (call.attemptId) delta = workbench.openDelta(agent, { requestId: call.callId, attemptId: call.attemptId })
      while (true) {
        const item = await pending
        if ('error' in item) throw item.error
        if (item.result.done) break
        const chunk = item.result.value
        await delta?.feed(chunk, request.signal)
        if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason.kind)) {
          call.failure = chunk.reason.failure
          await persist(call, 'failed', { failure: call.failure })
        }
        yield chunk
        pending = Promise.resolve(iterator.next()).then(result => ({ result }), error => ({ error }))
      }
    } catch (error) {
      primaryError = error
      if (!call.dispatched) {
        if (reservationsStarted) {
          try { await workbench.rollback(agent, call.callId) }
          catch (secondary) { recordSecondaryFailure(error, secondary, 'rule action reservation rollback') }
          for (const [label, resource] of [['feedback', feedback], ['completion', completion]]) {
            try { await resource?.rollback(session, call.callId) }
            catch (secondary) { recordSecondaryFailure(error, secondary, `${label} reservation rollback`) }
          }
        }
        call.failure = { code: error.code ?? 'REQUEST_PREFLIGHT_FAILED', message: error.message }
        try { await persist(call, 'failed', { failure: call.failure, outcome: 'not-dispatched' }) }
        catch (secondary) { recordSecondaryFailure(error, secondary, 'preflight failure audit') }
      }
      if (call.dispatched) {
        // Once next() was called, a failed ACK cannot establish that no side effect occurred.
        try { await workbench.unknown(agent, call.callId) }
        catch (secondary) { recordSecondaryFailure(error, secondary, 'rule action handoff uncertainty') }
      }
      // Budget failures must enter the ordinary request-error recovery path.
      // Storage and programming failures remain thrown, with their original stack.
      if (!(error instanceof RequestBudgetExceeded) && !(error instanceof MatcherFailure)) throw error
      call.failure = { code: error.code, message: error.message }
      await persist(call, 'failed', { failure: call.failure })
      yield { type: 'finish', reason: { kind: 'error', failure: call.failure } }
    } finally {
      // Both cleanups reach quiescence, even when detector reset fails during cancellation.
      await releaseResources([['request detectors', () => delta?.close()], ['request stream', () => iterator?.return?.()]], primaryError)
    }
  })
  on('agent/idle', ({ agent }) => {
    attempts.delete(agent)
    for (const [id, call] of calls) if (call.agent === agent) calls.delete(id)
  })
  ctx.effect(() => async () => {
    for (const dispose of listeners) dispose()
    let primary
    for (const [label, resource] of [['request journal', journal], ['output feedback', feedback]]) {
      try { await resource.close() }
      catch (error) {
        if (primary === undefined) primary = error
        else recordSecondaryFailure(primary, error, `${label} shutdown`)
      }
    }
    calls.clear(); owners.clear()
    if (primary !== undefined) throw primary
  })
}
