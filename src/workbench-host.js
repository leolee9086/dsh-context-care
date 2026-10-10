import { createHash, randomUUID } from 'node:crypto'
import { normalizeRuleV2 } from '@leolee9086/dsh-rule-engine'
import { extractRawBlocks } from 'dsh-better-session-query/blocks'
import { planDisplayV2 } from './display-plan.js'
import { openWorkbenchStore, entryRule, variableSnapshot, variableKey, validateDocument, validateDocumentSet } from './workbench-store.js'
import { createTemplates } from './templates.js'
import { createBoundedMatcher, MatcherFailure } from './bounded-matcher.js'
import { createDetectorRegistry } from './detector-registry.js'
import { createExecutorRegistry, createActionRuns, compactExecutorRef } from './action-runs.js'
import { originalSessionBlocks, modelRequestBlocks, sessionTurn } from './request-blocks.js'
import { planRequestV2 } from './request-plan.js'
import { requestImpact } from './request-impact.js'
import { entryTurn, entryPolicy, deliveredEntry, deactivatedEntry } from './entry-lifecycle.js'
import { releaseResources } from './resource-cleanup.js'
import { importWorkbench } from './workbench-import.js'
import { createDeltaProjection } from './delta-projection.js'
import { readRuleFiles, assertFileRevision } from './rule-files.js'

const actionKey = (event, action) => JSON.stringify([event.sourceId, event.ruleId, event.ruleRevision, action.id])
const dispatchKey = (event, action) => `$dispatch:${actionKey(event, action)}`
const dispatchItems = planned => [...new Map([...planned.applied, ...(planned.entryTransitions ?? [])].map(item => [dispatchKey(item.event, item.action), item])).values()]
/** Single Request Host contribution: durable documents, shared matching, execution controls and jobs. */
export async function openWorkbenchHost(ctx, controls, { ruleFiles = [], executors: configuredExecutors = [], maxCascadePasses = 4, maxInjectedChars = 65536, maxInjectedTokens = 65536, maxCacheChangedBytes, maxRequestBytes = 8388608, maxQueued = 128, maxConcurrent = 8, maxDeltaChars = 32768, maxDeltaBlocks = 16, matcher: matcherOptions = {}, requiredStages = [] } = {}) {
  const report = error => ctx.logger.warn(`context-care: workbench failed: ${String(error)}`)
  const templates = createTemplates()
  const registrations = new Map(); const observations = new Map(); const admittedSessions = new Map(); let generation = 0; let closed = false; let closing
  let fileFailure; let fileLoad
  const fileRecords = new Map()
  const tailSeq = session => session.snapshotEvents().at(-1)?.seq ?? -1
  const externalDocuments = id => [...registrations.values()].filter(source => !source.sessionId || source.sessionId === id).flatMap(source => source.documents)
  const contributor = (id, document) => [...registrations.values()].find(source => (!source.sessionId || source.sessionId === id) && source.documents.includes(document))
  const store = await openWorkbenchStore(ctx.storageDomain, { templates, report, externalDocuments, admissionSeq: id => {
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
  function documents(agent) {
    const docs = [...record(agent).documents, ...externalDocuments(String(agent.session.id))]
    validateDocumentSet(docs, templates)
    return docs
  }
  function definitions(agent) {
    return documents(agent).flatMap(document => [...document.rules.map(rule => normalizeRuleV2({ ...rule, sourceId: `context-care:document:${document.id}` })),
      ...document.entries.map(entry => entryRule(document, entry))])
  }
  function availability(action, agent, rule) {
    if (fileFailure) return { available: false, reason: `rule-file-load-failed: ${fileFailure.message}` }
    if (rule?.match.kind === 'detector' && !detectors.available(rule, String(agent.session.id), action.stage)) return { available: false, reason: 'detector-unavailable' }
    const held = rule && record(agent).runtime.state[dispatchKey({ sourceId: rule.sourceId, ruleId: rule.id, ruleRevision: rule.revision }, action)]
    if (held?.status === 'unknown') return { available: false, reason: held.reason }
    if (action.stage === 'display.render') {
      if (rule?.select.view === 'model' || rule?.select.crossBlock) return { available: false, reason: 'display-requires-single-original-or-display-block' }
      if (action.patch) return { available: false, reason: 'display-tool-argument-patch-unavailable' }
      if (action.target?.lifetime && action.target.lifetime !== 'request' || action.target?.anchor === 'depth' && action.target.depth > 1)
        return { available: false, reason: 'display-message-target-unavailable' }
      return { available: true }
    }
    if (action.stage === 'tool.before-execute' && action.kind !== 'filter') return { available: false, reason: 'host-tool-arguments-immutable' }
    if (['program', 'tool', 'job', 'compact'].includes(action.kind)) {
      const executor = executors.get(action.kind === 'compact' ? compactExecutorRef : action.executorRef)
      return executor && ctx.tools.get(executor.toolName, agent) !== undefined ? { available: true }
        : { available: false, reason: action.kind === 'compact' ? 'compaction-tool-unavailable' : 'executor-unavailable' }
    }
    return { available: true }
  }
  const sources = id => {
    const agent = ctx.agents.get(id)
    if (!agent) return []
    return documents(agent).map(document => {
      // The contributed object identifies its owner. Scoped registrations may reuse an id in another session.
      const owner = contributor(id, document)
      return { readOnly: owner !== undefined, sourceId: `context-care:document:${document.id}`, sessionId: id, plugin: owner?.plugin ?? 'dsh-context-care',
        registration: owner?.filePath ?? owner?.registrationId ?? document.title, executor: 'dsh-context-care', rules: definitions(agent).filter(rule => rule.sourceId === `context-care:document:${document.id}`).map(rule => ({
          id: rule.id, title: rule.title, description: rule.description, definition: rule,
          actions: rule.actions.map(action => ({ id: action.id, title: action.kind, defaultEnabled: action.enabledDefault, requires: action.dependsOn, ...availability(action, agent, rule) })) })) }
    })
  }
  let disposeProvider
  try { disposeProvider = controls.registerProvider(sources) }
  catch (error) {
    await releaseResources([['workbench-executors', () => executors.close()], ['workbench-matcher', () => matcher.close()], ['workbench-store', () => store.close()]], error)
    throw error
  }
  const token = (agent, variables) => JSON.stringify([store.token(String(agent.session.id), presetId(agent), variables), generation, executors.token(), detectors.token(), controls.revision(String(agent.session.id)),
    controls.epoch(String(agent.session.id), '', ''), templates.versions()])
  function decision(agent, event, action, expected, { delivery = false, dispatchId } = {}) {
    const id = String(agent.session.id)
    if (fileFailure) return { enabled: false, reason: `rule-file-load-failed: ${fileFailure.message}` }
    if (closed || !store.available(id)) return { enabled: false, reason: 'workbench-storage-unavailable' }
    if (expected !== undefined && expected !== token(agent)) return { enabled: false, reason: 'workbench-changed' }
    const selected = controls.decision(id, event.sourceId, event.ruleId, action.id)
    if (!selected.enabled) return selected
    const evidence = event.triggerSeq === undefined ? event.sourceSeqs : [event.triggerSeq]
    if (evidence.some(seq => seq <= controls.sinceSeq(id, event.sourceId, event.ruleId))) return { enabled: false, reason: 'historical-evidence' }
    if (!delivery) {
      const held = record(agent).runtime.state[dispatchKey(event, action)]
      // Only this handoff's queue admission may cross its own reservation. New
      // plans and unresolved crashes remain blocked without consuming success state.
      if (held && held.status !== 'settled' && !(held.status === 'handoff' && held.callId === dispatchId))
        return { enabled: false, reason: held.status === 'unknown' ? held.reason : 'request-dispatch-reserved' }
      const previous = record(agent).runtime.state[actionKey(event, action)]
      if (previous && action.dedupe.mode === 'occurrence' && previous.occurrenceId === event.occurrenceId) return { enabled: false, reason: 'duplicate-occurrence' }
      const entry = documents(agent).find(document => event.sourceId === `context-care:document:${document.id}`)?.entries.find(entry => `entry:${entry.id}` === event.ruleId)
      // Entry activation intervals govern new slices; held slices are materialized on
      // every request. Ordinary rule actions retain their successful-delivery limits.
      if (!entry || action.stage !== 'request.assemble') {
        if (previous && Date.now() - previous.lastStarted < action.cooldownMs) return { enabled: false, reason: 'cooldown' }
        const lifetime = action.target?.lifetime ?? 'request'
        if (previous && (lifetime === 'session' || lifetime === 'turn' && previous.turnId === sessionTurn(agent.session)))
          return { enabled: false, reason: 'action-lifetime-consumed' }
      }
    }
    return selected
  }
  function renderTemplates(agent) {
    const renderer = templates.fork()
    for (const partial of documents(agent).flatMap(document => document.partials)) renderer.registerPartial(partial)
    return renderer
  }
  const jobs = createActionRuns({ store, registry: executors, templates: { render(source, snapshot) {
    const agent = ctx.agents.get(snapshot.session.id)
    if (!agent) throw new Error('template-agent-unavailable')
    return renderTemplates(agent).render(source, snapshot)
  } }, maxQueued, maxConcurrent, report,
    async setVariable(agent, item, value, context) {
      const id = String(agent.session.id)
      const declaration = documents(agent).flatMap(document => document.variables).find(variable => variable.name === item.action.variable)
      if (!declaration) throw new Error('variable-unavailable')
      const variables = { ...record(agent).variables, [variableKey(declaration, context.session.turnId)]: structuredClone(value) }
      const expected = token(agent, variables)
      await store.automaticVariable(id, declaration, value, context.session.turnId, () => service.assertCurrent(agent, { token: item.token }))
      // Renew only for this predicted write. A preference, source, or unrelated variable change cannot be absorbed.
      service.assertCurrent(agent, { token: expected })
      return { token: expected, vars: variableSnapshot({ ...record(agent), documents: documents(agent) }, context.session.turnId) }
    }, approvalFor: agent => ctx.get('agentPresets')?.serviceFor(agent, 'approval') ?? ctx.get('approval'),
    guard: (id, event, action, expected, options) => {
      const agent = ctx.agents.get(id)
      return agent ? decision(agent, event, action, expected, options) : { enabled: false, reason: 'agent-unavailable' }
    } })
  try {
    for (const id of store.sessions()) {
      const unresolved = Object.entries(store.read(id).runtime.state).filter(([key, value]) => key.startsWith('$dispatch:') && ['reserved', 'handoff'].includes(value.status))
      if (unresolved.length) {
        await store.runtime(id, runtime => { for (const [key] of unresolved) Object.assign(runtime.state[key], {
          status: 'unknown', reason: 'request-handoff-unconfirmed-after-restart', updatedAt: Date.now() }) })
        report(new Error(`request-handoff-unconfirmed-after-restart:${id}`))
      }
    }
    await jobs.recover()
  }
  catch (error) {
    await releaseResources([['workbench-provider', disposeProvider], ['workbench-jobs', () => jobs.close()],
      ['workbench-matcher', () => matcher.close()], ['workbench-executors', () => executors.close()], ['workbench-store', () => store.close()]], error)
    throw error
  }
  let disposeCreated
  try {
    // A restored/forked session starts observing after its inherited tail; original blocks remain available as matching context.
    for (const session of ctx.sessions.list()) admittedSessions.set(String(session.id), tailSeq(session))
    disposeCreated = ctx.on('agent/created', ({ agent }) => { admittedSessions.set(String(agent.session.id), tailSeq(agent.session)) })
  } catch (error) {
    await releaseResources([['workbench-provider', disposeProvider], ['workbench-jobs', () => jobs.close()],
      ['workbench-matcher', () => matcher.close()], ['workbench-executors', () => executors.close()], ['workbench-store', () => store.close()]], error)
    throw error
  }
  async function recordMatchFailure(agent, error, sourceSeqs = [], kind = 'matching') {
    const id = String(agent.session.id); const at = Date.now()
    const diagnostic = JSON.parse(JSON.stringify(error.diagnostic))
    const group = JSON.stringify([diagnostic.stage, error.message, diagnostic.rules])
    await store.runtime(id, runtime => {
      // Aggregate repeated failures without presenting a successful or unmatched assessment.
      const previous = runtime.runs.findLast(run => run.kind === kind && run.group === group)
      if (previous) {
        previous.updatedAt = at; previous.count++; previous.result = diagnostic
        previous.sourceSeqs = [...new Set([...previous.sourceSeqs, ...sourceSeqs])].slice(-128)
      } else runtime.runs.push({ id: diagnostic.operationId, group, kind, status: 'failed',
        sourceId: diagnostic.rules[0]?.sourceId ?? 'dsh-context-care', ruleId: diagnostic.rules[0]?.ruleId ?? '', actionId: '',
        reason: error.message, delivery: 'not-requested', createdAt: at, updatedAt: at, count: 1,
        sourceSeqs, inputs: { stage: diagnostic.stage, rules: diagnostic.rules, inputBytes: diagnostic.inputBytes ?? null, blockCount: diagnostic.blockCount }, result: diagnostic })
    })
    report(error)
  }
  async function plan(agent, request, stage, suppliedBlocks, freshSeq) {
    try { return await evaluatePlan(agent, request, stage, suppliedBlocks, freshSeq) }
    catch (error) {
      if (!(error instanceof MatcherFailure) || request.signal?.aborted) throw error
      const seqs = freshSeq === undefined ? [] : [freshSeq]
      await recordMatchFailure(agent, error, seqs)
      if (request.purpose === 'preview' && stage === 'request.assemble' || requiredStages.includes(stage)) throw error
      // Failed optional processing leaves the complete input untouched. No partial patches or actions survive.
      const failedRules = error.diagnostic.rules
      const unchanged = planRequestV2({ request, blocks: [], rules: [], events: [], templates: renderTemplates(agent), snapshot: {}, decision: () => ({ enabled: false }),
        maxInjectedChars, maxInjectedTokens, maxRequestBytes, estimateMessage: message => ctx.tokenMeter.estimateMessage(message) })
      return { ...unchanged, matchStatus: 'failed', failure: error.diagnostic,
        records: failedRules.map(rule => ({ sourceId: rule.sourceId, ruleId: rule.ruleId, status: 'skipped', assessment: 'failed', reason: error.message })),
        token: token(agent), stage, turnId: sessionTurn(agent.session), documents: [], entryTransitions: [], entryPolicies: {}, entryPrevious: {} }
    }
  }
  async function evaluatePlan(agent, request, stage, suppliedBlocks, freshSeq) {
    const captured = token(agent); const docs = documents(agent); const localTemplates = renderTemplates(agent)
    const rules = definitions(agent).filter(rule => rule.on.includes(stage))
    const snapshot = { session: { id: String(agent.session.id), turnId: sessionTurn(agent.session) }, vars: variableSnapshot({ ...record(agent), documents: docs }, sessionTurn(agent.session)),
      ...(freshSeq === undefined ? {} : { currentSeq: freshSeq }) }
    const views = new Set(rules.map(rule => rule.select.view))
    const blocks = suppliedBlocks ?? [
      ...(views.has('original') ? originalSessionBlocks(agent.session) : []),
      ...(views.has('model') ? modelRequestBlocks(agent.session, request, randomUUID()) : []),
    ]
    const id = String(agent.session.id)
    const admittedRules = freshSeq === undefined ? rules : rules.filter(rule => {
      const document = docs.find(document => rule.sourceId === `context-care:document:${document.id}`)
      const owner = contributor(id, document)
      const seq = owner ? (owner.ruleAdmissions?.get(JSON.stringify([rule.id, rule.revision])) ?? owner.admission).get(id) ?? -1
        : record(agent).runtime.state[`$admission:${document.id}`]?.[JSON.stringify([rule.id, rule.revision])]?.seq ?? -1
      // Ineligible historical rules cannot claim an exclusive group before a still-enabled sibling.
      return freshSeq > Math.max(seq, controls.sinceSeq(id, rule.sourceId, rule.id))
    })
    let enabled = admittedRules.map(rule => ({ ...rule, actions: rule.actions.filter(action => controls.enabled(id, rule.sourceId, rule.id, action.id)) })).filter(rule => rule.actions.length)
    const entries = new Map(docs.flatMap(document => document.entries.filter(entry => entry.target.view === 'model').map(entry =>
      [JSON.stringify([`context-care:document:${document.id}`, `entry:${entry.id}`, entry.revision, 'inject']), entry])))
    const policies = {}; const entryPrevious = {}; const entryTransitions = []
    const turn = stage === 'request.assemble' ? entryTurn(agent.session) : undefined
    if (stage === 'request.assemble') {
      // Observe each entry's strict baseline condition independently of exclusive
      // group selection. A held slice must not hide a sibling's activation facts.
      const strict = enabled.filter(rule => entries.has(actionKey({ sourceId: rule.sourceId, ruleId: rule.id, ruleRevision: rule.revision }, rule.actions[0])))
        .map(({ exclusiveGroup, ...rule }) => rule)
      const matched = await matcher.detect({ rules: strict, blocks, stage, snapshot }, request.signal,
        { sessionId: id, current: () => captured === token(agent) })
      const matches = new Set(matched.map(event => JSON.stringify([event.sourceId, event.ruleId])))
      snapshot.materializations = {}
      enabled = enabled.map(rule => {
        const action = rule.actions[0]; const event = { sourceId: rule.sourceId, ruleId: rule.id, ruleRevision: rule.revision }
        const key = actionKey(event, action); const entry = entries.get(key)
        if (!entry) return rule
        const previous = record(agent).runtime.state[key]
        entryPrevious[key] = previous ?? null
        const policy = policies[key] = entryPolicy(entry, previous, { turnId: snapshot.session.turnId, turn, matches: matches.has(JSON.stringify([rule.sourceId, rule.id])) })
        if (policy.reuse) snapshot.materializations[key] = policy.text
        if (policy.inactive) entryTransitions.push({ event: { ...event, occurrenceId: `entry-inactive:${key}:${snapshot.session.turnId}`, sourceSeqs: [] }, action, key })
        // A cooling entry remains visible as skipped evidence, but cannot claim
        // the exclusive group needed by an eligible sibling.
        const { exclusiveGroup, ...ungrouped } = rule
        const candidate = policy.reason ? ungrouped : rule
        return policy.reuse ? { ...candidate, match: { kind: 'always' } } : candidate
      })
    }
    const detected = await matcher.detect({ rules: enabled, blocks, stage, snapshot, freshSeq }, request.signal,
      { sessionId: id, scope: request.detectorScope, epoch: captured, current: () => captured === token(agent) })
    const events = request.deltaProjection ? request.deltaProjection.unseen(detected) : detected
    const decide = (event, action) => {
      const selected = decision(agent, event, action, captured)
      const policy = policies[actionKey(event, action)]
      return selected.enabled && policy?.reason ? { enabled: false, reason: policy.reason } : selected
    }
    const estimateMessage = message => ctx.tokenMeter.estimateMessage(message)
    const planned = planRequestV2({ request, blocks, rules, events, templates: localTemplates, snapshot, decision: decide,
      maxInjectedChars, maxInjectedTokens, maxCacheChangedBytes, maxRequestBytes, estimateMessage })
    if (stage === 'request.assemble') {
      const visited = new Set(events.map(event => JSON.stringify([event.sourceId, event.ruleId])))
      const cascading = new Set(docs.flatMap(document => document.entries.filter(entry => entry.cascade).map(entry => JSON.stringify([`context-care:document:${document.id}`, `entry:${entry.id}`]))))
      for (let pass = 1; cascading.size && pass <= maxCascadePasses + 1; pass++) {
        const remaining = enabled.filter(rule => cascading.has(JSON.stringify([rule.sourceId, rule.id])) && !visited.has(JSON.stringify([rule.sourceId, rule.id])))
        if (!remaining.length) break
        // Only explicit cascade entries scan the changed model view. Baseline rules and programs never replay here.
        const nextBlocks = [...originalSessionBlocks(agent.session), ...modelRequestBlocks(agent.session, planned.request, randomUUID())]
        const found = await matcher.detect({ rules: remaining, blocks: nextBlocks, stage, snapshot }, request.signal,
          { sessionId: id, current: () => captured === token(agent) })
        if (!found.length) break
        if (pass > maxCascadePasses) {
          planned.records.push(...found.map(event => ({ sourceId: event.sourceId, ruleId: event.ruleId, status: 'skipped', reason: 'cascade-pass-limit' })))
          break
        }
        for (const event of found) {
          visited.add(JSON.stringify([event.sourceId, event.ruleId]))
          for (const action of remaining.find(rule => rule.sourceId === event.sourceId && rule.id === event.ruleId).actions) {
            const key = actionKey(event, action); const entry = entries.get(key)
            if (!entry) continue
            // Only an explicit cascade can renew activation from injected text.
            policies[key] = entryPolicy(entry, entryPrevious[key] ?? undefined, { turnId: snapshot.session.turnId, turn, matches: true })
            if (policies[key].reuse) snapshot.materializations[key] = policies[key].text
          }
        }
        const next = planRequestV2({ request: planned.request, blocks: nextBlocks, rules, events: found, templates: localTemplates, snapshot, decision: decide,
          maxInjectedChars: maxInjectedChars - planned.injectedChars, maxInjectedTokens: maxInjectedTokens - planned.injectionBudget.tokens,
          maxCacheChangedBytes, impactBaseline: request, maxRequestBytes, estimateMessage })
        planned.request = next.request; planned.diff.after = next.diff.after; planned.injectedChars += next.injectedChars
        planned.injectionBudget.tokens += next.injectionBudget.tokens
        planned.records.push(...next.records.map(record => ({ ...record, cascadePass: pass })))
        planned.applied.push(...next.applied); planned.scheduled.push(...next.scheduled)
      }
    }
    planned.impact = requestImpact(request, planned.request)
    if (maxCacheChangedBytes !== undefined && planned.impact.changedSuffixBytes > maxCacheChangedBytes) throw new Error('request-cache-change-budget-exceeded')
    if (captured !== token(agent)) throw new Error('workbench-changed-during-planning')
    const transitions = entryTransitions.filter(item => policies[item.key].inactive
      && !planned.applied.some(applied => applied.key === item.key) && decision(agent, item.event, item.action, captured).enabled)
    planned.records.push(...transitions.map(item => ({ sourceId: item.event.sourceId, ruleId: item.event.ruleId, actionId: item.action.id,
      status: 'planned', reason: 'entry-deactivation' })))
    return { ...planned, entryPolicies: policies, entryPrevious, entryTransitions: transitions, turn,
      token: captured, stage, turnId: snapshot.session.turnId, documents: docs.map(document => ({ id: document.id, revision: document.revision })) }
  }
  const service = {
    store, executors, sources, token, presetId, turnId: agent => sessionTurn(agent.session),
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
        values: variableSnapshot({ ...state, documents: docs }, turnId), fileError: fileFailure?.message ?? null,
        executors: executors.catalog(), sources: sources(String(agent.session.id)),
        dispatches: Object.entries(state.runtime.state).filter(([key]) => key.startsWith('$dispatch:')).map(([key, value]) => ({ key, ...value })) }
    },
    async reloadFiles() {
      if (closed) throw new Error('workbench-closed')
      if (!ruleFiles.length) return
      if (fileLoad) return fileLoad
      fileLoad = (async () => {
        try {
          const loaded = await readRuleFiles(ruleFiles)
          if (closed) throw new Error('workbench-closed')
          const next = loaded.map(item => ({ ...item, document: validateDocument(item.document, templates) }))
          for (const item of next) assertFileRevision(fileRecords.get(item.path)?.document, item.document)
          const foreign = [...registrations.values()].filter(owner => !owner.filePath)
          const docs = next.map(item => item.document)
          validateDocumentSet([...foreign.filter(owner => !owner.sessionId).flatMap(owner => owner.documents), ...docs], templates)
          const localSets = store.documentSets()
          for (const id of new Set([...localSets.keys(), ...foreign.map(owner => owner.sessionId).filter(Boolean)]))
            validateDocumentSet([...(localSets.get(id) ?? []), ...foreign.filter(owner => !owner.sessionId || owner.sessionId === id).flatMap(owner => owner.documents), ...docs], templates)
          // Publish a fully validated set synchronously. Failed refreshes keep the
          // acknowledged definitions visible, but block their automatic execution.
          for (const item of next) {
            const previous = fileRecords.get(item.path)
            if (previous && JSON.stringify(previous.document) === JSON.stringify(item.document)) { fileRecords.set(item.path, item); continue }
            const admission = new Map(ctx.sessions.list().map(session => [String(session.id), tailSeq(session)]))
            const oldOwner = registrations.get(`$file:${item.path}`)
            const ruleAdmissions = new Map([...item.document.rules, ...item.document.entries.map(entry => ({ ...entry, id: `entry:${entry.id}` }))]
              .map(rule => { const key = JSON.stringify([rule.id, rule.revision]); return [key,
                previous?.document.id === item.document.id ? oldOwner?.ruleAdmissions?.get(key) ?? admission : admission] }))
            registrations.set(`$file:${item.path}`, { plugin: 'dsh-context-care', filePath: item.path, documents: [item.document], admission, ruleAdmissions })
            fileRecords.set(item.path, item); generation++
          }
          if (fileFailure) { fileFailure = undefined; generation++ }
        } catch (error) {
          fileFailure = error; generation++; report(error); throw error
        }
      })()
      try { await fileLoad } finally { fileLoad = undefined }
    },
    register({ plugin, registrationId, sessionId, documents: contributed }) {
      if (closed) throw new Error('workbench-closed')
      if (registrationId?.startsWith('$file:')) throw new Error('workbench-registration-reserved')
      if (!plugin || !registrationId || registrations.has(registrationId)) throw new Error('workbench-registration-conflict')
      const docs = contributed.map(document => validateDocument(document, templates))
      const overlapping = [...registrations.values()].filter(source => !sessionId || !source.sessionId || source.sessionId === sessionId).flatMap(source => source.documents)
      validateDocumentSet([...overlapping, ...docs], templates)
      for (const [id, local] of store.documentSets()) if (!sessionId || id === sessionId)
        validateDocumentSet([...local, ...externalDocuments(id), ...docs], templates)
      const admission = new Map(ctx.sessions.list().filter(session => !sessionId || String(session.id) === sessionId).map(session => [String(session.id), tailSeq(session)]))
      const value = { plugin, registrationId, sessionId, documents: docs, admission }; registrations.set(registrationId, value); generation++
      return () => { if (registrations.get(registrationId) === value) { registrations.delete(registrationId); generation++ } }
    },
    registerDetector(specification) {
      if (closed) throw new Error('workbench-closed')
      return detectors.register(specification)
    },
    detectorCatalog: () => detectors.catalog(),
    registerExecutor(specification) {
      if (closed) throw new Error('workbench-closed')
      return executors.registerTool(specification)
    },
    registerPartial(specification) {
      if (closed) throw new Error('workbench-closed')
      const docs = [...store.documentSets().values()].flat().concat([...registrations.values()].flatMap(source => source.documents))
      if (docs.some(document => document.partials.some(partial => partial.name === specification.name))) throw new Error('template-partial-conflict')
      return templates.registerPartial(specification)
    },
    registerHelper(specification) {
      if (closed) throw new Error('workbench-closed')
      return templates.registerHelper(specification)
    },
    import: input => importWorkbench(input, templates),
    async preview(agent, request) { return plan(agent, request, 'request.assemble') },
    /** Re-render historical blocks with current preferences, without consuming automatic action state. */
    async display(agent, seq, signal) {
      if (closed || !store.available(String(agent.session.id))) throw new Error('workbench-storage-unavailable')
      if (fileFailure) throw new Error(`rule-file-load-failed: ${fileFailure.message}`)
      if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('display-invalid-sequence')
      const event = agent.session.snapshotEvents().find(event => event.seq === seq)
      if (!event || !['assistant/message', 'user/message', 'system/message', 'tool/result'].includes(event.type)) throw new Error('display-message-unavailable')
      const captured = token(agent); const id = String(agent.session.id); const docs = documents(agent)
      const rules = definitions(agent).filter(rule => rule.on.includes('display.render'))
      const enabled = rules.map(rule => ({ ...rule, actions: rule.actions.filter(action => action.stage === 'display.render' && controls.enabled(id, rule.sourceId, rule.id, action.id)) })).filter(rule => rule.actions.length)
      if (!enabled.length) return { seq, changed: false, before: [], after: [], records: [] }
      let turnId = `${id}:seed`; const original = []
      for (const prior of agent.session.snapshotEvents()) {
        if (prior.seq > seq) break
        if (prior.type === 'turn/start') turnId = `${id}:turn:${prior.data.turn ?? prior.seq}`
        if (['assistant/message', 'user/message', 'system/message', 'tool/result'].includes(prior.type)) original.push(...extractRawBlocks(prior, { sessionId: id, turnId }))
      }
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
        const projection = planDisplayV2({ blocks: display.filter(block => block.seq === seq), rules, events, templates: renderTemplates(agent), snapshot,
          decision: (event, action) => controls.decision(id, event.sourceId, event.ruleId, action.id), maxInjectedChars, maxBytes: maxRequestBytes })
        result = { seq, ...projection }
        // Include identity, change flag and HTTP envelope in the published byte budget.
        if (Buffer.byteLength(JSON.stringify({ projections: result.changed ? [result] : [] }), 'utf8') > maxRequestBytes) throw new Error('display-result-budget-exceeded')
      } catch (cause) {
        if (signal?.aborted) throw signal.reason ?? cause
        // Presentation planning is optional. Keep its fault distinct from matching;
        // neither persist template/message text nor let a broken display end a turn.
        const fixedPatchReasons = ['rules-v2: block cannot be text-patched', 'rules-v2: stale block anchor',
          'rules-v2: cross-block replacement requires per-block patches', 'rules-v2: invalid patch range', 'rules-v2: replacement must be text']
        const fixedDisplayReasons = ['display-rule-unavailable', 'display-dependency-cycle', 'display-cross-block-write-unavailable',
          'display-action-output-budget-exceeded', 'display-text-range-unavailable', 'display-opaque-filter-denied', 'display-target-unavailable',
          'display-message-depth-unavailable', 'display-anchor-unavailable', 'display-injection-budget-exceeded', 'display-result-budget-exceeded']
        const reason = [...fixedDisplayReasons, ...fixedPatchReasons].includes(cause?.message) ? cause.message : 'display-planning-failed'
        const error = Object.assign(new Error(reason, { cause }), { code: 'CONTEXT_CARE_DISPLAY_FAILED', diagnostic: {
          operationId: randomUUID(), stage: 'display.render', phase: 'planning', failureClass: cause?.name ?? 'Error',
          rules: enabled.map(rule => ({ sourceId: rule.sourceId, ruleId: rule.id, revision: rule.revision })), blockCount: display.length,
        } })
        await recordMatchFailure(agent, error, [seq], 'display')
        throw error
      }
      if (signal?.aborted) throw signal.reason ?? new Error('display-cancelled')
      if (captured !== token(agent)) throw new Error('workbench-changed-during-display')
      return result
    },
    openDelta(agent, { requestId, attemptId }) {
      if (!requestId || !attemptId) throw new Error('delta-request-identity-required')
      const projection = createDeltaProjection({ sessionId: String(agent.session.id), requestId, attemptId, turnId: sessionTurn(agent.session), maxChars: maxDeltaChars, maxBlocks: maxDeltaBlocks })
      const scope = JSON.stringify([String(agent.session.id), requestId, attemptId]); let policy
      return {
        async feed(chunk, signal) {
          const enabled = definitions(agent).some(rule => rule.on.includes('output.delta') && rule.actions.some(action =>
            action.stage === 'output.delta' && controls.enabled(String(agent.session.id), rule.sourceId, rule.id, action.id)))
          const currentPolicy = token(agent)
          if (policy !== currentPolicy || !enabled) {
            await detectors.release(scope, enabled ? 'policy-changed' : 'detectors-inactive')
            projection.feed({ type: 'inactive' }, currentPolicy); policy = currentPolicy
          }
          // Finalization sees the real bounded block before block-end/finish removes it.
          const ending = ['block-end', 'finish'].includes(chunk.type)
          const final = enabled && ending ? projection.finalize(chunk.type === 'block-end' ? chunk.index : undefined) : []
          const blocks = ending ? final : projection.feed(enabled ? chunk : { type: 'inactive' }, currentPolicy)
          if (ending) projection.feed(chunk, currentPolicy)
          if (!blocks.length) {
            if (chunk.type === 'finish') await detectors.release(scope)
            else if (chunk.type === 'block-end') await detectors.releaseBlock(scope, chunk.index)
            return
          }
          const planned = await plan(agent, { messages: [], purpose: 'preview', signal, deltaProjection: projection, detectorScope: scope }, 'output.delta', blocks)
          await jobs.enqueue(String(agent.session.id), planned.scheduled, planned.token)
          projection.acknowledge(planned.scheduled.map(item => item.event))
          // Await the real control point. Abort and its dependent followup settle
          // before requesting another provider chunk; notices retain next-step delivery.
          await jobs.drain(agent, signal)
          if (chunk.type === 'finish') await detectors.release(scope)
          else if (chunk.type === 'block-end') await detectors.releaseBlock(scope, chunk.index)
        },
        async close() { projection.close(); await detectors.release(scope) },
      }
    },
    async assemble(agent, request) { await service.reloadFiles(); await service.reconcile(agent, request.signal); return plan(agent, request, 'request.assemble') },
    assertCurrent(agent, planned) {
      if (planned.token !== token(agent)) throw Object.assign(new Error('workbench-changed-before-dispatch'), { code: 'CONTROL_CHANGED' })
      // A request planned in another turn must not activate or expire a slice in
      // the current turn. Token-only guards used by automatic variables stay valid.
      if (planned.stage === 'request.assemble' && planned.turnId !== sessionTurn(agent.session))
        throw Object.assign(new Error('workbench-turn-changed-before-dispatch'), { code: 'CONTROL_CHANGED' })
    },
    async reserve(agent, planned, callId) {
      if (typeof callId !== 'string' || !callId) throw new Error('request-call-id-required')
      if (!dispatchItems(planned).length) return
      const id = String(agent.session.id)
      await store.runtime(id, runtime => {
        service.assertCurrent(agent, planned)
        for (const { event, action } of dispatchItems(planned)) {
          const entryKey = actionKey(event, action)
          if (Object.hasOwn(planned.entryPrevious ?? {}, entryKey)
            && JSON.stringify(runtime.state[entryKey] ?? null) !== JSON.stringify(planned.entryPrevious[entryKey])) throw new Error('entry-state-changed-before-dispatch')
          const key = dispatchKey(event, action); const held = runtime.state[key]
          if (held && held.status !== 'settled' && !(held.status === 'reserved' && held.callId === callId)) throw new Error('request-dispatch-reserved')
          runtime.state[key] = { status: 'reserved', callId, occurrenceId: event.occurrenceId, updatedAt: Date.now() }
        }
      })
      service.assertCurrent(agent, planned)
    },
    async rollback(agent, callId) {
      const id = String(agent.session.id)
      if (!Object.entries(record(agent).runtime.state).some(([key, held]) => key.startsWith('$dispatch:') && held.callId === callId && held.status === 'reserved')) return
      await store.runtime(id, runtime => {
        for (const [key, held] of Object.entries(runtime.state)) if (key.startsWith('$dispatch:') && held.callId === callId && held.status === 'reserved') delete runtime.state[key]
      })
    },
    async unknown(agent, callId) {
      const id = String(agent.session.id)
      if (!Object.entries(record(agent).runtime.state).some(([key, held]) => key.startsWith('$dispatch:') && held.callId === callId && ['reserved', 'handoff'].includes(held.status))) return
      await store.runtime(id, runtime => {
        for (const [key, held] of Object.entries(runtime.state)) if (key.startsWith('$dispatch:') && held.callId === callId && ['reserved', 'handoff'].includes(held.status))
          Object.assign(held, { status: 'unknown', reason: 'request-handoff-ack-unconfirmed', updatedAt: Date.now() })
      })
    },
    async dispatched(agent, planned, callId) {
      if (typeof callId !== 'string' || !callId) throw new Error('request-call-id-required')
      const id = String(agent.session.id)
      await store.runtime(id, runtime => {
        for (const { event, action } of dispatchItems(planned)) {
          const held = runtime.state[dispatchKey(event, action)]
          if (!held || held.callId !== callId || held.status !== 'reserved') throw new Error('request-reservation-unavailable')
          Object.assign(held, { status: 'handoff', updatedAt: Date.now() })
        }
        for (const { key } of planned.entryTransitions ?? []) runtime.state[key] = deactivatedEntry(runtime.state[key])
        for (const { event, action, text } of planned.applied.filter(item => !planned.scheduled.some(job => job.event === item.event && job.action === item.action))) {
          const key = actionKey(event, action)
          const entry = documents(agent).find(document => `context-care:document:${document.id}` === event.sourceId)?.entries.find(entry => `entry:${entry.id}` === event.ruleId)
          runtime.state[key] = entry && planned.entryPolicies?.[key]
            ? { ...deliveredEntry(entry, runtime.state[key], planned.entryPolicies[key], text, { turnId: planned.turnId, turn: planned.turn }), occurrenceId: event.occurrenceId }
            : { lastStarted: Date.now(), occurrenceId: event.occurrenceId, turnId: planned.turnId }
        }
      })
      await jobs.enqueue(id, planned.scheduled.map(item => ({ ...item, dispatchId: callId })), planned.token)
      if (dispatchItems(planned).length) await store.runtime(id, runtime => {
        for (const { event, action } of dispatchItems(planned)) {
          const held = runtime.state[dispatchKey(event, action)]
          if (!held || held.callId !== callId || held.status !== 'handoff') throw new Error('request-handoff-reservation-unavailable')
          Object.assign(held, { status: 'settled', updatedAt: Date.now() })
        }
      })
    },
    async reconcile(agent, signal) {
      const id = String(agent.session.id)
      if (observations.has(id)) return observations.get(id)
      const operation = (async () => {
        const lastSeq = Math.max(record(agent).runtime.state['$observed']?.seq ?? -1, admittedSessions.get(id) ?? -1)
        const events = agent.session.snapshotEvents()
        const displayRules = definitions(agent).filter(rule => rule.on.includes('display.render') && rule.actions.some(action => controls.enabled(id, rule.sourceId, rule.id, action.id)))
        if (displayRules.length) {
          const displaySeq = Math.max(record(agent).runtime.state['$displayObserved']?.seq ?? -1, admittedSessions.get(id) ?? -1)
          for (const event of events.filter(event => event.seq > displaySeq && ['assistant/message', 'user/message', 'system/message', 'tool/result'].includes(event.type))) {
            let assessment = 'completed'
            try {
              const projection = await service.display(agent, event.seq, signal)
              if (projection.changed) await store.runtime(id, runtime => {
                runtime.state['$displayMarkers'] = [...(runtime.state['$displayMarkers'] ?? []).filter(value => value.seq !== event.seq),
                  { seq: event.seq, token: token(agent) }].slice(-256)
              })
            } catch (error) {
              if (signal?.aborted || !(error instanceof MatcherFailure || error.code === 'CONTEXT_CARE_DISPLAY_FAILED')) throw error
              assessment = 'failed' // display() retained the actual fault; avoid repeating old failures each boundary.
            }
            await store.runtime(id, runtime => { runtime.state['$displayObserved'] = { seq: event.seq, assessment } })
          }
        }
        const relevant = definitions(agent).some(rule => ['output.complete', 'tool.result'].some(stage => rule.on.includes(stage)))
        const all = relevant ? originalSessionBlocks(agent.session) : []
        for (const event of events.filter(event => event.seq > lastSeq && (event.type === 'assistant/message' && !event.data.interrupted || event.type === 'tool/result'))) {
          // Later committed messages cannot influence this output's depth window or captures.
          const selected = all.filter(block => block.seq <= event.seq)
          const planned = await plan(agent, { messages: agent.session.deriveMessages(), purpose: 'preview', signal }, event.type === 'tool/result' ? 'tool.result' : 'output.complete', selected, event.seq)
          await jobs.enqueue(id, planned.scheduled, planned.token)
          await store.runtime(id, runtime => {
            // This is an attempted watermark. A failed assessment is explicitly retained as failed.
            runtime.state['$observed'] = { seq: event.seq, assessment: planned.matchStatus === 'failed' ? 'failed' : 'completed' }
          })
        }
      })()
      observations.set(id, operation)
      try { await operation } finally { observations.delete(id) }
    },
    async beforeExecute(exec) {
      const agent = exec.agent
      if (!agent) return undefined
      const captured = token(agent)
      const rules = definitions(agent).filter(rule => rule.on.includes('tool.before-execute')).map(rule => ({ ...rule,
        actions: rule.actions.filter(action => action.stage === 'tool.before-execute' && controls.enabled(String(agent.session.id), rule.sourceId, rule.id, action.id)) })).filter(rule => rule.actions.length)
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
      for (const event of events) for (const action of rules.find(rule => rule.id === event.ruleId && rule.sourceId === event.sourceId).actions) {
        if (action.kind !== 'filter' || action.stage !== 'tool.before-execute' || !decision(agent, event, action, captured).enabled) continue
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
      closing = releaseResources([['workbench-file-load', () => fileLoad], ['workbench-created-listener', disposeCreated], ['workbench-provider', disposeProvider], ['workbench-jobs', () => jobs.close()],
        ['workbench-matcher', () => matcher.close()], ...[...observations.values()].map((operation, index) => [`workbench-observation:${index}`, () => operation]),
        ['workbench-executors', () => executors.close()], ['workbench-store', () => store.close()]])
      return closing
    },
  }
  try { await service.reloadFiles() }
  catch (error) { await releaseResources([['workbench-open-files', () => service.close()]], error); throw error }
  return service
}
