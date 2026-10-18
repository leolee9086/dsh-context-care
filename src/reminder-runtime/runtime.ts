import { randomUUID, createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { Source, ReminderConfig, compileRule } from './schema.js'
import type { DeclaredEvents } from './schema.js'
import type { EventFieldShape } from './generated/session-events.js'
import { CapacitySettings, CapacityError } from './capacity.js'
import { localWindow, humanActivity, requestContext, requestEligible } from './request-context.js'
import type { MessageView } from './request-context.js'
import { matchesScope } from './scope.js'
import type { RecipientIdentity } from './scope.js'
import { changeClaims, quotaFor, hasClaim } from './claims.js'
import { createDenialTickets, openPreExecution } from './denial.js'
import { SESSION_EVENT_TYPES } from './generated/session-events.js'

/** Built-in names, which a custom event may not shadow. */
const BUILT_IN_EVENT_NAMES = new Set<string>(SESSION_EVENT_TYPES)
import { parseOrThrow } from './schema-error.js'
import type { DenialVerdict, PreExecution } from './denial.js'
import type { ClaimOperation } from './claims.js'
import { Detector, SessionState, Event, MatchResult, AnalysisFacts, jsonCopy, errorMessage, errorDetail } from './state.js'
import type { CandidateValue, StateValue, SourceValue, RuleValue, DetectorValue, Rejection, RegisteredSource, Run, RuntimeOptions, RequestInput, CollectInput, ToolPreparation, EventValue } from './state.js'
export { ReminderConfig } from './schema.js'
export { REMINDER_DOMAIN } from './state.js'
export type { RuntimeOptions } from './state.js'
/** The selector shape a custom event descriptor declares, reused from the generated catalog. */
export type { EventFieldShape } from './generated/session-events.js'

/** Public source declarations keep schema defaults optional until registration. */
export type ReminderSource = import('zod').input<typeof Source>
export type ReminderRuleInput = ReminderSource['rules'][number]
/** Consumers take only the methods they need from the actual runtime factory. */
export type ReminderService = ReturnType<typeof createReminderRuntime>
export type ReminderSourceHandle = ReturnType<ReminderService['registerSource']>

export const REMINDER_SERVICE = 'reminderRules'
/**
 * Source kind of a reminder delivery. It also guards session-event matching:
 * a delivery is itself a logged message, so matching must not consume its own output.
 */
export const REMINDER_MESSAGE_KIND = 'plugin:dsh-context-care:reminder'
const keyOf = (sourceId: string, ruleId: string) => JSON.stringify([sourceId, ruleId, 'model'])
const sourceSignature = (source: SourceValue, rule: RuleValue) => createHash('sha256').update(JSON.stringify({
  plugin: source.plugin, sessionId: source.sessionId, scope: source.scope, rule,
})).digest('hex')
/**
 * The frozen event facts a reminder template may read. Captures, counts and the
 * decision itself live beside these in the same evidence record, so one snapshot
 * answers every question the template can ask.
 */
function frozenFacts(event: EventValue) {
  return AnalysisFacts.parse(jsonCopy({ type: event.type, name: event.name, arguments: event.arguments,
    error: event.error, output: event.output, clock: event.clock, humanActivity: event.humanActivity }))
}
function reminderKeys(message: MessageView) {
  if (message.source?.kind !== REMINDER_MESSAGE_KIND) return []
  if (!message.source.reminder) throw new Error('reminder-message-key-missing')
  return [message.source.reminder.key]
}
function reminderSource(candidate: CandidateValue) {
  return { kind: REMINDER_MESSAGE_KIND, form: 'notice', summary: candidate.title,
    reminder: { key: candidate.key, candidateId: candidate.id },
    contextCareTrace: { trigger: 'reminder-rule', evaluationId: candidate.id, ruleId: candidate.ruleId,
      sourceId: candidate.sourceId, callId: candidate.eventId, rule: candidate.rule, evidence: candidate.evidence,
      ...(candidate.output ? { output: candidate.output } : {}) } } as const
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-context-care:reminder': ReturnType<typeof reminderSource>
  }
}

function reminderMessage(candidate: CandidateValue, messageId: string) {
  // IDs are allocated by this runtime and retained through reservation/recovery.
  return { id: messageId as MessageId, role: 'user', content: [{ type: 'text', text: candidate.text }],
    source: reminderSource(candidate) } satisfies UserMessage
}

/** One runtime owns source snapshots, evaluation lifetimes and durable candidate records.
 * save ACKs before publishing state; execute must settle cancellation after its worker stops.
 * No Cordis or live session objects enter the scheduler. */
export function createReminderRuntime({ config: input, entries = [], templates, save = async () => {}, execute = async () => { throw new Error('reminder-executor-unavailable') },
  capacity, saveCapacity = async () => {}, dispatches = false, resolvePreset, resolveIdentity, updateClaims,
  wallNow = () => Date.now(), now = () => performance.now(), eligible = () => true, epoch = () => 0, report = () => {} }: RuntimeOptions = {}) {
  const config = ReminderConfig.parse(input)
  let settings = CapacitySettings.parse(capacity ?? { revision: 0, maxRules: config.maxRules })
  let capacityWrite: Promise<unknown> = Promise.resolve()
  const rejectedSources = new Map<string, Rejection>()
  const records = new Map([...entries].map(([id, value]) => [id, SessionState.parse(jsonCopy(value))] as const))
  // Only candidates loaded at startup may rebind to an identical source definition.
  const recovered = new Set([...records.values()].flatMap(state => state.candidates.map(candidate => candidate.id)))
  const sources = new Map<string, RegisteredSource>(), detectors = new Map<string, DetectorValue>(), analyzers = new Map<string, DetectorValue>()
  const chains = new Map<string, Promise<unknown>>(), queues = new Map<string, Run[]>(), running = new Map<string, Run>()
  const failures = new Map<string, unknown>(), admissions = new Set<{ sessionId: string; controller: AbortController; task?: Promise<void> }>()
  let closed = false, pumping = false
  // Tickets outlive one evaluation round but never a policy change; a stale ticket must not permit a call.
  const tickets = createDenialTickets(config.ruleTimeoutMs * 4, () => performance.now())
  // Reminder-caused activations per session. A human turn breaks the chain; the
  // budget is what stops two rules from ping-ponging without a shared causal store.
  const reminderChains = new Map<string, number>()
  // Declared custom events: a rule may select one by name once its owner declares it.
  const customEvents = new Map<string, EventFieldShape>()
  const declaredEvents = (): DeclaredEvents => ({ names: new Set(customEvents.keys()), shapes: customEvents })
  /**
   * Whether loop prevention suppresses this activation. A reminder may not be re-activated
   * by the message it generated itself, and reminder-caused activations share one budget
   * per session. A due denial is never suppressed: loop prevention must not allow a call
   * that should still be refused.
   */
  function loopBlocked(event: EventValue, sourceId: string, ruleId: string, effect: string): boolean {
    if (event.origin !== 'reminder' || effect === 'deny-tool') return false
    return event.causationId === `${sourceId}:${ruleId}` || (reminderChains.get(event.sessionId) ?? 0) > config.maxReminderChain
  }
  const empty = (): StateValue => ({ seen: [], candidates: [], diagnostics: [], windows: [], stickies: [] })
  const serial = <T>(id: string, fn: () => T | Promise<T>) => {
    const task = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(fn)
    chains.set(id, task)
    return task
  }
  /**
   * Reject an unusable body while the source is being registered, so a broken
   * template never reaches delivery. Without the engine, only fixed text is legal.
   */
  function validateText(source: string) {
    if (templates) return templates.validate(source)
    if (source.includes('{{')) throw new Error('reminder-template-engine-unavailable')
  }
  /** Render a body once; the injected engine is the only substitution mechanism. */
  function renderText(source: string, snapshot: unknown) {
    return templates ? templates.render(source, snapshot) : source
  }
  async function claims(operation: Omit<ClaimOperation, 'at' | 'maxBytes'>) {
    if (!updateClaims) throw new Error('reminder-shared-storage-unavailable')
    return updateClaims(book => changeClaims(book, { ...operation, at: wallNow(), maxBytes: config.maxClaimBytes }))
  }
  async function update<T>(id: string, change: (state: StateValue) => T | Promise<T>, onFailure?: () => Promise<unknown>) {
    return serial(id, async () => {
      try {
        const next = structuredClone(records.get(id) ?? empty())
        // Window claims outlive candidate eviction and surface compaction, but expire at the local window end.
        next.windows = (next.windows ?? []).filter(item => item.until > wallNow())
        for (const candidate of next.candidates) {
          if (candidate.window && wallNow() >= candidate.window.end) candidate.status = 'discarded'
        }
        const value = await change(next)
        next.diagnostics = next.diagnostics.slice(-config.maxCandidates)
        next.seen = next.seen.slice(-config.maxQueued * 4)
        // Do not evict an undelivered candidate to make space for a new one.
        while (next.candidates.length > config.maxCandidates) {
          const index = next.candidates.findIndex(item => item.status === 'delivered' || item.status === 'discarded')
          if (index < 0) throw new Error('reminder-candidate-capacity-exceeded')
          next.candidates.splice(index, 1)
        }
        if (Buffer.byteLength(JSON.stringify(next)) > config.maxBytes) throw new Error('reminder-retained-budget-exceeded')
        try { await save(id, next); failures.delete(id) }
        catch (error) { failures.set(id, error); throw error }
        records.set(id, next)
        return value
      } catch (error) {
        // Compensation finishes inside the session queue, before another collection can retry.
        if (onFailure) {
          try { await onFailure() }
          catch (releaseError) { throw new AggregateError([error, releaseError], 'reminder-reservation-release-failed') }
        }
        throw error
      }
    })
  }
  function fresh(candidate: CandidateValue) {
    const at = wallNow()
    if (candidate.window && (at < candidate.window.start || at >= candidate.window.end)) return false
    return !candidate.request || requestEligible(candidate.rule, { ...candidate.request, clock: { at } })
  }
  async function identity(sessionId: string, agentPreset?: string, signal?: AbortSignal): Promise<RecipientIdentity> {
    // Host identity is read afresh at each boundary; event metadata never overrides it.
    signal?.throwIfAborted()
    if (resolveIdentity) {
      const facts = await resolveIdentity(sessionId, signal)
      signal?.throwIfAborted()
      return { ...facts, sessionId }
    }
    const preset = resolvePreset ? resolvePreset(sessionId) : agentPreset
    return { sessionId, ...(preset === undefined ? {} : { agentPreset: preset }) }
  }
  function sourceAccepts(item: RegisteredSource, target: RecipientIdentity) {
    const source = item.value
    return item.acceptSession(target.sessionId)
      && (source.sessionId === undefined || source.sessionId === target.sessionId)
      && matchesScope(target, source.scope ?? {})
  }
  function ruleAccepts(rule: RuleValue, target: RecipientIdentity) {
    return matchesScope(target, rule.scope ?? {})
  }
  function current(candidate: CandidateValue, target: RecipientIdentity) {
    const source = sources.get(candidate.sourceId)
    const rule = source?.value.rules.find(value => value.id === candidate.ruleId)
    if (!source || !rule) return false
    const sameDefinition = source.token === candidate.sourceToken || (recovered.has(candidate.id)
      && candidate.sourceSignature === sourceSignature(source.value, rule))
    return sameDefinition && sourceAccepts(source, target) && ruleAccepts(rule, target)
  }
  function diagnostic(id: string, detail: Record<string, unknown>) {
    return update(id, state => state.diagnostics.push(AnalysisFacts.parse(jsonCopy({ at: Date.now(), ...detail })))).catch(report)
  }
  /**
   * Move every sticky activation one clock tick. An activation delivers while it
   * has active ticks left, stands silent through its cooldown, and is dropped once
   * both are spent: a new event is then required to activate the rule again.
   * A tick never refreshes the activation, so repeated hits cannot extend it.
   */
  function advanceStickies(state: StateValue, humanId: string): Set<string> {
    const ticked = new Set<string>()
    state.stickies = state.stickies.filter(sticky => {
      // A main-request clock advances on every request; a human-turn clock waits for new input.
      if (sticky.clock === 'human-turn' && sticky.lastHumanId === humanId) return true
      sticky.lastHumanId = humanId
      if (sticky.remaining > 0) { ticked.add(sticky.activationId); return true }
      sticky.cooldown -= 1
      return sticky.cooldown >= 0
    })
    return ticked
  }
  /** Queue this tick's delivery for each activation that still has active ticks. */
  function pendSticky(state: StateValue, sessionId: string, ticked: Set<string>) {
    for (const sticky of state.stickies) {
      // Only an activation whose clock actually advanced delivers this request.
      if (sticky.remaining <= 0 || !ticked.has(sticky.activationId)) continue
      const source = sources.get(sticky.sourceId)
      const definition = source?.value.rules.find(rule => rule.id === sticky.ruleId)
      const compiled = source?.compiled.find(rule => rule.id === sticky.ruleId)
      // A withdrawn rule or source ends the activation; its text no longer has an owner.
      if (!source || !definition || !compiled) { sticky.remaining = 0; sticky.cooldown = 0; continue }
      // One delivery per lifetime unit: a queued or reserved tick already claims this one.
      const key = JSON.stringify([sticky.sourceId, sticky.ruleId, 'sticky', sticky.activationId, sticky.remaining])
      if (state.candidates.some(item => item.key === key && (item.status === 'pending' || item.status === 'reserved'))) continue
      state.candidates.push({ id: randomUUID(), sessionId, sourceId: sticky.sourceId, sourceToken: source.token,
        sourceSignature: sourceSignature(source.value, definition), ruleId: sticky.ruleId, key,
        revision: source.value.revision, policy: epoch(sessionId, sticky.sourceId, sticky.ruleId),
        text: sticky.text, title: sticky.title, eventId: `sticky:${sticky.activationId}:${sticky.remaining}`,
        rootCallId: `sticky:${sticky.activationId}`, status: 'pending',
        // The activation stores the body its first delivery already rendered, so a
        // later tick reuses that text and must never render the template source again.
        rendered: true,
        evidence: AnalysisFacts.parse(jsonCopy({ sticky: true, activationId: sticky.activationId })),
        sticky: { activationId: sticky.activationId, charged: sticky.charged },
        rule: structuredClone(definition) })
    }
  }
  function invalidate(sourceId: string) {
    // A changed source can change a denial, so tickets from the old policy must not authorize.
    // Retiring them leaves the policy usable: the next round records the new generation.
    tickets.invalidate()
    if (sources.has(sourceId)) for (const state of records.values()) {
      for (const candidate of state.candidates) if (candidate.sourceId === sourceId) recovered.delete(candidate.id)
    }
    for (const run of running.values()) if (run.items.some(item => item.source.sourceId === sourceId)) run.controller.abort(new Error('reminder-source-changed'))
  }
  function pump() {
    if (pumping || closed) return
    pumping = true
    try {
      for (const [id, queue] of queues) {
        if (running.size >= config.maxConcurrent) break
        if (running.has(id) || !queue.length) continue
        const run = queue.shift()
        if (!run) continue
        // Move a served session to the tail so it cannot monopolize the next free slot.
        queues.delete(id); if (queue.length) queues.set(id, queue)
        running.set(id, run)
        run.task = evaluate(run).catch(error => diagnostic(id, { eventId: run.event.callId, status: 'failed', message: errorMessage(error) }))
          .finally(() => { clearTimeout(run.timer); running.delete(id); run.resolve(); pump() })
      }
    } finally { pumping = false }
  }
  async function evaluate(run: Run) {
    const { event, items, controller, deadline } = run
    const blockedGroups = new Set<string>(), winners = new Set<string>(), results: CandidateValue[] = []
    // Only a pre-execution round can still stop its call; correlation uses the registry's execution token.
    const preExecution = event.type === 'tool.before-execute' ? run.preExecution : undefined
    const diagnostics: Record<string, unknown>[] = []
    // Every analyzer reads the same base input; only the matching phase sees their combined facts.
    event.facts = {}
    for (const analyzer of run.analyzers) {
      if (controller.signal.aborted || now() >= deadline) break
      if (analyzers.get(analyzer.ref) !== analyzer) continue
      const child = new AbortController()
      const abort = () => child.abort(controller.signal.reason)
      controller.signal.addEventListener('abort', abort, { once: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      const onDispatch = () => { timer ??= setTimeout(() => child.abort(new Error('reminder-analysis-timeout')), Math.max(0, Math.min(config.ruleTimeoutMs, deadline - now()))) }
      if (!dispatches) onDispatch()
      try {
        const facts = AnalysisFacts.parse(await execute({ analysis: { analyzer, event: { ...event, facts: {} }, maxBytes: config.maxBytes } }, child.signal, { onDispatch, workTimeoutMs: config.ruleTimeoutMs }))
        child.signal.throwIfAborted()
        if (now() >= deadline || analyzers.get(analyzer.ref) !== analyzer) continue
        if (Buffer.byteLength(JSON.stringify({ ...event.facts, [analyzer.ref]: facts })) > config.maxBytes) throw new Error('reminder-facts-budget-exceeded')
        event.facts[analyzer.ref] = facts
        diagnostics.push({ analyzer: analyzer.ref, revision: analyzer.revision, status: 'analyzed', eventId: event.callId })
      } catch (error) {
        diagnostics.push({ analyzer: analyzer.ref, status: child.signal.aborted || /timeout/.test(errorMessage(error)) ? 'timed-out' : 'failed', message: errorMessage(error),
          ...errorDetail(error), eventId: event.callId })
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) }
    }
    for (const item of items) {
      const { source, token, rule, policy } = item
      if (controller.signal.aborted || now() >= deadline) { diagnostics.push({ status: 'round-timeout', eventId: event.callId }); break }
      if (rule.exclusiveGroup && (blockedGroups.has(rule.exclusiveGroup) || winners.has(rule.exclusiveGroup))) continue
      if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy) continue
      const child = new AbortController()
      const abort = () => child.abort(controller.signal.reason)
      controller.signal.addEventListener('abort', abort, { once: true })
      const workTimeoutMs = Math.min(config.ruleTimeoutMs, rule.judge?.timeoutMs ?? config.ruleTimeoutMs)
      let timer: ReturnType<typeof setTimeout> | undefined
      const onDispatch = () => { timer ??= setTimeout(() => child.abort(new Error('reminder-rule-timeout')), Math.max(0, Math.min(workTimeoutMs, deadline - now()))) }
      if (!dispatches) onDispatch()
      try {
        const judge = item.judge
        if (rule.judge && (judge?.revision !== rule.judge.revision || detectors.get(rule.judge.ref) !== judge)) throw new Error('reminder-judge-unavailable')
        const result = MatchResult.parse(await execute({ reminder: { condition: rule.condition, event, maxBytes: config.maxBytes, countLimits: config.countLimits,
          ...(judge && rule.judge ? { judge, params: rule.judge.params ?? null } : {}) } }, child.signal, { onDispatch, workTimeoutMs }))
        if (child.signal.aborted || controller.signal.aborted || now() >= deadline) throw child.signal.reason ?? new Error('reminder-round-timeout')
        if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy) continue
        if (result.ok) {
          const output = rule.on === 'assistant.output' ? event.output : undefined
          if (rule.on === 'assistant.output' && !output) throw new Error('reminder-output-evidence-missing')
          if (rule.exclusiveGroup) winners.add(rule.exclusiveGroup)
          // A denial and an ordinary reminder take this same path: same validation, same delivery,
          // same quota. The denial only records that this call must also be refused.
          const definition = source.rules.find(value => value.id === rule.id)
          if (!definition) throw new Error('reminder-source-rule-missing')
          if (rule.effect.kind === 'deny-tool') {
            run.denial ??= { sourceId: source.sourceId, ruleId: rule.id, reason: rule.effect.reason ?? rule.text }
          }
          results.push({ id: randomUUID(), sessionId: event.sessionId, ...(event.agentPreset === undefined ? {} : { agentPreset: event.agentPreset }), sourceId: source.sourceId, sourceToken: token, ruleId: rule.id,
            key: item.window ? JSON.stringify([source.sourceId, rule.id, 'model', item.window.id]) : keyOf(source.sourceId, rule.id),
            ...(item.window ? { window: item.window } : {}),
            ...(rule.on === 'request.before' ? { request: { type: 'request.before', humanActivity: event.humanActivity } } : {}),
            revision: source.revision, policy, text: rule.text,
            sourceSignature: sourceSignature(source, definition),
            ...(output ? { output: { attemptId: output.attemptId, turn: output.turn,
              step: output.step, index: output.index, type: output.type, offset: output.offset,
              full: output.full } } : {}),
            title: rule.title ?? rule.id, eventId: event.callId, rootCallId: event.rootCallId,
            status: 'pending', evidence: AnalysisFacts.parse(jsonCopy({ ...result, event: frozenFacts(event),
              ...(rule.on === 'request.before' ? { clock: event.clock, humanActivity: event.humanActivity } : {}) })),
            rule: structuredClone(definition) })
        }
        if (result.status === 'unavailable' && rule.exclusiveGroup) blockedGroups.add(rule.exclusiveGroup)
        diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
          status: result.status ?? (result.ok ? 'matched' : 'unmatched'),
          ...(result.status === 'unavailable' ? { evidence: result } : {}) })
      } catch (error) {
        if (rule.exclusiveGroup) blockedGroups.add(rule.exclusiveGroup)
        diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
          status: child.signal.aborted || /timeout/.test(errorMessage(error)) ? 'timed-out' : 'failed', message: errorMessage(error),
          ...errorDetail(error) })
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) }
    }
    // Reaching the end of the loop is the only proof that no denial rule was skipped.
    run.evaluated = !controller.signal.aborted && now() < deadline
    await update(event.sessionId, async state => {
      state.diagnostics.push(...diagnostics.map(detail => AnalysisFacts.parse(jsonCopy(detail))))
      if (controller.signal.aborted || closed) return
      const target = await identity(event.sessionId, event.agentPreset, controller.signal)
      // Recorded after the identity recheck, so a decision revoked during the round never survives it.
      preExecution?.settle(run.denial, run.evaluated === true)
      for (const candidate of results) {
        if (controller.signal.aborted || closed || !current(candidate, target) || !eligible(event.sessionId, candidate.sourceId, candidate.ruleId)
          || epoch(event.sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) continue
        for (const old of state.candidates) if (old.status === 'pending' && !fresh(old)) old.status = 'discarded'
        if (!state.candidates.some(old => old.key === candidate.key && old.status === 'pending' && current(old, target))) state.candidates.push(candidate)
      }
    })
  }
  /** Single admission path for composed events; a pre-execution round also carries its ticket key. */
  function admit(rawEvent: unknown, signal?: AbortSignal, preExecution?: PreExecution): Promise<void> {
    if (closed || signal?.aborted) return Promise.resolve()
    // Reserve capacity before the first persistence await; pending writes are part of the queue.
    if (admissions.size >= config.maxQueued + config.maxConcurrent) return Promise.reject(new Error('reminder-capacity-exceeded'))
    const admittedAt = now(), serialized = JSON.stringify(rawEvent)
    if (Buffer.byteLength(serialized) > config.maxBytes) return Promise.reject(new Error('reminder-input-budget-exceeded'))
    // A rejected submission is reported through the public service, so its reason must survive relay.
    const event = parseOrThrow('提醒事件无效', () => Event.parse(JSON.parse(serialized)))
    // A human turn breaks the reminder chain; a reminder-caused event extends it. Only
    // derived activations are affected by this count (see loopBlocked).
    if (event.origin === 'human') reminderChains.delete(event.sessionId)
    else if (event.origin === 'reminder') reminderChains.set(event.sessionId, (reminderChains.get(event.sessionId) ?? 0) + 1)
    const admission: { sessionId: string; controller: AbortController; task?: Promise<void> } = { sessionId: event.sessionId, controller: new AbortController() }
    admissions.add(admission)
    // Promise invokes its executor synchronously before this resolver is read.
    let resolve!: () => void
    const done = new Promise<void>(finish => { resolve = finish })
    const run: Run = { event, items: [], analyzers: [...analyzers.values()], controller: admission.controller, deadline: admittedAt + config.roundTimeoutMs, resolve, done,
      ...(preExecution === undefined ? {} : { preExecution }) }
    const abort = () => {
      run.controller.abort(signal?.reason ?? new Error('reminder-round-timeout'))
      const queue = queues.get(event.sessionId), index = queue?.indexOf(run) ?? -1
      if (queue && index >= 0) {
        queue.splice(index, 1); if (!queue.length) queues.delete(event.sessionId)
        void diagnostic(event.sessionId, { eventId: event.callId, status: signal?.aborted ? 'cancelled' : 'queue-timeout' }).finally(resolve)
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    run.timer = setTimeout(abort, Math.max(0, run.deadline - now()))
    // Identity lookup occupies admission capacity and uses the same round deadline as matching.
    admission.task = identity(event.sessionId, event.agentPreset, run.controller.signal).then(target => {
      if (closed || run.controller.signal.aborted) return false
      run.items = [...sources.values()].filter(item => sourceAccepts(item, target))
        .flatMap(item => item.compiled.filter(rule => ruleAccepts(rule, target) && requestEligible(rule, event)
          && eligible(event.sessionId, item.value.sourceId, rule.id)
          && !loopBlocked(event, item.value.sourceId, rule.id, rule.effect.kind))
          .map(rule => ({ rule, source: item.value, token: item.token, policy: epoch(event.sessionId, item.value.sourceId, rule.id),
            judge: rule.judge ? detectors.get(rule.judge.ref) : undefined,
            window: rule.effect.deliver.model.once === 'window' || rule.effect.deliver.model.shared?.reset === 'window'
              ? localWindow('timeWindow' in rule.when ? rule.when.timeWindow : undefined, event.clock?.at) : undefined })))
        .sort((a, b) => b.rule.priority - a.rule.priority || a.source.sourceId.localeCompare(b.source.sourceId) || a.rule.id.localeCompare(b.rule.id))
      if (!run.items.length) {
        // No rule in this session's policy applies to this call, so the evaluation is
        // complete: record that answer. The guard reads a ticket for every call, and an
        // unmatched tool is a verdict, not a missing one.
        preExecution?.settle(undefined, true)
        return false
      }
      return update(event.sessionId, state => {
        if (run.controller.signal.aborted || state.seen.includes(event.callId)) return false
        state.seen.push(event.callId); return true
      })
    }).then(admitted => {
      if (!admitted || closed || run.controller.signal.aborted || now() >= run.deadline) return
      const queue = queues.get(event.sessionId) ?? []; queue.push(run); queues.set(event.sessionId, queue); pump()
      return done
    }).catch(async error => {
      if (!run.controller.signal.aborted) throw error
      await diagnostic(event.sessionId, { eventId: event.callId, status: signal?.aborted ? 'cancelled' : 'queue-timeout' })
    }).finally(() => {
      clearTimeout(run.timer); signal?.removeEventListener('abort', abort); admissions.delete(admission)
      // Every preparation ends with a verdict. A round that never ran (capacity, cancellation,
      // queue timeout, duplicate call id) settles as an unfinished evaluation, which denies, so
      // the guard never has to interpret an absence.
      preExecution?.settleUnfinished()
    })
    return admission.task
  }
  function catalogFor(acceptSource: (item: RegisteredSource) => boolean, acceptRule: (rule: RuleValue) => boolean) {    return [...sources.values()].filter(acceptSource).map(item => item.value)
      .map(source => ({ sourceId: source.sourceId, plugin: source.plugin, registration: 'reminderRules', executor: 'context-care',
        ...(source.sessionId ? { sessionId: source.sessionId } : {}), ...(source.scope ? { scope: source.scope } : {}), readOnly: true,
        rules: source.rules.filter(acceptRule).map(rule => ({ id: rule.id, title: rule.title ?? rule.id, description: rule.text,
          definition: rule, actions: [{ id: 'model', title: '模型提醒', defaultEnabled: true }] })) }))
  }
  const registeredRules = () => [...sources.values()].reduce((count, item) => count + item.compiled.length, 0)
  const capacitySnapshot = () => structuredClone({ ...settings, registeredRules: registeredRules(), rejections: [...rejectedSources.values()] })
  return {
    capacitySnapshot,
    /** Evaluate natural conversation at the same boundary that collects tool reminders. */
    async prepareRequest({ sessionId, agentPreset, events, visible = [], accepted = [], signal }: RequestInput) {
      if (![...sources.values()].some(source => source.compiled.some(rule => rule.on === 'request.before'))) return
      const at = wallNow(), callId = `request:${randomUUID()}`
      await this.submit({ type: 'request.before', sessionId, ...(agentPreset === undefined ? {} : { agentPreset }), callId, rootCallId: callId,
        clock: { at, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        humanActivity: humanActivity(events), context: requestContext([...visible, ...accepted], config) }, signal)
    },
    /** Persist suppression through the active calendar window; omitted identity selects all window rules. */
    async snooze({ sessionId, agentPreset, sourceId, ruleId }: RecipientIdentity & { sourceId?: string; ruleId?: string }) {
      if (closed) throw new Error('reminder-runtime-closed')
      if ((sourceId === undefined) !== (ruleId === undefined)) throw new Error('sourceId and ruleId must be supplied together')
      const target = await identity(sessionId, agentPreset)
      const selected = [...sources.values()].filter(source => sourceAccepts(source, target)
        && (sourceId === undefined || source.value.sourceId === sourceId))
        .flatMap(source => source.compiled.filter(rule => rule.effect.kind === 'remind'
          && rule.effect.deliver.model.once === 'window'
          && ruleAccepts(rule, target)
          && (ruleId === undefined || rule.id === ruleId)).map(rule => ({ sourceId: source.value.sourceId, rule })))
      return update(sessionId, state => {
        const suppressed: { sourceId: string; ruleId: string; until: number }[] = []
        for (const item of selected) {
          const window = localWindow('timeWindow' in item.rule.when ? item.rule.when.timeWindow : undefined, wallNow())
          if (!window) continue
          const key = JSON.stringify([item.sourceId, item.rule.id, 'model', window.id])
          state.windows = state.windows.filter(claim => claim.key !== key)
          state.windows.push({ key, until: window.end })
          suppressed.push({ sourceId: item.sourceId, ruleId: item.rule.id, until: window.end })
        }
        return suppressed
      })
    },
    setCapacity(input: unknown) {
      const change = CapacitySettings.parse(input)
      const task = capacityWrite.catch(() => {}).then(async () => {
        if (closed) throw new CapacityError(503, '提醒服务已关闭')
        if (change.revision !== settings.revision) throw new CapacityError(409, '提醒容量已被其他窗口修改，请刷新后重试')
        const next = { revision: settings.revision + 1, maxRules: change.maxRules }
        // Only durable acknowledgement publishes a new setting; a failed write is retryable.
        await saveCapacity(next)
        settings = next
        return capacitySnapshot()
      })
      capacityWrite = task
      return task
    },
    validateRule(input: unknown) { return structuredClone(compileRule(input, config.countLimits, declaredEvents())) },
    registerSource(input: unknown, { acceptSession = () => true }: { acceptSession?: (sessionId: string) => boolean } = {}) {
      if (closed) throw new Error('reminder-runtime-closed')
      // Registration is a public entry point; a rejected declaration must carry its reason.
      const value = parseOrThrow('提醒来源无效', () => Source.parse(input))
      if (sources.has(value.sourceId)) throw new Error('reminder-source-already-registered')
      const owner = {}
      const replace = (input: unknown) => {
        if (closed || (sources.has(value.sourceId) && sources.get(value.sourceId)?.owner !== owner)) throw new Error('reminder-source-disposed')
        const next = parseOrThrow('提醒来源无效', () => Source.parse(input))
        if (next.sourceId !== value.sourceId || next.plugin !== value.plugin || next.sessionId !== value.sessionId) throw new Error('reminder-source-identity-changed')
        const previousCount = registeredRules()
        const totalRules = previousCount - (sources.get(next.sourceId)?.compiled.length ?? 0) + next.rules.length
        // Lowering a limit preserves registered rules. Only growth is refused until capacity is available.
        if (settings.maxRules && totalRules > settings.maxRules && totalRules > previousCount) {
          const message = `提醒规则总数 ${totalRules} 超过上限 ${settings.maxRules}（来源 ${next.sourceId}：${next.rules.length} 条）`
          rejectedSources.set(next.sourceId, { sourceId: next.sourceId, sourceRules: next.rules.length, totalRules, limit: settings.maxRules, message })
          throw Object.assign(new Error(message), { code: 'reminder-capacity-exceeded' })
        }
        if (new Set(next.rules.map(rule => rule.id)).size !== next.rules.length) throw new Error('reminder-duplicate-rule')
        // A body that cannot render is rejected here, before any rule can match.
        for (const rule of next.rules) validateText(rule.text)
        const compiled = next.rules.map(rule => compileRule(rule, config.countLimits, declaredEvents()))
        if (!updateClaims && compiled.some(rule => rule.effect.kind === 'remind' && rule.effect.deliver.model.shared)) throw new Error('reminder-shared-storage-unavailable')
        invalidate(value.sourceId)
        rejectedSources.delete(next.sourceId)
        sources.set(value.sourceId, { owner, acceptSession, token: randomUUID(), value: next, compiled })
      }
      replace(value)
      let disposed = false
      return { replace: (next: unknown) => { if (disposed) throw new Error('reminder-source-disposed'); replace(next) },
        async dispose() { if (disposed) return; disposed = true; invalidate(value.sourceId); sources.delete(value.sourceId)
          await Promise.allSettled([...running.values()].filter(run => run.items.some(item => item.source.sourceId === value.sourceId)).map(run => run.task)) } }
    },
    registerDetector(input: unknown) {
      const value = Detector.parse(input)
      if (closed || detectors.has(value.ref)) throw new Error('reminder-detector-unavailable')
      detectors.set(value.ref, value)
      return async () => { if (detectors.get(value.ref) !== value) return; detectors.delete(value.ref)
        const affected = [...running.values()].filter(run => run.items.some(item => item.rule.judge?.ref === value.ref))
        for (const run of affected) run.controller.abort(new Error('reminder-detector-disposed'))
        await Promise.allSettled(affected.map(run => run.task)) }
    },
    registerAnalyzer(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('reminder-analyzer-requires-object')
      const value = Detector.parse({ exportName: 'analyze', ...input })
      if (closed || analyzers.has(value.ref) || ['__proto__', 'constructor', 'prototype'].includes(value.ref)) throw new Error('reminder-analyzer-unavailable')
      analyzers.set(value.ref, value)
      return async () => {
        if (analyzers.get(value.ref) !== value) return
        analyzers.delete(value.ref)
        const affected = [...running.values()].filter(run => run.analyzers.includes(value))
        for (const run of affected) run.controller.abort(new Error('reminder-analyzer-disposed'))
        await Promise.allSettled(affected.map(run => run.task))
      }
    },
    /** Resolve current recipient facts before presenting the applicable rules. */
    async catalog(sessionId: string, agentPreset?: string) {
      const target = await identity(sessionId, agentPreset)
      return catalogFor(item => sourceAccepts(item, target), rule => ruleAccepts(rule, target))
    },
    /** Synchronous action definitions for policy lookup; delivery and UI use catalog/recipient checks. */
    controlCatalog(sessionId: string) {
      return catalogFor(item => item.value.sessionId === undefined || item.value.sessionId === sessionId, () => true)
    },
    submit(rawEvent: unknown, signal?: AbortSignal) { return admit(rawEvent, signal) },
    /** Evaluate denial policy before a tool body runs; the guard later reads this ticket. */
    async prepareToolExecution({ key, sessionId, agentPreset, name, arguments: args, callId, rootCallId, signal }: ToolPreparation) {
      if (closed) return
      const pre = openPreExecution(key, tickets)
      const applying = [...sources.values()].some(item => item.compiled.some(rule => rule.on === 'tool.before-execute'))
      // With no pre-execution rule anywhere nothing can deny this call, so the verdict is already
      // complete. The guard reads one ticket per call: an empty policy is a verdict, not an absence.
      if (!applying) { pre.settle(undefined, true); return }
      await admit(Event.parse(jsonCopy({ type: 'tool.before-execute', sessionId, ...(agentPreset === undefined ? {} : { agentPreset }),
        callId, rootCallId, name, arguments: args, clock: { at: wallNow() }, facts: {} })), signal, pre).catch(report)
    },
    /**
     * Declare the custom events a rule may select by name. The owner keeps the returned
     * disposer inside a Cordis effect, so unloading that plugin withdraws its names:
     * nothing can publish them afterwards, and `handlesSessionEvent` reports them as
     * unreachable even though already-compiled rules still mention them.
     */
    registerCustomEvents(descriptors: { name: string; shape?: EventFieldShape }[]) {
      if (closed) throw new Error('reminder-runtime-closed')
      const added: string[] = []
      for (const descriptor of descriptors) {
        const name = descriptor.name
        if (typeof name !== 'string' || !name.trim()) throw new Error('自定义事件名不能为空')
        if (BUILT_IN_EVENT_NAMES.has(name)) throw new Error(`自定义事件不能占用内置事件名 ${name}`)
        const shape = descriptor.shape ?? 'any'
        const existing = customEvents.get(name)
        // Re-declaring the same name with the same shape is what a plugin reload looks
        // like; a different shape would leave already-compiled selectors unverified.
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(shape)) {
          throw new Error(`自定义事件 ${name} 已被声明为另一种载荷结构`)
        }
        if (existing === undefined) { customEvents.set(name, shape); added.push(name) }
      }
      return () => { for (const name of added) customEvents.delete(name) }
    },
    /**
     * Publish one custom event. `eventId` is the idempotency key: care records it in the
     * session's durable state, so re-publishing is ignored instead of delivered twice.
     * The payload rides `arguments` and is frozen into the delivery evidence as received.
     */
    async publishCustomEvent({ sessionId, name, eventId, at, facts }: {
      sessionId: string; name: string; eventId: string; at?: number; facts?: unknown
    }, signal?: AbortSignal) {
      if (closed) throw new Error('reminder-runtime-closed')
      if (!customEvents.has(name)) throw new Error(`自定义事件 ${name} 未被声明`)
      if (!eventId.trim()) throw new Error('自定义事件缺少幂等键 eventId')
      await admit(Event.parse(jsonCopy({ type: 'session.event', sessionId, name, arguments: facts,
        callId: eventId, rootCallId: eventId, clock: { at: at ?? wallNow() }, facts: {} })), signal).catch(report)
    },
    /**
     * Whether any registered rule selects this committed DSH event type. A session
     * event can only match a rule whose `eventType` equals it, so this pre-filter is
     * exact and keeps unrelated log traffic off the admission path.
     */
    handlesSessionEvent(eventType: string) {
      // A withdrawn custom name has no producer left, so nothing can reach the rules that
      // still reference it; a built-in name always can.
      if (!BUILT_IN_EVENT_NAMES.has(eventType) && !customEvents.has(eventType)) return false
      for (const source of sources.values()) {
        for (const rule of source.compiled) {
          if (rule.on === 'session.event' && rule.when.eventType === eventType) return true
        }
      }
      return false
    },
    /** Synchronous guard decision; never awaits, so another listener cannot re-allow a denial. */
    decideToolExecution(key: object) { return tickets.decide(key, now()) },
    /** Release a settled execution's ticket. */
    settleToolExecution(key: object) { tickets.settle(key) },
    async settle(sessionId: string) {
      // Previous callers have already received write failures. A new collection may retry the durable writer.
      await Promise.allSettled([...admissions].filter(item => item.sessionId === sessionId).map(item => item.task))
      await chains.get(sessionId)?.catch(() => {})
      await Promise.all([running.get(sessionId)?.done, ...(queues.get(sessionId) ?? []).map(run => run.done)])
      await chains.get(sessionId)?.catch(() => {})
    },
    snapshot(sessionId: string) { return structuredClone({ ...(records.get(sessionId) ?? empty()), sources: [...sources.values()].map(item => item.value), storageError: failures.has(sessionId) }) },
    async collect({ sessionId, agentPreset, visible, accepted = [], committedIds = [], signal, candidateIds }: CollectInput) {
      await this.settle(sessionId); signal?.throwIfAborted()
      const reserved: string[] = []
      return update(sessionId, async state => {
        const messages: ReturnType<typeof reminderMessage>[] = [], present = [...visible, ...accepted]
        const keys = new Set(present.flatMap(reminderKeys))
        // Accepted inbox entries are not committed yet; pre-step filtering still owns their handoff.
        const committed = new Set([...committedIds, ...visible.map(message => message.id)])
        // The human-turn clock advances only on a new human message, not on every request.
        let lastHumanId = ''
        for (const message of present) if (message.source?.kind === 'user' && message.id !== undefined) lastHumanId = message.id
        const humanId = lastHumanId
        const consume: string[] = []
        for (const candidate of state.candidates) {
          if (candidate.status !== 'reserved') continue
          if (!candidate.messageId) throw new Error('reminder-reservation-identity-missing')
          if (committed.has(candidate.messageId)) {
            candidate.status = 'delivered'
            if (quotaFor(candidate)) consume.push(candidate.messageId)
            // Only a confirmed delivery spends a lifetime unit, so a dropped tick is retried.
            const activation = candidate.sticky
              ? state.stickies.find(item => item.activationId === candidate.sticky?.activationId) : undefined
            if (activation) activation.remaining = Math.max(0, activation.remaining - 1)
            // The first confirmed delivery opens one activation; later ticks reuse its text.
            const sticky = candidate.rule.effect.deliver.model.sticky
            if (sticky && !candidate.sticky && !state.stickies.some(item => item.activationId === candidate.id)) {
              state.stickies.push({ key: JSON.stringify([candidate.sourceId, candidate.ruleId, candidate.id]),
                activationId: candidate.id, sourceId: candidate.sourceId, ruleId: candidate.ruleId, sessionId,
                text: candidate.text, title: candidate.title, clock: sticky.clock,
                remaining: sticky.lifetime - 1, cooldown: sticky.cooldown,
                charged: quotaFor(candidate) !== undefined, lastHumanId: humanId })
            }
          } else keys.add(candidate.key) // Unknown handoff cannot be retried merely because the process restarted.
        }
        if (consume.length) await claims({ consume })
        const ticked = advanceStickies(state, humanId)
        pendSticky(state, sessionId, ticked)
        for (const candidate of state.candidates) {
          if (candidate.status !== 'pending' || (candidateIds && !candidateIds.includes(candidate.id))) continue
          // A persisted rollback keeps its old message id until shared release is acknowledged.
          // A later sticky tick never reserved a quota, so it has nothing to release.
          if (candidate.messageId && !candidate.sticky?.charged && quotaFor(candidate)) {
            await claims({ release: [candidate.messageId] })
            delete candidate.messageId
          }
          const target = await identity(sessionId, agentPreset, signal)
          if (closed || !fresh(candidate) || !current(candidate, target) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
            || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) { candidate.status = 'discarded'; continue }
          if (keys.has(candidate.key) || state.windows.some(item => item.key === candidate.key)) { candidate.status = 'discarded'; continue }
          // The reminder is already present during an activation, so a repeated hit is
          // absorbed: it must neither deliver again nor extend the activation.
          if (!candidate.sticky && state.stickies.some(item => item.sourceId === candidate.sourceId && item.ruleId === candidate.ruleId)) {
            candidate.status = 'discarded'; continue
          }
          // The template renders once, against the facts frozen when the rule matched.
          // A sticky activation later reuses this same text instead of rendering again.
          if (!candidate.rendered) {
            try {
              candidate.text = renderText(candidate.rule.text, candidate.evidence)
              candidate.rendered = true
            } catch (error) {
              candidate.status = 'discarded'
              state.diagnostics.push(AnalysisFacts.parse(jsonCopy({ at: wallNow(), ruleId: candidate.ruleId,
                sourceId: candidate.sourceId, eventId: candidate.eventId, status: 'render-failed',
                message: errorMessage(error) })))
              continue
            }
          }
          // An activation charges its shared quota once, when it opens.
          const messageId = randomUUID(), quota = candidate.sticky?.charged ? undefined : quotaFor(candidate)
          if (quota) {
            const book = await claims({ reserve: [{ ...quota, candidateId: candidate.id, sessionId, messageId }] })
            // Losing sessions retain a pending hit: a known rollback may make room on their next request.
            if (!hasClaim(book, quota.key, messageId)) continue
            reserved.push(messageId)
            // A model/preset/source switch while the shared slot is being saved must release the slot.
            const latest = await identity(sessionId, agentPreset, signal)
            if (closed || !fresh(candidate) || !current(candidate, latest) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
              || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) {
              await claims({ release: [messageId] })
              candidate.status = 'discarded'
              continue
            }
          }
          signal?.throwIfAborted()
          keys.add(candidate.key)
          candidate.messageId = messageId; candidate.status = 'reserved'
          if (candidate.window && candidate.rule.effect.kind === 'remind' && candidate.rule.effect.deliver.model.once === 'window') state.windows.push({ key: candidate.key, until: candidate.window.end, messageId })
          messages.push(reminderMessage(candidate, messageId))
        }
        return messages
      }, async () => { if (reserved.length) await claims({ release: reserved }) })
    },
    async rollback(sessionId: string, messages: MessageView[]) {
      const ids = new Set(messages.filter(message => message.source?.kind === REMINDER_MESSAGE_KIND).map(message => message.id))
      if (!ids.size) return
      const release = await update(sessionId, state => {
        const release: string[] = []
        for (const candidate of state.candidates) {
          if (!candidate.messageId || !['reserved', 'pending'].includes(candidate.status) || !ids.has(candidate.messageId)) continue
          // An explicit snooze has no messageId and survives cancellation of this handoff.
          state.windows = state.windows.filter(item => item.messageId !== candidate.messageId)
          candidate.status = 'pending'
          if (quotaFor(candidate)) release.push(candidate.messageId)
          else delete candidate.messageId
        }
        return release
      })
      if (release.length) await claims({ release })
    },
    async filterMessages<Message extends MessageView>(sessionId: string, visible: MessageView[], messages: Message[], agentPreset?: string) {
      if (!messages.some(message => message.source?.kind === REMINDER_MESSAGE_KIND)) return messages
      const target = await identity(sessionId, agentPreset)
      const keys = new Set(visible.flatMap(reminderKeys))
      const state = records.get(sessionId)
      return messages.filter(message => {
        if (message.source?.kind !== REMINDER_MESSAGE_KIND) return true
        const candidate = state?.candidates.find(item => item.messageId === message.id)
        if (closed || !state || !candidate || candidate.status !== 'reserved' || !fresh(candidate) || !current(candidate, target) || keys.has(candidate.key)
          || state.windows?.some(item => item.key === candidate.key && item.messageId !== message.id) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
          || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) return false
        keys.add(candidate.key); return true
      })
    },
    async close() {
      closed = true
      for (const admission of admissions) admission.controller.abort(new Error('reminder-runtime-closed'))
      for (const queue of queues.values()) for (const run of queue) { clearTimeout(run.timer); run.resolve() }
      queues.clear()
      for (const run of running.values()) run.controller.abort(new Error('reminder-runtime-closed'))
      await Promise.allSettled([...running.values()].map(run => run.done))
      await Promise.allSettled([...admissions].map(item => item.task))
      await Promise.allSettled([...chains.values(), capacityWrite]); sources.clear(); detectors.clear(); analyzers.clear(); rejectedSources.clear()
      tickets.dispose()
    },
  }
}
