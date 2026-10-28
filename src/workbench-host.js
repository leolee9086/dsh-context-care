import { variableSnapshot, createTemplates, createBoundedMatcher, MatcherFailure, createDetectorRegistry, compactExecutorRef, createBlockWindow as createWorkbenchWindow, requestImpact, createRequestPlanCache, createDisplayPlanCache, withPlanningToken, importWorkbench, createEngine, hasStageRules, selectStageRules, selectToolDenial, assertPlanCurrent, documentTemplates, observationPolicy, acknowledgeObservation, markDisplayChange, recordRuleFailure, displayPlanningFailure, createDocumentRegistry, decideRuntimeAction, requestViews, actionKey, dispatchKey, dispatchItems, recoverDispatches, reserveDispatch, rollbackDispatch, unknownDispatch, handoffDispatch, settleDispatch, hasDispatch, entryDirectory, documentDeclarations, actionAvailability, writeActionVariable, openDeltaRuntime } from '@leolee9086/dsh-rule-engine'
import { createHash, randomUUID } from 'node:crypto'

import { extractRawBlocks } from '@leolee9086/dsh-session-blocks'
import { openWorkbenchStore } from './workbench-store.js'

import { createExecutorRegistry, createActionRuns } from './action-runs.js'
import { originalSessionBlocks as readOriginalBlocks, modelRequestBlocks as readModelBlocks, projectRequestMessage, sessionTurn as readSessionTurn } from './request-blocks.js'
import { ensureSessionLog } from '../lib/session-log.js'

import { planRequestV2, planRequestV2Async } from './request-plan.js'

import { entryTurn as readEntryTurn } from './entry-lifecycle.js'
import { releaseResources } from './resource-cleanup.js'

import { readRuleFiles } from './rule-files.js'

/** Single Request Host contribution: durable documents, shared matching, execution controls and jobs.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Awaited<ReturnType<import('./rule-controls.js').openRuleControls>>} controls
 * @param {import('zod').input<typeof import('./request-host.js').Config>} options */
export async function openWorkbenchHost(ctx, controls, { ruleFiles = [], executors: configuredExecutors = [], maxCascadePasses = 4, maxInjectedChars = 65536, maxInjectedTokens = 65536, maxCacheChangedBytes, maxRequestBytes = 8388608, maxQueued = 128, maxConcurrent = 8, maxDeltaChars = 32768, maxDeltaBlocks = 16, matcher: matcherOptions = {}, requiredStages = [] } = {}, engine = createEngine()) {
  const history = ensureSessionLog(ctx)
  const displayHistoryKey = {}
  const windowsKey = history.cache.define('workbench-windows',
    'Native Session identity; each source tracks its append cursor and replacement generation.',
    () => ({ display: createWorkbenchWindow(), output: createWorkbenchWindow() }))
  const windowFor = (session, kind) => history.cache.use(session, windowsKey)[kind]
  const sessionTurn = session => history.withLive(session, log => readSessionTurn(session, log))
  const entryTurn = session => history.withLive(session, log => readEntryTurn(session, log))
  const originalSessionBlocks = session => readOriginalBlocks(session, history)
  const modelRequestBlocks = (session, request, requestId, analysis) => readModelBlocks(String(session.id), request, requestId, history.origins(session), sessionTurn(session), analysis.modelProjection)
  const report = error => ctx.logger.warn(`context-care: workbench failed: ${String(error)}`)
  const templates = createTemplates()
  const observations = new Map(); const admittedSessions = new Map(); let closed = false; let closing
  const tailSeq = session => session.seq - 1
  const sourceRegistry = createDocumentRegistry({ templates, compile: engine.compile, report, changed: id => notifyWorkbench(id),
    documentSets: () => store.documentSets(),
    sessionBoundaries: () => new Map(ctx.sessions.list().map(session => [String(session.id), tailSeq(session)])),
    loadFiles: ruleFiles.length ? () => readRuleFiles(ruleFiles) : undefined,
  })
  const externalDocuments = sourceRegistry.externalDocuments
  // Workbench mutations update diagnostics and rule state. Rewrite records have
  // their own owner and are published only when that owner records a rewrite.
  const notifyWorkbench = id => ctx.get('contextCareChanges')?.changed(id?.startsWith('$scope:') ? undefined : id, ['status', 'actions', 'controls', 'runtime'])
  const store = await openWorkbenchStore(ctx.storageDomain, { templates, compile: engine.compile, report, externalDocuments, changed: notifyWorkbench, admissionSeq: id => {
    const session = ctx.sessions.get(id)
    if (!session) throw new Error('workbench-session-unavailable')
    return tailSeq(session)
  } })
  const workerMatcher = createBoundedMatcher(matcherOptions)
  // Sidebar reads have their own bounded pool so they cannot exhaust dispatch admission.
  const displayWorker = createBoundedMatcher({ ...matcherOptions, maxPending: Math.min(matcherOptions.maxPending ?? 2, 2), maxIdle: 1 })
  const detectors = createDetectorRegistry({ detect: (input, signal) => (input.stage === 'display.render' ? displayWorker : workerMatcher).detect(input, signal) })
  const matcher = { detect: (input, signal, options) => detectors.detect(input, signal, options),
    close: () => releaseResources([['workbench-detectors', () => detectors.close()], ['workbench-worker', () => workerMatcher.close()], ['workbench-display-worker', () => displayWorker.close()]]) }
  const executors = createExecutorRegistry({ tools: ctx.tools })
  try {
    // Fixed producer-owned tool; native execution retains policy, sandbox and approval. Success means scheduled, not summarized.
    executors.registerTool({ executorRef: compactExecutorRef, plugin: 'dsh-context-care', toolName: 'context_rest',
      inputSchema: { type: 'object', properties: { note: { type: 'string', minLength: 1 } }, required: ['note'], additionalProperties: false },
      requiresApproval: false })
    for (const specification of configuredExecutors) executors.registerTool({ ...specification, plugin: 'dsh-context-care' })
  }
  catch (error) {
    await releaseResources([['workbench-executors', () => executors.close()], ['workbench-matcher', () => matcher.close()], ['workbench-store', () => store.close()]], error)
    throw error
  }
  const presetId = agent => agent ? ctx.get('agentPresets')?.composedPreset(agent.ctx) : undefined
  const record = agent => store.read(String(agent.session.id), { presetId: presetId(agent) })
  function documents(agent, state = record(agent)) {
    return sourceRegistry.documents(String(agent.session.id), state.documents)
  }
  const documentSource = 'context-care:documents'
  const disposeEngineSource = engine.provideRules(documentSource, query => {
    const agent = query?.sessionId === undefined ? undefined : ctx.agents.get(query.sessionId)
    return agent ? documentDeclarations(query?.documents ?? documents(agent)) : []
  })
  function definitions(agent, docs = documents(agent)) {
    return engine.rules({ sessionId: String(agent.session.id), presetId: presetId(agent), documents: docs, sourceNames: [documentSource] })
      .filter(hasStageRules)
  }
  function ruleAdmissions(agent, rules, docs = documents(agent), state = record(agent)) {
    const id = String(agent.session.id)
    return sourceRegistry.admissions(id, rules, docs, state.runtime, (sourceId, ruleId) => controls.sinceSeq(id, sourceId, ruleId))
  }
  function availability(action, agent, rule, state) {
    if (sourceRegistry.failure()) return { available: false, reason: `rule-file-load-failed: ${sourceRegistry.failure().message}` }
    return actionAvailability(action, { rule, runtime: state.runtime,
      detectorAvailable: (definition, stage) => detectors.available(definition, String(agent.session.id), stage),
      executorAvailable(ref) {
        const executor = executors.get(ref)
        return executor !== undefined && ctx.tools.get(executor.toolName, agent) !== undefined
      },
    })
  }
  const sources = id => {
    const agent = ctx.agents.get(id)
    if (!agent) return []
    const state = record(agent), docs = documents(agent, state)
    return sourceRegistry.catalog(id, docs, (action, rule) => availability(action, agent, rule, state))
  }
  let disposeProvider
  try { disposeProvider = controls.registerProvider(sources) }
  catch (error) {
    await releaseResources([['workbench-engine-source', disposeEngineSource], ['workbench-executors', () => executors.close()], ['workbench-matcher', () => matcher.close()], ['workbench-store', () => store.close()]], error)
    throw error
  }
  const token = (agent, variables) => JSON.stringify([store.token(String(agent.session.id), presetId(agent), variables), sourceRegistry.token(), engine.token(), executors.token(), detectors.token(), controls.revision(String(agent.session.id)),
    controls.epoch(String(agent.session.id), '', ''), templates.versions()])
  const tokenStamp = agent => [store.tokenRevision(), String(agent.session.id), presetId(agent), sourceRegistry.token(), engine.token(), executors.token(), detectors.token(),
    controls.revision(String(agent.session.id)), controls.epoch(String(agent.session.id), '', ''), templates.tokenRevision()]
  function decision(agent, event, action, expected, { delivery = false, dispatchId, planning } = {}) {
    const id = String(agent.session.id)
    if (sourceRegistry.failure()) return { enabled: false, reason: `rule-file-load-failed: ${sourceRegistry.failure().message}` }
    return decideRuntimeAction({ closed, storageAvailable: store.available(id),
      current: () => expected === undefined || (planning ? planning.current() : expected === token(agent)),
      select: () => planning ? planning.select(event.sourceId, event.ruleId, action.id) : controls.decision(id, event.sourceId, event.ruleId, action.id),
      runtime: () => planning?.state.runtime ?? record(agent).runtime, event, action, delivery, dispatchId,
      sinceSeq: controls.sinceSeq(id, event.sourceId, event.ruleId), turnId: planning?.turnId ?? sessionTurn(agent.session),
      entry: () => (planning?.entries ?? entryDirectory(documents(agent))).get(JSON.stringify([event.sourceId, event.ruleId])),
    })
  }
  function renderTemplates(agent, docs = documents(agent)) {
    return documentTemplates(templates, docs)
  }
  const jobs = createActionRuns({ store, registry: executors, templates: { render(source, snapshot) {
    const agent = ctx.agents.get(snapshot.session.id)
    if (!agent) throw new Error('template-agent-unavailable')
    return renderTemplates(agent).render(source, snapshot)
  } }, maxQueued, maxConcurrent, report,
    async setVariable(agent, item, value, context) {
      const id = String(agent.session.id)
      return writeActionVariable(item.action.variable, value, context.session.turnId, {
        read: () => record(agent), documents: () => documents(agent), token: variables => token(agent, variables),
        save: (declaration, next, turnId, assertCurrent) => store.automaticVariable(id, declaration, next, turnId, assertCurrent),
        assertCurrent: (expected = item.token) => service.assertCurrent(agent, { token: expected }),
      })
    }, approvalFor: agent => ctx.get('agentPresets')?.serviceFor(agent, 'approval') ?? ctx.get('approval'),
    guard: (id, event, action, expected, options) => {
      const agent = ctx.agents.get(id)
      return agent ? decision(agent, event, action, expected, options) : { enabled: false, reason: 'agent-unavailable' }
    } })
  try {
    for (const id of store.sessions()) {
      if (recoverDispatches(store.read(id).runtime)) {
        await store.runtime(id, runtime => recoverDispatches(runtime))
        report(new Error(`request-handoff-unconfirmed-after-restart:${id}`))
      }
    }
    await jobs.recover()
  }
  catch (error) {
    await releaseResources([['workbench-provider', disposeProvider], ['workbench-engine-source', disposeEngineSource], ['workbench-jobs', () => jobs.close()],
      ['workbench-matcher', () => matcher.close()], ['workbench-executors', () => executors.close()], ['workbench-store', () => store.close()]], error)
    throw error
  }
  let disposeCreated
  try {
    // A restored/forked session starts observing after its inherited tail; original blocks remain available as matching context.
    for (const session of ctx.sessions.list()) admittedSessions.set(String(session.id), tailSeq(session))
    disposeCreated = ctx.on('agent/created', ({ agent }) => { admittedSessions.set(String(agent.session.id), tailSeq(agent.session)) })
  } catch (error) {
    await releaseResources([['workbench-provider', disposeProvider], ['workbench-engine-source', disposeEngineSource], ['workbench-jobs', () => jobs.close()],
      ['workbench-matcher', () => matcher.close()], ['workbench-executors', () => executors.close()], ['workbench-store', () => store.close()]], error)
    throw error
  }
  async function recordMatchFailure(agent, error, sourceSeqs = [], kind = 'matching') {
    await store.runtime(String(agent.session.id), runtime => recordRuleFailure(runtime, error, sourceSeqs, kind))
    report(error)
  }
  /** @param {ReturnType<typeof createRequestPlanCache<import('@deepseek-ai/dsh-llm').GenerateOptions, ReturnType<typeof requestImpact>>>} [analysis] */
  async function plan(agent, request, stage, suppliedBlocks, freshSeq, analysis) {
    const ownedAnalysis = analysis === undefined
    analysis ??= createRequestPlanCache(requestImpact, history.cache, projectRequestMessage)
    try { return await evaluatePlan(agent, request, stage, suppliedBlocks, freshSeq, analysis) }
    catch (error) {
      if (!(error instanceof MatcherFailure) || request.signal?.aborted) throw error
      const seqs = freshSeq === undefined ? [] : [freshSeq]
      await recordMatchFailure(agent, error, seqs)
      if (request.purpose === 'preview' && stage === 'request.assemble' || requiredStages.includes(stage)) throw error
      // Failed optional processing leaves the complete input untouched. No partial patches or actions survive.
      const failedRules = error.diagnostic.rules
      const unchanged = planRequestV2({ request, blocks: [], rules: [], events: [], templates: renderTemplates(agent), snapshot: {}, decision: () => ({ enabled: false }),
        maxInjectedChars, maxInjectedTokens, maxRequestBytes, analysis, estimateMessage: message => ctx.tokenMeter.estimateMessage(message) })
      return { ...unchanged, matchStatus: 'failed', failure: error.diagnostic,
        records: failedRules.map(rule => ({ sourceId: rule.sourceId, ruleId: rule.ruleId, status: 'skipped', assessment: 'failed', reason: error.message })),
        token: token(agent), stage, turnId: sessionTurn(agent.session), documents: [], entryTransitions: [], entryPolicies: {}, entryPrevious: {} }
    } finally { if (ownedAnalysis) analysis.close() }
  }
  async function evaluatePlan(agent, request, stage, suppliedBlocks, freshSeq, analysis) {
    const captured = token(agent), docs = documents(agent), localTemplates = renderTemplates(agent, docs)
    const rules = definitions(agent, docs).filter(rule => rule.on.includes(stage)), id = String(agent.session.id)
    const snapshot = { session: { id, turnId: sessionTurn(agent.session) }, vars: variableSnapshot({ ...record(agent), documents: docs }, sessionTurn(agent.session)),
      ...(freshSeq === undefined ? {} : { currentSeq: freshSeq }) }
    const project = (value, views) => [
      ...(views.has('original') ? originalSessionBlocks(agent.session) : []),
      ...(views.has('model') ? modelRequestBlocks(agent.session, value, randomUUID(), analysis) : []),
    ]
    const entries = entryDirectory(docs)
    const withPlanDecisions = run => controls.withDecisions(id, select => withPlanningToken(captured, () => tokenStamp(agent), () => token(agent), current =>
      run({ select, current, entries, state: record(agent), turnId: sessionTurn(agent.session) })))
    return engine.plan({ request, rules, documents: docs, blocks: suppliedBlocks ?? project(request, requestViews(rules)), stage, snapshot, token: captured,
      freshSeq, admissions: freshSeq === undefined ? undefined : ruleAdmissions(agent, rules, docs),
      turn: stage === 'request.assemble' ? entryTurn(agent.session) : undefined, signal: request.signal, detectorScope: request.detectorScope,
      maxCascadePasses, maxInjectedChars, maxInjectedTokens, maxCacheChangedBytes,
      detect: (input, signal, options) => matcher.detect(input, signal, options),
      enabled: values => controls.withDecisions(id, select => selectStageRules(values, select)),
      runtime: () => record(agent).runtime, current: () => captured === token(agent),
      unseen: request.deltaProjection ? events => request.deltaProjection.unseen(events) : undefined, project,
      plan: ({ policies, ...input }) => planRequestV2Async({ ...input, templates: localTemplates, analysis,
        executeText: (task, signal) => workerMatcher.detect(task, signal), signal: request.signal,
        maxCacheChangedBytes, maxRequestBytes, estimateMessage: message => ctx.tokenMeter.estimateMessage(message),
        decision: (event, action) => decision(agent, event, action, captured),
        withDecisions: run => withPlanDecisions(planning => run((event, action) => {
          const selected = decision(agent, event, action, captured, { planning }), policy = policies[actionKey(event, action)]
          return selected.enabled && policy?.reason ? { enabled: false, reason: policy.reason } : selected
        })),
      }),
      withDecisions: run => withPlanDecisions(planning => run((event, action) => decision(agent, event, action, captured, { planning }))),
    })
  }
  const service = {
    engine, store, executors, sources, token, presetId, turnId: agent => sessionTurn(agent.session),
    matcherStats: () => ({ processing: workerMatcher.getStats(), display: displayWorker.getStats() }),
    // Hash only producer-owned scalars. Runtime revisions include dispatch, cooldown
    // and lifetime changes; the event tail includes new context even within a turn.
    snapshotId(agent) {
      return createHash('sha256').update(JSON.stringify([token(agent), record(agent).runtimeRevision,
        tailSeq(agent.session), sessionTurn(agent.session), executors.catalog().map(value => [value.executorRef, value.available]),
        sources(String(agent.session.id)).map(source => [source.sourceId, source.rules.map(rule => [rule.id,
          rule.actions.map(action => [action.id, action.available, action.reason ?? null])])])])).digest('hex')
    },
    inspect(agent) {
      const state = record(agent); const docs = documents(agent); const turnId = sessionTurn(agent.session)
      return { ...state, documents: docs, turnId, snapshotId: service.snapshotId(agent),
        values: variableSnapshot({ ...state, documents: docs }, turnId), fileError: sourceRegistry.failure()?.message ?? null,
        executors: executors.catalog(), extensions: engine.extensions.catalog(), sources: sources(String(agent.session.id)),
        dispatches: Object.entries(state.runtime.state).filter(([key]) => key.startsWith('$dispatch:')).map(([key, value]) => ({ key, ...value })) }
    },
    reloadFiles: sourceRegistry.reloadFiles,
    register: sourceRegistry.register,
    registerDetector(specification) {
      if (closed) throw new Error('workbench-closed')
      return detectors.register(specification)
    },
    detectorCatalog: () => detectors.catalog(),
    extensionCatalog: () => engine.extensions.catalog(),
    registerCondition(specification) {
      if (closed) throw new Error('workbench-closed')
      return engine.extensions.registerCondition(specification)
    },
    registerAction(specification) {
      if (closed) throw new Error('workbench-closed')
      return engine.extensions.registerAction(specification)
    },
    registerExecutor(specification) {
      if (closed) throw new Error('workbench-closed')
      return executors.registerTool(specification)
    },
    registerPartial(specification) {
      if (closed) throw new Error('workbench-closed')
      sourceRegistry.assertPartialName(specification.name)
      return templates.registerPartial(specification)
    },
    registerHelper(specification) {
      if (closed) throw new Error('workbench-closed')
      return templates.registerHelper(specification)
    },
    import: input => importWorkbench(input, templates),
    async preview(agent, request) { return plan(agent, request, 'request.assemble') },
    /** Re-render historical blocks with current preferences, without consuming automatic action state.
     * Keep declarations on the engine's public API, including the empty result without patches.
     * @returns {Promise<Omit<ReturnType<typeof import('@leolee9086/dsh-rule-engine').planDisplay>, 'patches'> & { seq: number, patches?: ReturnType<typeof import('@leolee9086/dsh-rule-engine').planDisplay>['patches'] }>}
     */
    async display(agent, seq, signal) {
      if (closed || !store.available(String(agent.session.id))) throw new Error('workbench-storage-unavailable')
      if (sourceRegistry.failure()) throw new Error(`rule-file-load-failed: ${sourceRegistry.failure().message}`)
      if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('display-invalid-sequence')
      const event = history.withLive(agent.session, log => log.at(seq))
      if (!event || !['assistant/message', 'user/message', 'system/message', 'tool/result'].includes(event.type)) throw new Error('display-message-unavailable')
      const captured = token(agent); const id = String(agent.session.id); const docs = documents(agent)
      const rules = definitions(agent, docs).filter(rule => rule.on.includes('display.render'))
      const enabled = rules.length ? controls.withDecisions(id, select => selectStageRules(rules, select, 'display.render')) : []
      if (!enabled.length) return { seq, changed: false, before: [], after: [], records: [] }
      const turn = history.withLive(agent.session, log => log.last('turn/start', seq + 1))
      const turnId = turn ? `${id}:turn:${turn.data.turn ?? turn.seq}` : `${id}:seed`
      const projected = history.projectHistory(agent.session, displayHistoryKey,
        ['assistant/message', 'user/message', 'system/message', 'tool/result'],
        ({ event, turnId }) => extractRawBlocks(event, { sessionId: id, turnId }), seq + 1)
      const original = windowFor(agent.session, 'display')(projected, enabled)
      const display = original.map(block => ({ ...block, view: 'display' }))
      const snapshot = { session: { id, turnId }, vars: variableSnapshot({ ...record(agent), documents: docs }, turnId), currentSeq: seq }
      let events
      try { events = await matcher.detect({ rules: enabled, blocks: [...original, ...display], stage: 'display.render', snapshot, freshSeq: seq }, signal,
        { sessionId: id, current: () => captured === token(agent) }) }
      catch (error) {
        if (error instanceof MatcherFailure && !signal?.aborted) await recordMatchFailure(agent, error, [seq])
        throw error
      }
      let result
      try {
        const analysis = createDisplayPlanCache(history.cache)
        let projection
        try {
          projection = await engine.displayAsync({ blocks: display.filter(block => block.seq === seq), rules, events, templates: renderTemplates(agent), snapshot, analysis,
            decision: (event, action) => controls.decision(id, event.sourceId, event.ruleId, action.id),
            withDecisions: run => controls.withDecisions(id, select => run((event, action) => select(event.sourceId, event.ruleId, action.id))),
            maxInjectedChars, maxBytes: maxRequestBytes }, (task, signal) => displayWorker.detect(task, signal), signal)
        } finally { analysis.close() }
        result = { seq, ...projection }
        // Include identity, change flag and HTTP envelope in the published byte budget.
        if (Buffer.byteLength(JSON.stringify({ projections: result.changed ? [result] : [] }), 'utf8') > maxRequestBytes) throw new Error('display-result-budget-exceeded')
      } catch (cause) {
        if (signal?.aborted) throw signal.reason ?? cause
        // Presentation planning is optional. Keep its fault distinct from matching;
        // neither persist template/message text nor let a broken display end a turn.
        const error = displayPlanningFailure(cause, enabled, display.length)
        await recordMatchFailure(agent, error, [seq], 'display')
        throw error
      }
      if (signal?.aborted) throw signal.reason ?? new Error('display-cancelled')
      if (captured !== token(agent)) throw new Error('workbench-changed-during-display')
      return result
    },
    openDelta(agent, { requestId, attemptId }) {
      const id = String(agent.session.id)
      return openDeltaRuntime({ sessionId: id, requestId, attemptId, turnId: sessionTurn(agent.session), maxChars: maxDeltaChars, maxBlocks: maxDeltaBlocks }, {
        enabled: () => controls.withDecisions(id, select => selectStageRules(definitions(agent), select, 'output.delta')).length > 0,
        token: () => token(agent), release: (scope, reason) => detectors.release(scope, reason), releaseBlock: (scope, index) => detectors.releaseBlock(scope, index),
        plan: (blocks, signal, projection, scope) => plan(agent, { messages: [], purpose: 'preview', signal, deltaProjection: projection, detectorScope: scope }, 'output.delta', blocks),
        enqueue: (items, expected) => jobs.enqueue(id, items, expected), drain: signal => jobs.drain(agent, signal),
      })
    },
    async assemble(agent, request) { await service.reloadFiles(); await service.reconcile(agent, request.signal); return plan(agent, request, 'request.assemble') },
    assertCurrent(agent, planned) {
      assertPlanCurrent(planned, token(agent), sessionTurn(agent.session))
    },
    async reserve(agent, planned, callId) {
      if (typeof callId !== 'string' || !callId) throw new Error('request-call-id-required')
      if (!dispatchItems(planned).length) return
      const id = String(agent.session.id)
      await store.runtime(id, runtime => {
        service.assertCurrent(agent, planned)
        reserveDispatch(runtime, planned, callId)
      })
      service.assertCurrent(agent, planned)
    },
    async rollback(agent, callId) {
      const id = String(agent.session.id)
      if (!hasDispatch(record(agent).runtime, callId, ['reserved'])) return
      await store.runtime(id, runtime => rollbackDispatch(runtime, callId))
    },
    async unknown(agent, callId) {
      const id = String(agent.session.id)
      if (!hasDispatch(record(agent).runtime, callId, ['reserved', 'handoff'])) return
      await store.runtime(id, runtime => unknownDispatch(runtime, callId))
    },
    async dispatched(agent, planned, callId) {
      if (typeof callId !== 'string' || !callId) throw new Error('request-call-id-required')
      const id = String(agent.session.id)
      await store.runtime(id, runtime => handoffDispatch(runtime, planned, callId, () => documents(agent)))
      await jobs.enqueue(id, planned.scheduled.map(item => ({ ...item, dispatchId: callId })), planned.token)
      if (dispatchItems(planned).length) await store.runtime(id, runtime => {
        settleDispatch(runtime, planned, callId)
      })
    },
    async reconcile(agent, signal) {
      const id = String(agent.session.id)
      if (observations.has(id)) return observations.get(id)
      const operation = (async () => {
        const state = record(agent), rules = definitions(agent)
        const active = controls.withDecisions(id, select => selectStageRules(rules, select))
        const through = agent.session.seq, observation = observationPolicy(state.runtime, active, ruleAdmissions(agent, active, undefined, state), admittedSessions.get(id) ?? -1, through)
        const displayRules = observation.display, outputRules = observation.output, start = observation.start
        if (!observation.active) return
        // Reuse the Host-owned index: do not walk unrelated native events here.
        const events = history.withLive(agent.session, log => log.select(
          displayRules.length ? ['assistant/message', 'user/message', 'system/message', 'tool/result']
            : ['assistant/message', 'tool/result'], start, through))
        if (displayRules.length) {
          for (const event of observation.displayEvents(events)) {
            let assessment = 'completed'
            try {
              const projection = await service.display(agent, event.seq, signal)
              if (projection.changed) await store.runtime(id, runtime => {
                markDisplayChange(runtime, event.seq, token(agent))
              })
            } catch (error) {
              if (signal?.aborted || !(error instanceof MatcherFailure || error.code === 'CONTEXT_CARE_DISPLAY_FAILED')) throw error
              assessment = 'failed' // display() retained the actual fault; avoid repeating old failures each boundary.
            }
            await store.runtime(id, runtime => acknowledgeObservation(runtime, 'display', event.seq, assessment))
          }
        }
        if (!outputRules.length) return
        const fresh = observation.outputEvents(events)
        if (!fresh.length) return
        const all = originalSessionBlocks(agent.session)
        let request = { messages: history.messages(agent.session), purpose: 'preview', signal }
        const analysis = createRequestPlanCache(requestImpact, history.cache, projectRequestMessage)
        try {
          const indexed = { length: all.length, at: index => all[index], slice: (from, end) => all.slice(from, end) }
          const generation = agent.session.surface.replaceGeneration
          for (const event of fresh) {
            // Query the declared history window, not a new full-prefix copy per output.
            const stage = event.type === 'tool/result' ? 'tool.result' : 'output.complete'
            const selected = windowFor(agent.session, 'output')(indexed, rules.filter(rule => rule.on.includes(stage)), event.seq, generation)
            const messages = history.messages(agent.session)
            if (messages !== request.messages) request = { ...request, messages }
            const planned = await plan(agent, request, stage, selected, event.seq, analysis)
            await jobs.enqueue(id, planned.scheduled, planned.token)
            await store.runtime(id, runtime => {
              // This is an attempted watermark. A failed assessment is explicitly retained as failed.
              acknowledgeObservation(runtime, 'output', event.seq, planned.matchStatus === 'failed' ? 'failed' : 'completed')
            })
          }
        } finally { analysis.close() }
      })()
      observations.set(id, operation)
      try { await operation } finally { observations.delete(id) }
    },
    /** @param {import('@deepseek-ai/dsh-tools').ToolExecution} exec
     * @returns {Promise<import('@deepseek-ai/dsh-tools').PreToolDecision | undefined>} */
    async beforeExecute(exec) {
      const agent = exec.agent
      if (!agent) return undefined
      const captured = token(agent)
      const candidates = definitions(agent).filter(rule => rule.on.includes('tool.before-execute'))
      const rules = candidates.length ? controls.withDecisions(String(agent.session.id), select => selectStageRules(candidates, select, 'tool.before-execute')) : []
      const block = { id: `execution:${exec.callId}`, sessionId: String(agent.session.id), messageId: `execution:${exec.callId}`,
        turnId: sessionTurn(agent.session), role: 'assistant', view: 'original', type: 'tool-call', callId: exec.callId,
        raw: { type: 'tool-call', id: exec.callId, name: exec.name, arguments: JSON.stringify(exec.arguments) }, arguments: exec.arguments }
      let events
      try { events = await matcher.detect({ rules, blocks: [block], stage: 'tool.before-execute', snapshot: {} }, exec.signal,
        { sessionId: String(agent.session.id), current: () => captured === token(agent) }) }
      catch (error) {
        if (!(error instanceof MatcherFailure) || exec.signal?.aborted) throw error
        await recordMatchFailure(agent, error)
        return { kind: 'deny', reason: `Tool rule assessment failed: ${error.message}. No rule denial was established; inspect ${error.diagnostic.operationId}.`,
          info: { code: error.code, operationId: error.diagnostic.operationId, stage: 'tool.before-execute' } }
      }
      const denied = selectToolDenial(rules, events, (event, action) => decision(agent, event, action, captured))
      if (denied) {
        const { event, action } = denied
        await store.runtime(String(agent.session.id), runtime => {
          runtime.state[actionKey(event, action)] = { lastStarted: Date.now(), occurrenceId: event.occurrenceId }
        })
        service.assertCurrent(agent, { token: captured })
        return { kind: 'deny', reason: `Context rule ${event.sourceId}/${event.ruleId}/${action.id} blocked ${exec.name}` }
      }
      return undefined
    },
    async preStep(agent, signal) { await service.reloadFiles(); await service.reconcile(agent, signal); await jobs.drain(agent, signal) },
    async cancel(id, runId) { return jobs.cancel(id, runId) },
    close() {
      if (closing) return closing
      closed = true
      closing = releaseResources([['workbench-file-load', () => sourceRegistry.close()], ['workbench-created-listener', disposeCreated], ['workbench-provider', disposeProvider], ['workbench-engine-source', disposeEngineSource], ['workbench-jobs', () => jobs.close()],
        ['workbench-matcher', () => matcher.close()], ...[...observations.values()].map((operation, index) => [`workbench-observation:${index}`, () => operation]),
        ['workbench-windows', () => history.cache.clear(windowsKey)],
        ['workbench-executors', () => executors.close()], ['workbench-store', () => store.close()]])
      return closing
    },
  }
  try { await service.reloadFiles() }
  catch (error) { await releaseResources([['workbench-open-files', () => service.close()]], error); throw error }
  return service
}
