// @ts-check
/** @import { Context } from '@deepseek-ai/cordis' */
/** @import { Agent } from '@deepseek-ai/dsh-agent' */
/** @import { Session, SessionId } from '@deepseek-ai/dsh-session' */
/** @import { GenerateOptions, LlmCallConfig, PreparedLlmCall, LlmAttemptId } from '@deepseek-ai/dsh-llm' */
/** @import { RequestOwner, RequestCall, Workbench, PromptSegments, RequestIterator, Pricing } from './request-types.js' */
/** @import {} from '@deepseek-ai/dsh-tools' */
/** @import {} from '@deepseek-ai/dsh-token-meter' */
/** @import {} from '@deepseek-ai/dsh-storage-domain' */
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
import { ensureReminderService, ReminderConfig } from './reminder-runtime/index.js'
import { createSummaryProposalHistory } from '../lib/summary-proposal-history.js'
import { createCareChanges } from '../lib/care-changes.js'
import { ensureSessionLog } from '../lib/session-log.js'
import { producerOf, producedUnder, isCheckpointSource } from './producer-source.js'

export const name = 'context-care-requests'
export const inject = ['agents', 'sessions', 'sessionQuery', 'tools', 'llm', 'tokenMeter', 'storageDomain']
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
  reminders: ReminderConfig,
  // Only an explicit requirement can stop dispatch on a failed request transformation.
  requiredStages: z.array(z.literal('request.assemble')).max(1).default([]),
}).strict().prefault({})

/** prepareCall clones its config. Keep native cancellation and request data out
 * of that clone; only the public LlmCallConfig fields belong in it.
 * @param {LlmCallConfig} request */
function callConfig(request) {
  const { provider, model, reasoningEffort, temperature, maxTokens, stop } = request
  return { provider, model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(stop === undefined ? {} : { stop }) }
}

/** Cordis apply returns only its lifecycle result, while the factory exposes the service type.
 * @param {Context} ctx @param {import('zod').input<typeof Config>} config */
export async function apply(ctx, config = {}) {
  await openRequestHost(ctx, config)
}

/** Own live request operations and Session-derived history using the stream waterfall.
 * @param {Context} ctx @param {import('zod').input<typeof Config>} config */
export async function openRequestHost(ctx, config = {}) {
  const changes = createCareChanges()
  ctx.provide('contextCareChanges', changes)
  ctx.effect(() => () => changes.close())
  ctx.on('session/event', (session, event) => {
    const id = String(session.id)
    // These views read committed plugin contributions. Ordinary conversation
    // headers and assistant settlements cannot create actions or rewrite rows.
    if (event.type === 'user/message') {
      const source = event.data.source
      if (isCheckpointSource(source) && typeof event.surfaceOp === 'object' && event.surfaceOp.op === 'replace') changes.changed(id, ['actions', 'prompts'])
      else if (producerOf(source) === 'dsh-context-care' || producedUnder(source, 'dsh-context-care:')) changes.changed(id, ['prompts'])
    } else if (event.type === 'system/message') {
      if (requestCareInstructions({ messages: [event.data.message] }).length) changes.changed(id, ['prompts'])
    } else if (event.type === 'request/header') {
      if ('contextCarePrompt' in event.data && event.data.contextCarePrompt) changes.changed(id, ['prompts'])
    } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      // A settlement updates prompt call references, not the action collection.
      changes.changed(id, ['prompts'])
    } else if (event.type === 'compaction/summary') changes.changed(id, ['actions', 'prompts'])
  })
  const history = ensureSessionLog(ctx)
  const journal = await openRequestJournal({ sessions: ctx.sessions, logs: history, changed: (id, record) => {
    if (record.kind === 'request') changes.changed(id, record.data.budget === undefined ? ['prompts'] : ['actions', 'prompts'])
    else if (record.data.action === 'request-rewrite') changes.changed(id, ['rewrites'])
    else if (record.data.action === 'rule-evaluation') changes.changed(id, ['prompts'])
    else changes.changed(id, ['actions', 'prompts'])
  }, measurementDependencies: header => [ctx.tokenMeter, ctx.tokenMeter.estimateMessage, ctx.llm, ctx.llm.fileRequestText,
    header === undefined ? undefined : ctx.llm.imageRequestPricing(header.config.provider, header.config.model)],
    measureInput: (session, request) => captureInputPricing({ history, meter: ctx.tokenMeter, llm: ctx.llm, session }).decomposeRequest(request) })
  /** @type {Awaited<ReturnType<typeof openRuleControls>> | undefined} */
  let controls
  /** @type {Awaited<ReturnType<typeof openOutputFeedback>>} */
  let feedback
  try { feedback = await openOutputFeedback({ sessions: ctx.sessions, logs: history,
    rulesFor: id => ownerFor(ctx.agents.get(/** @type {SessionId} */ (id)))?.promptRulesFor?.(/** @type {SessionId} */ (id)) ?? [],
    revision: id => controls?.revision(id) ?? 0,
    eligible: /** @param {string} id @param {string} ruleId @param {number[]} seqs */ (id, ruleId, seqs) => controls === undefined
    || (controls.enabled(id, 'dsh-context-care', `prompt:${ruleId}`, 'notice')
      && seqs.every(seq => seq > (controls?.sinceSeq(id, 'dsh-context-care', `prompt:${ruleId}`) ?? -1))) }) }
  catch (error) {
    await journal.close().catch(closeError => ctx.logger.warn(`context-care: journal rollback failed: ${String(closeError)}`))
    throw error
  }
  try { controls = await openRuleControls(ctx.storageDomain, { changed: /** @param {string | undefined} id */ id => changes.changed(id, ['status', 'actions', 'controls', 'runtime']), boundary: /** @param {string} id */ id => (ctx.sessions.get(/** @type {SessionId} */ (id))?.seq ?? 0) - 1 }) }
  catch (error) {
    for (const [label, resource] of /** @type {const} */ ([['feedback', feedback], ['journal', journal]])) {
      await resource.close().catch(closeError => ctx.logger.warn(`context-care: ${label} rollback failed: ${String(closeError)}`))
    }
    throw error
  }
  const ruleControls = controls
  ctx.effect(() => () => ruleControls.close())
  ctx.provide('contextCareControls', controls)
  /** @type {Workbench} */
  let workbench
  try { workbench = await openWorkbenchHost(ctx, controls, Config.parse(config)) }
  catch (error) {
    for (const [label, resource] of /** @type {const} */ ([['controls', controls], ['feedback', feedback], ['journal', journal]])) {
      try { await resource.close() } catch (secondary) { recordSecondaryFailure(error, secondary, `workbench-open-${label}`) }
    }
    throw error
  }
  ctx.provide('contextCareWorkbench', workbench)
  ctx.effect(() => () => workbench.close())
  await ensureReminderService(ctx, Config.parse(config).reminders, controls)
  const proposals = createSummaryProposalHistory({ readSession: id => history.read(id) }, history)
  ctx.on('session/event', (session, event) => proposals.observe(session, event))
  ctx.effect(() => () => proposals.close())
  let dispatchOrder = 0
  /** @type {Set<RequestOwner>} */
  const owners = new Set()
  /** @type {Map<string, RequestCall>} */
  const calls = new Map()
  /** @type {WeakMap<GenerateOptions, {prepared: PreparedLlmCall, callId: string}>} */
  const preparedRequests = new WeakMap()
  /** @type {WeakMap<GenerateOptions, RequestCall>} */
  const forwarded = new WeakMap()
  /** @type {WeakMap<Agent, LlmAttemptId>} */
  const attempts = new WeakMap()
  const reconciled = new WeakSet()
  /** @type {(() => void)[]} */
  const listeners = []
  /** @param {Agent | undefined} agent */
  const ownerFor = agent => agent === undefined ? undefined : [...owners].find(owner => owner.owns(agent))
  /** @param {RequestCall} call @param {string} phase @param {Record<string, unknown>} details */
  function recordPhase(call, phase, details = {}) {
    const previous = call.record ?? { callId: call.callId, logRevision: call.logRevision, sourceSeqs: call.sourceSeqs,
      sourceMessagesHash: requestFingerprint(call.sourceMessages),
      purpose: call.original.purpose ?? 'conversation' }
    call.record = { ...previous, ...details, dispatched: call.dispatched, phase }
    return journal.put(`call_${call.callId}`, call.session.id, 'request', call.record)
  }
  ctx.effect(() => ruleControls.registerProvider(/** @param {SessionId} sessionId */ sessionId => ownerFor(ctx.agents.get(sessionId))?.controlSources?.(sessionId) ?? []))
  const service = {
    controls: ruleControls,
    /** @param {RequestOwner} owner */
    register(owner) { owners.add(owner); return () => { owners.delete(owner); for (const [id, call] of calls) if (call.owner === owner) calls.delete(id) } },
    /** @param {string} callId */
    snapshot: callId => calls.get(callId),
    /** @param {Agent} agent */
    failed(agent) { return [...calls.values()].findLast(call => call.agent === agent && call.settled && call.failure !== undefined && ['conversation', undefined].includes(call.original.purpose)) },
    /** @param {string} callId */
    release: callId => calls.delete(callId),
    /** @param {string} callId @param {Record<string, unknown>} details */
    settle(callId, details) { const call = calls.get(callId); return call === undefined ? Promise.resolve() : recordPhase(call, 'settled', details) },
    /** @param {Session} session @param {Record<string, unknown>} data */
    recordAction(session, data) { return journal.put(`action_${randomUUID()}`, session.id, 'maintenance', { logRevision: session.seq, ...data }) },
    /** @param {Session} session @param {string} key @param {AbortSignal} [signal] */
    wasProposalRejected(session, key, signal) { return proposals.has(session, key, signal) },
    // Auxiliary callers use this handle so their journal id never depends on a
    // nonexistent prepared.callId in the host. Each stream may be consumed once.
    /** @param {LlmCallConfig} config @param {AbortSignal} [signal] */
    async prepareCall(config, signal) {
      const prepared = await ctx.llm.prepareCall(callConfig(config), signal)
      const callId = randomUUID()
      let consumed = false
      return Object.freeze({ ...prepared, callId,
        /** @param {GenerateOptions} request */
        stream(request) {
        if (consumed) throw new Error('context-care: prepared request already consumed')
        consumed = true
        preparedRequests.set(request, { prepared, callId })
        // Enter the public waterfall before consuming the bound adapter handle.
        // The observer composes request-only text and dispatches this same handle.
        return ctx.llm.stream(request)
      } })
    },
    /** @param {Session} session
     * @param {GenerateOptions} request
     * @returns {{segments: PromptSegments, request: GenerateOptions}} */
    preview(session, request) {
      const owner = ownerFor(ctx.agents.get(session.id))
      const purpose = request.purpose ?? 'conversation'
      const previous = journal.previousRoute(session, purpose)
      const segments = [...(owner?.prompts?.({ ...request, sessionId: session.id }, previous) ?? []), ...feedback.collect(session, request, owner?.promptRulesFor?.(session.id) ?? []),
        ...(ctx.get('contextCareCompletion')?.collect(session, request) ?? [])]
      return { segments, request: withScopedPrompts(request, segments) }
    },
    /** @param {Session} session @param {Parameters<typeof journalCalibration>[1]} header @param {Parameters<typeof journalCalibration>[2]} fallback */
    calibration: (session, header, fallback) => journalCalibration(journal.calibrationRecords(session, header), header, fallback),
    feedback: feedback.list,
    list: journal.list,
    view: journal.view,
    /** @param {string} [sessionId] */
    async flush(sessionId) { await journal.flush(sessionId); await feedback.flush(sessionId) },
  }
  ctx.provide('contextCareRequests', service)
  /** @type {Context['on']} */
  const on = (event, callback, options) => { const dispose = ctx.on(event, callback, options); listeners.push(dispose); return dispose }
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
    const outcome = frame.outcome
    const event = outcome.kind === 'committed' ? history.withLive(agent.session, log => log.at(outcome.seq)) : undefined
    const completed = event?.type === 'assistant/message' && !event.data.interrupted
    void recordPhase(call, 'settled', { attemptId: frame.attemptId,
      outcome: completed ? 'completed' : event?.type === 'assistant/attempt' ? 'failed' : 'interrupted',
      eventSeq: event?.seq, eventType: event?.type, usage: event?.type === 'assistant/message' ? event.data.usage : undefined })
    if (completed && call.dispatched) {
      void feedback.observe(call.session, event, call.record?.route, call.owner.promptRulesFor?.(call.session.id) ?? [])
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
    if (owner === undefined || agent === undefined) { yield* delegated; return }
    const session = agent.session
    const handle = preparedRequests.get(request)
    const pricing = captureInputPricing({ history, meter: ctx.tokenMeter, llm: ctx.llm, session, requests: service })
    /** @type {RequestCall} */
    const call = { callId: handle?.callId ?? randomUUID(), owner, agent, session,
      logRevision: session.seq, generation: session.surface.replaceGeneration,
      sourceSeqs: [...session.surface.nodes], sourceMessages: history.messages(session), original: request,
      measurement: pricing.measure(), dispatched: false,
      attemptId: ['conversation', undefined].includes(request.purpose) ? attempts.get(agent) : undefined }
    calls.set(call.callId, call)
    /** @type {Context['contextCareCompletion'] | undefined} */
    let completion
    /** @type {RequestIterator | undefined} */
    let iterator
    /** @type {ReturnType<Workbench['openDelta']> | undefined} */
    let delta
    let reservationsStarted = false
    /** @type {unknown} */
    let primaryError
    try {
      await feedback.flush(session.id)
      completion = ctx.get('contextCareCompletion')
      if (!reconciled.has(session)) {
        await completion?.reconcile(session)
        reconciled.add(session)
      }
      await completion?.flush(session.id)
      const prepared = handle?.prepared ?? await ctx.llm.prepareCall(callConfig(request), request.signal)
      const bound = { ...request, ...prepared.config }
      const controlRevision = controls.revision(String(session.id))
      const controlEpoch = controls.epoch(String(session.id), 'dsh-context-care', 'state')
      const { segments, request: promptRequest } = service.preview(session, bound)
      const plan = await workbench.assemble(agent, promptRequest)
      call.workbenchPlan = plan
      const composed = plan.request
      const commitRequestInputs = () => {
        if (plan.records.length) {
          const data = {
            header: session.requestHeader() ?? { config: prepared.config, ...(request.tools === undefined ? {} : { tools: request.tools }) }, reason: /** @type {const} */ ('series'),
            contextCareWorkbench: JSON.parse(JSON.stringify({ callId: call.callId, token: plan.token, documents: plan.documents,
              records: plan.records, diff: plan.diff,
              injectionBudget: plan.injectionBudget, impact: plan.impact })),
          }
          const decision = session.append('request/header', data)
          call.workbenchDecision = { seq: decision.seq, records: plan.records, documents: plan.documents }
        }
        if (segments.length) {
          const data = {
            header: session.requestHeader() ?? { config: prepared.config, ...(request.tools === undefined ? {} : { tools: request.tools }) }, reason: /** @type {const} */ ('series'),
            contextCarePrompt: { callId: call.callId, segments, message: composed.messages.at(-1) },
          }
          const decision = session.append('request/header', data)
          call.promptDecision = { seq: decision.seq, segments, message: composed.messages.at(-1) }
        }
      }
      const model = await ctx.llm.resolveModelInfo(composed.provider, composed.model, request.signal)
      call.ready = { request: composed, model: { ...model, ...(prepared.context ? { context: prepared.context } : {}) },
        imageRequestPricing: ctx.llm.imageRequestPricing(composed.provider, composed.model) }
      const admission = await owner.check(call, call.ready)
      call.dispatchBudget = admission.budget
      call.dispatchPricing = admission.pricing
      const careInstructions = requestCareInstructions(composed)
      const summaryInstruction = careInstructions.find(instruction => instruction.kind === 'summary-instruction')
      const systemSeq = history.withLive(session, log => call.sourceSeqs.find(seq => log.at(seq)?.type === 'system/message'))
      await recordPhase(call, 'ready', { route: { provider: composed.provider, model: composed.model, maxTokens: composed.maxTokens,
        reasoningEffort: composed.reasoningEffort, temperature: composed.temperature },
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
      // This phase is live diagnostics only. Actual settlement is read from
      // the Session, so an abandoned cache entry cannot certify a dispatch.
      await recordPhase(call, 'dispatch-reserved')
      assertCurrent()
      forwarded.set(composed, call)
      iterator = prepared.stream(composed)[Symbol.asyncIterator]()
      assertCurrent()
      // Log the actual request contribution only after preflight has succeeded.
      // No await separates this intent from provider handoff, so a cold reader
      // never mistakes a rejected preparation for a delivered completion prompt.
      commitRequestInputs()
      assertCurrent()
      const start = iterator.next()
      call.dispatched = true
      let pending = Promise.resolve(start).then(result => ({ result }), error => ({ error }))
      await recordPhase(call, 'dispatched', { dispatchOrder: ++dispatchOrder, dispatchBasis: 'prepared-stream-handoff' })
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
        if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          call.failure = chunk.reason.failure
          await recordPhase(call, 'failed', { failure: call.failure })
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
          for (const [label, resource] of /** @type {const} */ ([['feedback', feedback], ['completion', completion]])) {
            try { await resource?.rollback(session, call.callId) }
            catch (secondary) { recordSecondaryFailure(error, secondary, `${label} reservation rollback`) }
          }
        }
        call.failure = { code: error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'REQUEST_PREFLIGHT_FAILED', message: error instanceof Error ? error.message : String(error) }
        try { await recordPhase(call, 'failed', { failure: call.failure, outcome: 'not-dispatched' }) }
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
      await recordPhase(call, 'failed', { failure: call.failure })
      yield { type: 'finish', reason: { kind: 'error', failure: call.failure } }
    } finally {
      // Both cleanups reach quiescence, even when detector reset fails during cancellation.
      await releaseResources([['request detectors', () => delta?.close()], ['request stream', () => iterator?.return?.()]], primaryError)
    }
  })
  on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    attempts.delete(agent)
    journal.release(agent.session)
    for (const [id, call] of calls) if (call.agent === agent) calls.delete(id)
  })
  ctx.effect(() => async () => {
    for (const dispose of listeners) dispose()
    let primary
    for (const [label, resource] of /** @type {const} */ ([['request journal', journal], ['output feedback', feedback]])) {
      try { await resource.close() }
      catch (error) {
        if (primary === undefined) primary = error
        else recordSecondaryFailure(primary, error, `${label} shutdown`)
      }
    }
    calls.clear(); owners.clear()
    if (primary !== undefined) throw primary
  })
  return service
}
