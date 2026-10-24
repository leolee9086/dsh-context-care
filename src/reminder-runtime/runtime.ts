import { randomUUID, createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { Source, ReminderConfig, compileRule } from './schema.js'
import { createCustomEvents } from './custom-events.js'
import type { CustomEventDescriptor } from './custom-events.js'
import { CapacitySettings, CapacityError } from './capacity.js'
import { localWindow, humanActivity, requestContext, requestEligible } from './request-context.js'
import type { MessageView } from './request-context.js'
import { matchesScope } from './scope.js'
import type { RecipientIdentity } from './scope.js'
import { changeClaims, quotaFor, hasClaim } from './claims.js'
import { createDenialTickets, openPreExecution, codeForReason, codeForFailure } from './denial.js'
import { SESSION_EVENT_TYPES } from './generated/session-events.js'
import { evaluateRules } from './evaluation.js'
import { reminderHandoff, candidateFromMessage } from './handoff.js'
import { createPersistenceOwner, isDefiniteStorageFailure } from './persistence.js'
import type { PersistenceTransaction } from './persistence.js'

/** Built-in names, which a custom event may not shadow. */
const BUILT_IN_EVENT_NAMES = new Set<string>(SESSION_EVENT_TYPES)
import { parseOrThrow } from './schema-error.js'
import type { DenialVerdict, PreExecution, UnfinishedCode } from './denial.js'
import type { ClaimOperation } from './claims.js'
import { Detector, SessionState, Event, MatchResult, BatchResult, BatchAnswer, AnalysisFacts, jsonCopy, errorMessage, errorDetail, triggerKey } from './state.js'
import type { CandidateValue, StateValue, SourceValue, RuleValue, DetectorValue, Rejection, RegisteredSource, Run, RuntimeOptions, RequestInput, CollectInput, ToolPreparation, EventValue, WorkItem, HandoffLookup } from './state.js'
export { ReminderConfig } from './schema.js'
export { REMINDER_DOMAIN } from './state.js'
export type { RuntimeOptions } from './state.js'
/** The selector shape a custom event descriptor declares, reused from the generated catalog. */
export type { EventFieldShape } from './generated/session-events.js'
export type { CustomEventDescriptor } from './custom-events.js'

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
/**
 * The frozen event facts a reminder template may read. Captures, counts and the
 * decision itself live beside these in the same evidence record, so one snapshot
 * answers every question the template can ask.
 */
function frozenFacts(event: EventValue) {
  return AnalysisFacts.parse(jsonCopy({ type: event.type, name: event.name, arguments: event.arguments,
    error: event.error, output: event.output, clock: event.clock, humanActivity: event.humanActivity }))
}
/** These candidates can be reconstructed from committed inputs and native handoffs.
 * A tool-call anchor alone does not yet prove that a before-execution hook ran. */
function isNativeCandidate(candidate: CandidateValue): boolean {
  // A sticky tick's activation and frozen body already belong to a real message.
  if (candidate.sticky || candidate.rule.on === 'assistant.output') return true
  return (candidate.native?.type === 'tool-result' && (candidate.rule.on === 'tool.succeeded' || candidate.rule.on === 'tool.failed'))
    || (candidate.native?.type === 'session-event' && candidate.rule.on === 'session.event')
}
function reminderKeys(message: MessageView) {
  if (message.source?.kind !== REMINDER_MESSAGE_KIND) return []
  if (!message.source.reminder) throw new Error('reminder-message-key-missing')
  return [message.source.reminder.key]
}
function reminderSource(candidate: CandidateValue, humanId: string) {
  // These identify this handoff's context, not a serialized runtime-state snapshot.
  // A shared slot becomes consumed only when this message enters the Session log.
  // Later sticky ticks keep their activation's charge instead of spending it again.
  const shared = candidate.queued || candidate.sticky?.charged ? undefined : quotaFor(candidate)
  const handoff = reminderHandoff(candidate)
  return { kind: REMINDER_MESSAGE_KIND, form: 'notice', summary: candidate.title,
    reminder: { key: candidate.key, candidateId: candidate.id, sessionId: candidate.sessionId, humanId,
      ...(handoff ? { handoff } : {}),
      ...(candidate.window ? { window: candidate.window } : {}),
      shared: shared ? { key: shared.key, ...(shared.until === undefined ? {} : { until: shared.until }) } : null },
    contextCareTrace: { trigger: 'reminder-rule', evaluationId: candidate.id, ruleId: candidate.ruleId,
      sourceId: candidate.sourceId, callId: candidate.eventId, rootCallId: candidate.rootCallId, rule: candidate.rule, evidence: candidate.evidence,
      ...(candidate.native ? { native: candidate.native } : {}),
      ...(candidate.output ? { output: candidate.output } : {}) } } as const
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-context-care:reminder': ReturnType<typeof reminderSource>
  }
}

function reminderMessage(candidate: CandidateValue, messageId: string, humanId: string) {
  // IDs are allocated by this runtime and retained through reservation/recovery.
  return { id: messageId as MessageId, role: 'user', content: [{ type: 'text', text: candidate.text }],
    source: reminderSource(candidate, humanId) } satisfies UserMessage
}

/** One runtime owns source snapshots, evaluation lifetimes and disposable candidates.
 * Standalone callers may supply a legacy writer; production recovery belongs to Session.
 * No Cordis or live session objects enter the scheduler. */
export function createReminderRuntime({ config: input, entries = [], sessionAuthoritative = false, templates, save = async () => {}, execute = async () => { throw new Error('reminder-executor-unavailable') },
  capacity, saveCapacity = async () => {}, changed = () => {}, dispatches = false, resolvePreset, resolveIdentity, resolveEvent, recoverEvents, sinceSeq = () => -1,
  updateClaims, readDeliveries, wasHanded, readHandoffs, readQueued, handoffPending,
  wallNow = () => Date.now(), now = () => performance.now(), eligible = () => true, epoch = () => 0, report = () => {} }: RuntimeOptions = {}) {
  const config = ReminderConfig.parse(input)
  let settings = CapacitySettings.parse(capacity ?? { revision: 0, maxRules: config.maxRules })
  let capacityWrite: Promise<unknown> = Promise.resolve()
  const rejectedSources = new Map<string, Rejection>()
  const records = new Map([...entries].map(([id, value]) => {
    const state = SessionState.parse(jsonCopy(value))
    if (readDeliveries) {
      // Native handoffs decide whether a recovered trigger was already consumed.
      // A previous process's seen cache can contain unfinished or unmatched work;
      // it cannot suppress a new reconstruction of the committed native facts.
      state.seen = []
      state.windows = []
      state.stickies = []
      // Committed trigger inputs and accepted handoffs both live in Session. A
      // candidate copy cannot override reconstruction from those native facts.
      if (sessionAuthoritative) state.candidates = []
      else if (recoverEvents) state.candidates = state.candidates.filter(candidate => !isNativeCandidate(candidate)
        && candidate.status !== 'delivered' && candidate.status !== 'discarded')
    }
    return [id, state] as const
  }))
  // Cold cache entries and native inbox handoffs may rebind to identical definitions.
  const recovered = new Set([...records.values()].flatMap(state => state.candidates.map(candidate => candidate.id)))
  // Native inbox messages already own their frozen candidate, including legacy
  // triggers without an input anchor. This set only avoids copying those messages
  // back into the obsolete candidate file; it never grants delivery authority.
  const nativeHandoffs = new Set<string>()
  const sources = new Map<string, RegisteredSource>(), detectors = new Map<string, DetectorValue>(), analyzers = new Map<string, DetectorValue>()
  const chains = new Map<string, Promise<unknown>>(), queues = new Map<string, Run[]>(), running = new Map<string, Run>()
  const failures = new Map<string, unknown>(), admissions = new Set<{ sessionId: string; controller: AbortController; task?: Promise<void> }>()
  const recoveries = new Map<string, { controller: AbortController; task: Promise<void>; selection: string }>()
  let closed = false, pumping = false
  // Registry-owned execution tokens define ticket lifetime. Rule execution budgets
  // must not expire a completed verdict while another hook or approval is pending.
  const tickets = createDenialTickets()
  // Reminder-caused activations per session. A human turn breaks the chain; the
  // budget is what stops two rules from ping-ponging without a shared causal store.
  const reminderChains = new Map<string, number>()
  // Pre-execution policy must not wait for disk, but a repeated live call must not
  // invoke its judge again while its durable seen record is still being saved.
  const recentExecutions = new Map<string, string[]>()
  // Declared custom events: a rule may select one by name once its owner declares it.
  const customEvents = createCustomEvents(recoverEvents !== undefined)
  const declaredEvents = () => customEvents.declared()
  const sourceSignature = (source: SourceValue, rule: RuleValue) => {
    const nativeEvent = rule.on === 'session.event' ? customEvents.nativeName(rule.when.eventType) : undefined
    return createHash('sha256').update(JSON.stringify({ plugin: source.plugin, sessionId: source.sessionId, scope: source.scope, rule,
      ...(nativeEvent === undefined ? {} : { nativeEvent }) })).digest('hex')
  }
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
  // Caller deadlines never acknowledge writes or release their real session lane.
  const persistence = sessionAuthoritative ? undefined : createPersistenceOwner<StateValue>({
    save: async (id, next) => {
      if (!readDeliveries) { await save(id, next); return }
      const candidates = recoverEvents ? next.candidates.filter(candidate => !isNativeCandidate(candidate)
        && !nativeHandoffs.has(candidate.id) && candidate.status !== 'delivered' && candidate.status !== 'discarded') : next.candidates
      if (recoverEvents && candidates.length === 0) return
      // Other trigger kinds retain their writer until their native recovery is
      // complete. An obsolete native cache does not need a clearing write: the
      // owning log, not the contents left in that file, controls reconstruction.
      await save(id, { ...next, seen: [], stickies: [], windows: [], candidates })
    },
    publish: (id, next) => { records.set(id, next); failures.delete(id) },
    timeoutMs: () => config.storageTimeoutMs,
    onError: (id, error) => { failures.set(id, error); report(error) },
  })
  function update<T>(id: string, change: (state: StateValue) => T | Promise<T>,
    hooks: Pick<PersistenceTransaction<StateValue, T>, 'onFailure' | 'onAbandoned'> = {}): Promise<T> {
    const prepare = async () => {
      // Candidate state is disposable; clone only within the owning in-memory lane.
      const next = structuredClone(records.get(id) ?? empty())
      next.windows = next.windows.filter(item => item.until > wallNow())
      for (const candidate of next.candidates) {
        if (candidate.window && wallNow() >= candidate.window.end) candidate.status = 'discarded'
      }
      const value = await change(next)
      next.diagnostics = next.diagnostics.slice(-config.maxCandidates)
      next.seen = next.seen.slice(-config.maxQueued * 4)
      while (next.candidates.length > config.maxCandidates) {
        const index = next.candidates.findIndex(item => item.status === 'delivered' || item.status === 'discarded')
        if (index < 0) throw new Error('reminder-candidate-capacity-exceeded')
        const [retired] = next.candidates.splice(index, 1)
        nativeHandoffs.delete(retired.id)
      }
      if (Buffer.byteLength(JSON.stringify(next)) > config.maxBytes) throw new Error('reminder-retained-budget-exceeded')
      return { next, value }
    }
    if (sessionAuthoritative) {
      const previous = chains.get(id) ?? Promise.resolve()
      const task = previous.catch((_error: unknown) => { /* Its owner already reports the failed operation; the next cache update may retry. */ }).then(async () => {
        const { next, value } = await prepare()
        records.set(id, next); failures.delete(id)
        return value
      }).catch(async (error: unknown) => {
        await hooks.onFailure?.(error)
        throw error
      })
      chains.set(id, task)
      void task.catch((error: unknown) => { failures.set(id, error); report(error) })
      return task
    }
    if (!persistence) throw new Error('reminder-persistence-unavailable')
    const task = persistence.transact(id, { prepare, isDefiniteFailure: isDefiniteStorageFailure, ...hooks })
    // The standalone writer retains its real I/O owner after a caller timeout.
    chains.set(id, task)
    void task.catch((error: unknown) => { failures.set(id, error) })
    return task
  }
  /** Keep IDs until release ACK, so later collection can finish a failed release. */
  function rollbackCandidates(state: StateValue, ids: ReadonlySet<string>): string[] {
    const release: string[] = []
    for (const candidate of state.candidates) {
      if (!candidate.messageId || !['reserved', 'pending'].includes(candidate.status) || !ids.has(candidate.messageId)) continue
      state.windows = state.windows.filter(item => item.messageId !== candidate.messageId)
      candidate.status = 'pending'
      if (readQueued) {
        if (readQueued(candidate.sessionId).some(message => message.id === candidate.messageId)) candidate.queued = true
        else delete candidate.queued
      }
      if (quotaFor(candidate)) release.push(candidate.messageId)
      else if (!candidate.queued) delete candidate.messageId
    }
    return release
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
  /** Retire startup copies once the owning native trigger has been reconstructed.
   * Older candidates omitted their anchor; matching the actual phase and call id
   * prevents their frozen body or reservation from overriding the native replay. */
  async function retireNativeCopies(event: EventValue) {
    if (!readDeliveries || !recoverEvents || !event.native) return
    const copied = (candidate: CandidateValue) => recovered.has(candidate.id)
      && candidate.eventId === event.callId && candidate.rule.on === event.type
      && isNativeCandidate({ ...candidate, native: event.native })
    if (!records.get(event.sessionId)?.candidates.some(copied)) return
    const retired = await update(event.sessionId, state => {
      const ids = state.candidates.filter(copied).map(candidate => candidate.id)
      state.candidates = state.candidates.filter(candidate => !copied(candidate))
      return ids
    })
    for (const id of retired) recovered.delete(id)
  }
  /** Cold discovery is shared; abandoning one request does not erase a committed native trigger. */
  async function recoverNative(sessionId: string, agentPreset?: string, signal?: AbortSignal): Promise<void> {
    if (!recoverEvents) return
    const recoverable = (rule: RuleValue) => rule.on === 'tool.succeeded' || rule.on === 'tool.failed'
      || rule.on === 'tool.before-execute' || rule.on === 'assistant.output'
      || (rule.on === 'session.event' && (BUILT_IN_EVENT_NAMES.has(rule.when.eventType) || customEvents.nativeName(rule.when.eventType) !== undefined))
    const interested = [...sources.values()].filter(source => source.acceptSession(sessionId)
      && (source.value.sessionId === undefined || source.value.sessionId === sessionId)
      && (!source.value.scope?.sessionIds || source.value.scope.sessionIds.includes(sessionId))
      && source.compiled.some(rule => recoverable(rule)
        && (!rule.scope?.sessionIds || rule.scope.sessionIds.includes(sessionId))
        && eligible(sessionId, source.value.sourceId, rule.id)))
    if (!interested.length) return
    // Unscoped rules need no identity lookup just to discover an empty history.
    // Admission still resolves current facts separately before evaluating each trigger.
    const needsIdentity = interested.some(source => source.value.scope?.agentPresets || source.value.scope?.condition
      || source.compiled.some(rule => rule.scope?.agentPresets || rule.scope?.condition))
    const target: RecipientIdentity = needsIdentity ? await identity(sessionId, agentPreset, signal) : { sessionId }
    const applicable = interested.filter(source => sourceAccepts(source, target)).flatMap(source =>
      source.compiled.filter(rule => recoverable(rule) && ruleAccepts(rule, target)
        && eligible(sessionId, source.value.sourceId, rule.id)))
    if (!applicable.length) return
    const selection = { tools: applicable.some(rule => rule.on === 'tool.succeeded' || rule.on === 'tool.failed'),
      beforeTools: applicable.some(rule => rule.on === 'tool.before-execute'),
      outputs: applicable.some(rule => rule.on === 'assistant.output'),
      sessionEvents: [...new Set(applicable.flatMap(rule => rule.on === 'session.event'
        ? [customEvents.nativeName(rule.when.eventType) ?? rule.when.eventType] : []))].sort(),
      sessionAliases: customEvents.selections(applicable.flatMap(rule => rule.on === 'session.event' ? [rule.when.eventType] : [])) }
    signal?.throwIfAborted()
    if (closed) throw new Error('reminder-runtime-closed')
    const signature = JSON.stringify(selection)
    let recovery = recoveries.get(sessionId)
    if (recovery && recovery.selection !== signature) {
      // Finish the scan that already owns this session, then recompute interest.
      // A source added while it ran must not inherit a different scan's result.
      await recovery.task
      signal?.throwIfAborted()
      return recoverNative(sessionId, agentPreset, signal)
    }
    if (!recovery) {
      const controller = new AbortController()
      let handoffs: HandoffLookup | undefined, recipient = needsIdentity ? target : undefined
      const task = Promise.resolve().then(() => recoverEvents(sessionId, async event => {
        // No discovered event means no extra delivery read. Once needed, the
        // same native projection serves every sample and every rule in this scan.
        if (readHandoffs && !handoffs) handoffs = await readHandoffs(sessionId)
        recipient ??= await identity(sessionId, agentPreset, controller.signal)
        await admit(event, controller.signal, undefined, event, handoffs, recipient)
        if (event.type === 'session.event') for (const { name } of selection.sessionAliases.filter(alias => alias.nativeEvent === event.name)) {
          // The discovery fold already resolved this payload. Aliases share that
          // input, the identity and the handoff projection without another log read.
          await admit({ ...event, name }, controller.signal, undefined, event, handoffs, recipient)
        }
      }, controller.signal, selection))
        .finally(() => { if (recoveries.get(sessionId)?.controller === controller) recoveries.delete(sessionId) })
      recovery = { controller, task, selection: signature }
      recoveries.set(sessionId, recovery)
    }
    await recovery.task
    signal?.throwIfAborted()
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
  function bindingCurrent(item: Pick<WorkItem, 'rule' | 'nativeEvent'>): boolean {
    const { rule } = item
    return rule.on !== 'session.event' || BUILT_IN_EVENT_NAMES.has(rule.when.eventType)
      || (customEvents.has(rule.when.eventType) && item.nativeEvent === customEvents.nativeName(rule.when.eventType))
  }
  function aliasCurrent(candidate: CandidateValue): boolean {
    if (candidate.rule.on !== 'session.event' || BUILT_IN_EVENT_NAMES.has(candidate.rule.when.eventType)) return true
    const source = sources.get(candidate.sourceId)
    const rule = source?.value.rules.find(value => value.id === candidate.ruleId)
    // A declaration is part of the executable definition even when its source's
    // registration token has not changed. Reloading an owner must not revive a
    // pending body that was matched under a different native binding.
    return source !== undefined && rule !== undefined && customEvents.has(candidate.rule.when.eventType)
      && candidate.sourceSignature === sourceSignature(source.value, rule)
  }
  function current(candidate: CandidateValue, target: RecipientIdentity) {
    const source = sources.get(candidate.sourceId)
    const rule = source?.value.rules.find(value => value.id === candidate.ruleId)
    if (!source || !rule || !aliasCurrent(candidate)) return false
    const sameDefinition = source.token === candidate.sourceToken || (recovered.has(candidate.id)
      && candidate.sourceSignature === sourceSignature(source.value, rule))
    return sameDefinition && sourceAccepts(source, target) && ruleAccepts(rule, target)
  }
  /** Native inbox claims can arrive before this runtime has any candidate cache. */
  function restoreHandedMessages(sessionId: string, messages: readonly MessageView[]) {
    const state = records.get(sessionId) ?? empty()
    for (const message of messages) {
      if (message.id === undefined) continue
      // Live lifecycle decisions still apply. An old startup cache does not
      // override the validity fields and frozen body in an actual inbox claim.
      const candidate = candidateFromMessage(sessionId, message)
      if (!candidate) continue
      const index = state.candidates.findIndex(item => item.messageId === message.id || item.id === candidate.id)
      if (index !== -1 && !recovered.has(state.candidates[index].id)) {
        if (readDeliveries) nativeHandoffs.add(state.candidates[index].id)
        continue
      }
      if (readDeliveries) nativeHandoffs.add(candidate.id)
      const source = sources.get(candidate.sourceId)
      const rule = source?.value.rules.find(rule => rule.id === candidate.ruleId)
      if (source && rule && candidate.sourceSignature === sourceSignature(source.value, rule)) {
        candidate.sourceToken = source.token
      }
      if (index === -1) state.candidates.push(candidate)
      else state.candidates[index] = candidate
      // Once rebound, ordinary hot lifecycle checks own this candidate. Decoding
      // the same message again cannot undo disposal, rollback or consumption.
      recovered.delete(candidate.id)
      records.set(sessionId, state)
    }
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
  function invalidate(sourceId: string, next: Readonly<RegisteredSource['compiled']> = []) {
    const previous = sources.get(sourceId)?.compiled ?? []
    const affectsPreparation = previous.some(rule => rule.on === 'tool.before-execute')
      || next.some(rule => rule.on === 'tool.before-execute')
    const hasDenial = next.some(rule => rule.effect.kind === 'deny-tool')
      || [...sources.values()].some(source => source.compiled.some(rule => rule.effect.kind === 'deny-tool'))
    // Only pre-execution rules can affect authorization. A pre-execution reminder
    // can still affect a deny rule through priority/exclusivity, so retain that
    // invalidation whenever a denial exists. Other reminder refreshes cannot retire it.
    if (affectsPreparation && hasDenial) tickets.invalidate()
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
        run.task = evaluate(run).catch(error => {
          // Settlement cannot turn a thrown evaluation error into an ordinary unfinished ticket.
          run.preExecution?.fail(run.incomplete ?? (run.controller.signal.aborted
            ? codeForReason(run.controller.signal.reason) : 'unclassified'), error)
          report(error)
          return diagnostic(id, { eventId: run.event.callId, status: 'failed', message: errorMessage(error), ...errorDetail(error) })
        })
          .finally(() => { running.delete(id); run.resolve(); pump() })
      }
    } finally { pumping = false }
  }
  async function evaluate(run: Run) {
    const { event, items, controller } = run
    const blockedGroups = new Set<string>(), winners = new Set<string>(), results: CandidateValue[] = []
    // Only a pre-execution round can still stop its call; correlation uses the registry's execution token.
    const preExecution = event.type === 'tool.before-execute' ? run.preExecution : undefined
    const diagnostics: Record<string, unknown>[] = []
    // Every analyzer reads the same base input; only the matching phase sees their combined facts.
    event.facts = {}
    for (const analyzer of run.analyzers) {
      if (controller.signal.aborted || run.remainingMs <= 0) break
      if (analyzers.get(analyzer.ref) !== analyzer) continue
      let processingMs = 0
      try {
        const facts = AnalysisFacts.parse(await execute({ analysis: { analyzer, event: { ...event, facts: {} }, maxBytes: config.maxBytes } }, controller.signal,
          { onDispatch: () => {}, workTimeoutMs: Math.min(config.ruleTimeoutMs, run.remainingMs),
            onTiming: timing => { processingMs = timing.processingMs } }))
        controller.signal.throwIfAborted()
        if (analyzers.get(analyzer.ref) !== analyzer) continue
        if (Buffer.byteLength(JSON.stringify({ ...event.facts, [analyzer.ref]: facts })) > config.maxBytes) throw new Error('reminder-facts-budget-exceeded')
        event.facts[analyzer.ref] = facts
        diagnostics.push({ analyzer: analyzer.ref, revision: analyzer.revision, status: 'analyzed', eventId: event.callId })
      } catch (error) {
        diagnostics.push({ analyzer: analyzer.ref, status: controller.signal.aborted || /timeout/.test(errorMessage(error)) ? 'timed-out' : 'failed', message: errorMessage(error),
          ...errorDetail(error), eventId: event.callId })
      } finally { run.remainingMs = Math.max(0, run.remainingMs - processingMs) }
    }
    // 一次投递把这一轮的规则全送过去：事件只序列化一次，这是批量唯一的收益。
    // 但「批量完成」不等于「规则完成」——每条规则各自持有一份结局，
    // 批量只是送它们过去的那趟车，车翻了不等于乘客都出事了。
    type BatchEntry = { item: WorkItem; skip?: string }
    const entries: BatchEntry[] = items.map(item => {
      const { source, rule, token, policy } = item
      // 只有主线程才知道的两件事，在交给 worker 之前先查一遍：来源是否已经换代，
      // 判定器是否已经不在了。两者处理方式不同，所以不合并成一个 skip。
      if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy
        || !bindingCurrent(item)) {
        return { item, skip: 'reminder-source-changed' }
      }
      if (rule.judge && (item.judge?.revision !== rule.judge.revision || detectors.get(rule.judge.ref) !== item.judge)) {
        return { item, skip: 'reminder-judge-unavailable' }
      }
      return { item }
    })
    const evaluation = await evaluateRules({ event, execute, signal: controller.signal,
      remainingMs: run.remainingMs, ruleTimeoutMs: config.ruleTimeoutMs,
      maxBytes: config.maxBytes, countLimits: config.countLimits,
      rules: entries.flatMap((entry, index) => entry.skip === 'reminder-source-changed' ? [] : [{
        key: String(index), condition: entry.item.rule.condition,
        timeoutMs: Math.min(config.ruleTimeoutMs, entry.item.rule.judge?.timeoutMs ?? config.ruleTimeoutMs),
        ...(entry.item.rule.exclusiveGroup ? { exclusiveGroup: entry.item.rule.exclusiveGroup } : {}),
        ...(entry.skip ? { error: { name: 'Error', message: entry.skip } }
          : entry.item.judge ? { judge: entry.item.judge, params: entry.item.rule.judge?.params ?? null } : {}),
      }]),
    })
    run.remainingMs = evaluation.remainingMs
    const answers = new Map(entries.map((entry, index) => [entry.item, evaluation.answers.get(String(index))]))
    for (const entry of entries) {
      const { item } = entry
      const { source, token, rule, policy } = item
      // 预算只由 run.timer 的中止表达；此处再比一次墙钟会让同一份工作出现两种判定。
      if (controller.signal.aborted) { diagnostics.push({ status: 'round-timeout', eventId: event.callId }); break }
      if (rule.exclusiveGroup && (blockedGroups.has(rule.exclusiveGroup) || winners.has(rule.exclusiveGroup))) continue
      // 预检就不可用：来源换代只是跳过这一条，判定器没了则是这一轮少了一个答案。
      if (entry.skip === 'reminder-source-changed') continue
      if (entry.skip === 'reminder-judge-unavailable') {
        if (rule.exclusiveGroup) blockedGroups.add(rule.exclusiveGroup)
        run.incomplete ??= 'rule-failed'
        diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId, status: 'failed', message: entry.skip })
        continue
      }
      const answer = answers.get(item)
      // 没有回执：工作侧还没算到这条就停了，或者整批失败。未完成的原因上面已经记过。
      if (answer === undefined) continue
      if (answer.error !== undefined) {
        const failure = errorMessage(answer.error)
        if (rule.exclusiveGroup) blockedGroups.add(rule.exclusiveGroup)
        // 启动失败和规则超时对使用者是两件事，分类不能只看有没有 timeout 字样。
        run.incomplete ??= codeForFailure(failure)
        diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
          status: answer.notStarted ? 'not-evaluated' : /timeout/.test(failure) ? 'timed-out' : 'failed', message: failure, ...errorDetail(answer.error) })
        continue
      }
      // 结果回来了也要再确认一次来源：批量期间别人可能已经换掉了这组规则。
      if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy
        || !bindingCurrent(item)) continue
      // The transport consumer validates each answer once, including streamed results.
      const result = answer.match
      if (!result) continue
      try {
        if (result.ok) {
          const output = rule.on === 'assistant.output' ? event.output : undefined
          if (rule.on === 'assistant.output' && !output) throw new Error('reminder-output-evidence-missing')
          if (rule.exclusiveGroup) winners.add(rule.exclusiveGroup)
          if (item.handed) continue
          // A denial and an ordinary reminder take this same path: same validation, same delivery,
          // same quota. The denial only records that this call must also be refused.
          const definition = source.rules.find(value => value.id === rule.id)
          if (!definition) throw new Error('reminder-source-rule-missing')
          if (rule.effect.kind === 'deny-tool' && preExecution) {
            // Only a live registry execution token can own a denial. Native replay
            // restores the model reminder and never replays a historical tool action.
            run.denial ??= { sourceId: source.sourceId, ruleId: rule.id, reason: rule.effect.reason ?? rule.text }
          }
          results.push({ id: randomUUID(), sessionId: event.sessionId, ...(event.agentPreset === undefined ? {} : { agentPreset: event.agentPreset }), sourceId: source.sourceId, sourceToken: token, ruleId: rule.id,
            key: item.window ? JSON.stringify([source.sourceId, rule.id, 'model', item.window.id]) : keyOf(source.sourceId, rule.id),
            ...(item.window ? { window: item.window } : {}),
            ...(rule.on === 'request.before' ? { request: { type: 'request.before', humanActivity: event.humanActivity } } : {}),
            revision: source.revision, policy, ...(event.native ? { native: event.native } : {}), text: rule.text,
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
        // 这条规则没有答案：整轮不能算完成，否则会把“没评估”当成“没有命中”。
        // 超时和报错都算没有答案，但它们是两种不同的故障，拒绝理由要分开。
        run.incomplete ??= codeForFailure(errorMessage(error))
        diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
          status: /timeout/.test(errorMessage(error)) ? 'timed-out' : 'failed', message: errorMessage(error),
          ...errorDetail(error) })
      }
    }
    // Reaching the end of the loop is the only proof that no denial rule was skipped.
    // 完成与否只看这一轮有没有被中止：墙钟里还混着状态克隆、磁盘写入和别的主线程占用，
    // 用它判断“评估是否完成”会把与匹配无关的开销算成规则没评完。
    // 中止是整轮级别的事实，比单条规则失败更接近真相，所以它优先决定原因。
    if (controller.signal.aborted) run.incomplete ??= codeForReason(controller.signal.reason)
    run.evaluated = run.incomplete === undefined
    if (preExecution && !controller.signal.aborted && !closed) {
      // Identity is policy input. Disk speed and diagnostic persistence are not.
      try { await identity(event.sessionId, event.agentPreset, controller.signal) }
      catch (error) {
        preExecution.fail(controller.signal.aborted && error === controller.signal.reason
          ? codeForReason(controller.signal.reason) : 'identity', error)
        throw error
      }
      preExecution.settle(run.denial, run.evaluated === true, run.incomplete)
    }
    const matched = await update(event.sessionId, async state => {
      const pending: string[] = []
      const id = triggerKey(event.type, event.callId)
      if (preExecution && !state.seen.includes(id)) state.seen.push(id)
      state.diagnostics.push(...diagnostics.map(detail => AnalysisFacts.parse(jsonCopy(detail))))
      if (controller.signal.aborted || closed) return pending
      const target = run.recipient ?? await identity(event.sessionId, event.agentPreset, controller.signal)
      for (const candidate of results) {
        if (controller.signal.aborted || closed || !current(candidate, target) || !eligible(event.sessionId, candidate.sourceId, candidate.ruleId)
          || epoch(event.sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) continue
        for (const old of state.candidates) if (old.status === 'pending' && !fresh(old)) old.status = 'discarded'
        const existing = state.candidates.find(old => old.key === candidate.key && old.status === 'pending' && current(old, target))
        if (!existing) state.candidates.push(candidate)
        pending.push(existing?.id ?? candidate.id)
      }
      return pending
    })
    // Two matches have no durable trigger receipt of their own: a completed
    // pre-execution hook and an outcome observed without a native anchor (a tool
    // that ran before its paired call was visible). Assistant output folds back
    // from the native stream, and request rules are recomputed at each boundary.
    if (handoffPending && matched.length && event.type !== 'request.before' && event.type !== 'assistant.output'
      && ((event.type === 'tool.before-execute' && preExecution !== undefined) || !event.native)) {
      try { await handoffPending(event.sessionId, matched) }
      catch (error) {
        // A failed publication is not acceptance. Existing native receipts still
        // suppress any individually handed rules when the caller retries.
        run.handoffFailure = error instanceof Error ? error : new Error(errorMessage(error))
        const acceptedIds = new Set((readQueued?.(event.sessionId) ?? []).map(message => message.id))
        await update(event.sessionId, state => {
          state.seen = state.seen.filter(id => id !== triggerKey(event.type, event.callId))
          for (const candidate of state.candidates) {
            if (matched.includes(candidate.id) && candidate.queued && !acceptedIds.has(candidate.messageId)) {
              delete candidate.queued
              delete candidate.messageId
            }
          }
        })
        throw run.handoffFailure
      }
    }
  }
  /** Single admission path for composed events; a pre-execution round also carries its ticket key. */
  function admit(rawEvent: unknown, signal?: AbortSignal, preExecution?: PreExecution, nativeResolved?: EventValue, handoffs?: HandoffLookup, recipient?: RecipientIdentity): Promise<void> {
    // 每条早退都要先给票据一个明确的结论：缺票据会被读成“评估没做完”，
    // 那就把“服务停了”“队列满了”“事件坏了”说成同一件事，谁也没法据此修。
    if (closed) { preExecution?.settleUnfinished('closed'); return Promise.resolve() }
    if (signal?.aborted) { preExecution?.settleUnfinished('cancelled'); return Promise.resolve() }
    // Reserve capacity before the first persistence await; pending writes are part of the queue.
    if (admissions.size >= config.maxQueued + config.maxConcurrent) {
      preExecution?.settleUnfinished('capacity')
      return Promise.reject(new Error('reminder-capacity-exceeded'))
    }
    let serialized: string
    try {
      const value = JSON.stringify(rawEvent)
      if (value === undefined) throw new TypeError('reminder-event-not-serializable')
      serialized = value
    } catch (error) { preExecution?.fail('parse-failed', error); throw error }
    if (Buffer.byteLength(serialized) > config.maxBytes) {
      preExecution?.settleUnfinished('input-budget')
      return Promise.reject(new Error('reminder-input-budget-exceeded'))
    }
    // A rejected submission is reported through the public service, so its reason must survive relay.
    // 解析失败是事件本身坏了，不是评估没跑完：这一档也要自己说清楚。
    let event: EventValue
    try { event = parseOrThrow('提醒事件无效', () => Event.parse(JSON.parse(serialized))) }
    catch (error) { preExecution?.fail('parse-failed', error); throw error }
    // A human turn breaks the reminder chain; a reminder-caused event extends it. Only
    // derived activations are affected by this count (see loopBlocked).
    const rememberOrigin = () => {
      if (event.origin === 'human') reminderChains.delete(event.sessionId)
      else if (event.origin === 'reminder') reminderChains.set(event.sessionId, (reminderChains.get(event.sessionId) ?? 0) + 1)
    }
    if (!event.native) rememberOrigin()
    // 这一轮最终没给出答案的原因；走不到终点时由它记录，票据据此写出拒绝理由。
    let unfinished: UnfinishedCode = 'unclassified'
    const admission: { sessionId: string; controller: AbortController; task?: Promise<void> } = { sessionId: event.sessionId, controller: new AbortController() }
    admissions.add(admission)
    // Promise invokes its executor synchronously before this resolver is read.
    let resolve!: () => void
    const done = new Promise<void>(finish => { resolve = finish })
    const run: Run = { event, items: [], analyzers: [...analyzers.values()], recipient, controller: admission.controller, remainingMs: config.roundTimeoutMs, resolve, done,
      ...(preExecution === undefined ? {} : { preExecution }) }
    const abort = () => {
      run.controller.abort(signal?.reason ?? new Error('reminder-round-timeout'))
      // 从队列里撤下这一轮：调用方主动取消，还是它自己等到超时，是两种不同的结局。
      unfinished = signal?.aborted ? 'cancelled' : 'round-timeout'
      const queue = queues.get(event.sessionId), index = queue?.indexOf(run) ?? -1
      if (queue && index >= 0) {
        queue.splice(index, 1); if (!queue.length) queues.delete(event.sessionId)
        void diagnostic(event.sessionId, { eventId: event.callId, status: signal?.aborted ? 'cancelled' : 'queue-timeout' }).catch(() => {}).finally(resolve)
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    // Native reconstruction, identity and persistence own admission capacity,
    // but none of their I/O spends the Worker execution budget.
    const resolveTarget = async () => {
      const alias = event.type === 'session.event' && typeof event.name === 'string'
        && customEvents.nativeName(event.name) !== undefined ? event.name : undefined
      if (alias && event.native?.type !== 'session-event') {
        unfinished = 'parse-failed'
        throw new Error(`自定义事件 ${alias} 需要原生 Session 事件锚点`)
      }
      if (event.native) {
        unfinished = 'native-event'
        // Discovery owns one native read for many samples. Public submissions still
        // resolve their anchor, while recovered canonical values retain all checks.
        let canonical = nativeResolved ?? event
        if (!nativeResolved) {
          if (!resolveEvent) throw new Error('reminder-native-tool-history-unavailable')
          canonical = await resolveEvent(event, run.controller.signal)
        }
        run.controller.signal.throwIfAborted()
        if (alias) canonical = customEvents.project(alias, canonical)
        if (canonical.sessionId !== event.sessionId) throw new Error('reminder-native-tool-session-mismatch')
        unfinished = 'parse-failed'
        const value = JSON.stringify(canonical)
        if (Buffer.byteLength(value) > config.maxBytes) {
          unfinished = 'input-budget'
          throw new Error('reminder-input-budget-exceeded')
        }
        event = Event.parse(JSON.parse(value))
        run.event = event
        unfinished = 'unclassified'
        await retireNativeCopies(event)
        rememberOrigin()
      }
      run.controller.signal.throwIfAborted()
      if (run.recipient) return run.recipient
      // Only this lookup owns the identity classification. Later admission work does not.
      unfinished = 'identity'
      const target = await identity(event.sessionId, event.agentPreset, run.controller.signal)
      unfinished = 'unclassified'
      return target
    }
    admission.task = resolveTarget().then(async target => {
      if (closed || run.controller.signal.aborted) return false
      run.items = [...sources.values()].filter(item => sourceAccepts(item, target))
        .flatMap(item => item.compiled.filter(rule => ruleAccepts(rule, target) && requestEligible(rule, event)
          && eligible(event.sessionId, item.value.sourceId, rule.id)
          && (!event.native || event.native.seq > sinceSeq(event.sessionId, item.value.sourceId, rule.id))
          && !loopBlocked(event, item.value.sourceId, rule.id, rule.effect.kind))
          .map(rule => ({ rule, source: item.value, token: item.token, policy: epoch(event.sessionId, item.value.sourceId, rule.id),
            nativeEvent: rule.on === 'session.event' ? customEvents.nativeName(rule.when.eventType) : undefined,
            judge: rule.judge ? detectors.get(rule.judge.ref) : undefined,
            window: rule.effect.deliver.model.once === 'window' || rule.effect.deliver.model.shared?.reset === 'window'
              ? localWindow('timeWindow' in rule.when ? rule.when.timeWindow : undefined, event.clock?.at) : undefined })))
        .sort((a, b) => b.rule.priority - a.rule.priority || a.source.sourceId.localeCompare(b.source.sourceId) || a.rule.id.localeCompare(b.rule.id))
      const acceptedTrigger = handoffs ?? (wasHanded ? (id: string, output?: Parameters<HandoffLookup>[1]) => wasHanded(event.sessionId, id, output) : undefined)
      if (acceptedTrigger) {
        const handed = await Promise.all(run.items.map(item => acceptedTrigger(triggerKey(event.type, event.callId),
          { sourceId: item.source.sourceId, ruleId: item.rule.id,
            ...(item.rule.exclusiveGroup ? { exclusiveGroup: item.rule.exclusiveGroup } : {}),
            ...(event.output ? { output: event.output } : {}) })))
        const unresolvedGroups = new Set(run.items.flatMap((item, index) => !handed[index] && item.rule.exclusiveGroup ? [item.rule.exclusiveGroup] : []))
        // A different prefix may have a different exclusive winner. If no native
        // handoff records this exact choice, retain handed rules as barriers for
        // unresolved alternatives, while preventing a second candidate for them.
        run.items = run.items.flatMap((item, index) => !handed[index] ? [item]
          : item.rule.exclusiveGroup && unresolvedGroups.has(item.rule.exclusiveGroup) ? [{ ...item, handed: true }] : [])
      }
      if (!run.items.length) {
        // No rule in this session's policy applies to this call, so the evaluation is
        // complete: record that answer. The guard reads a ticket for every call, and an
        // unmatched tool is a verdict, not a missing one.
        preExecution?.settle(undefined, true)
        return false
      }
      // Older handoffs without rule identity retain their phase-wide receipt.
      // Current handoffs were checked per rule above, including exclusive choices.
      const id = triggerKey(event.type, event.callId)
      if (acceptedTrigger && await acceptedTrigger(id)) {
        unfinished = 'duplicate-call'
        return false
      }
      if (closed || run.controller.signal.aborted) return false
      if (preExecution) {
        const recent = recentExecutions.get(event.sessionId) ?? []
        if (recent.includes(event.callId) || records.get(event.sessionId)?.seen.includes(id)) {
          unfinished = 'duplicate-call'
          return false
        }
        recent.push(event.callId)
        recentExecutions.set(event.sessionId, recent.slice(-(config.maxQueued * 4 + config.maxConcurrent)))
        return true
      }
      return update(event.sessionId, state => {
        if (run.controller.signal.aborted) return false
        // 同一个 callId 已经有一轮在跑：这次提交没得到属于自己的答案。
        if (state.seen.includes(id)) { unfinished = 'duplicate-call'; return false }
        state.seen.push(id); return true
      })
    }).then(admitted => {
      if (!admitted || closed || run.controller.signal.aborted) return
      const queue = queues.get(event.sessionId) ?? []; queue.push(run); queues.set(event.sessionId, queue); pump()
      return done.then(() => { if (run.handoffFailure) throw run.handoffFailure })
    }).catch(async error => {
      // Preserve the actual exception before finally settles the ticket. A concurrent
      // cancellation cannot relabel an unrelated error as an expected abort.
      if (!run.controller.signal.aborted || error !== run.controller.signal.reason) {
        preExecution?.fail(unfinished, error)
        throw error
      }
      await diagnostic(event.sessionId, { eventId: event.callId, status: signal?.aborted ? 'cancelled' : 'queue-timeout' })
    }).finally(() => {
      signal?.removeEventListener('abort', abort); admissions.delete(admission)
      // Every preparation ends with a verdict. A round that never ran (capacity, cancellation,
      // queue timeout, duplicate call id) settles as an unfinished evaluation, which denies, so
      // the guard never has to interpret an absence.
      preExecution?.settleUnfinished(run.incomplete ?? (run.controller.signal.aborted
        ? codeForReason(run.controller.signal.reason) : unfinished))
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
      const target = await identity(sessionId, agentPreset, signal)
      const rules = [...sources.values()].filter(source => sourceAccepts(source, target)).flatMap(source =>
        source.compiled.filter(rule => rule.on === 'request.before' && ruleAccepts(rule, target)
          && eligible(sessionId, source.value.sourceId, rule.id)))
      if (!rules.length) return
      // Presence is a short-lived condition, not a session-lifetime projection.
      // No interested rule means no history reads; each rule still checks its own smaller window.
      const withinMs = rules.reduce((longest, rule) => Math.max(longest,
        rule.on === 'request.before' ? (rule.when.humanActivity?.withinSeconds ?? 0) * 1000 : 0), 0)
      const at = wallNow(), callId = `request:${randomUUID()}`
      await this.submit({ type: 'request.before', sessionId, ...(agentPreset === undefined ? {} : { agentPreset }), callId, rootCallId: callId,
        clock: { at, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        humanActivity: humanActivity(events, at, withinMs), context: requestContext([...visible, ...accepted], config) }, signal)
    },
    /** Select exact action facts; the Host applies them only after the real tool result commits. */
    async prepareSnooze({ sessionId, agentPreset, sourceId, ruleId }: RecipientIdentity & { sourceId?: string; ruleId?: string }) {
      if (closed) throw new Error('reminder-runtime-closed')
      if ((sourceId === undefined) !== (ruleId === undefined)) throw new Error('sourceId and ruleId must be supplied together')
      const target = await identity(sessionId, agentPreset)
      const selected = [...sources.values()].filter(source => sourceAccepts(source, target)
        && (sourceId === undefined || source.value.sourceId === sourceId))
        .flatMap(source => source.compiled.filter(rule => rule.effect.kind === 'remind'
          && rule.effect.deliver.model.once === 'window'
          && ruleAccepts(rule, target)
          && (ruleId === undefined || rule.id === ruleId)).map(rule => ({ sourceId: source.value.sourceId, rule })))
      const suppressed: import('./snooze.js').SnoozeWindowValue[] = []
      for (const item of selected) {
        const window = localWindow('timeWindow' in item.rule.when ? item.rule.when.timeWindow : undefined, wallNow())
        if (!window) continue
        const key = JSON.stringify([item.sourceId, item.rule.id, 'model', window.id])
        suppressed.push({ sourceId: item.sourceId, ruleId: item.rule.id, key, until: window.end })
      }
      return suppressed
    },
    /** Standalone compatibility port; production callers must use the real snooze tool. */
    async snooze(input: RecipientIdentity & { sourceId?: string; ruleId?: string }) {
      if (readDeliveries) throw new Error('reminder-snooze-requires-native-tool-result')
      const suppressed = await this.prepareSnooze(input)
      return update(input.sessionId, state => {
        for (const item of suppressed) {
          state.windows = state.windows.filter(claim => claim.key !== item.key)
          state.windows.push({ key: item.key, until: item.until })
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
        changed()
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
        invalidate(value.sourceId, compiled)
        rejectedSources.delete(next.sourceId)
        sources.set(value.sourceId, { owner, acceptSession, token: randomUUID(), value: next, compiled })
        changed(next.sessionId)
      }
      replace(value)
      let disposed = false
      return { replace: (next: unknown) => { if (disposed) throw new Error('reminder-source-disposed'); replace(next) },
        async dispose() { if (disposed) return; disposed = true; invalidate(value.sourceId); sources.delete(value.sourceId); changed(value.sessionId)
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
    submit(rawEvent: unknown, signal?: AbortSignal) {
      const primary = admit(rawEvent, signal)
      // The committed Session observer supplies raw native names. Project each
      // declared alias in the same order during live observation and cold replay.
      if (typeof rawEvent !== 'object' || rawEvent === null || !('type' in rawEvent) || rawEvent.type !== 'session.event') return primary
      const native = Event.safeParse(rawEvent)
      if (!native.success || native.data.type !== 'session.event' || native.data.native?.type !== 'session-event') return primary
      if (typeof native.data.name !== 'string') return primary
      const names = customEvents.aliases(native.data.name)
      if (!names.length) return primary
      return primary.then(async () => {
        for (const name of names) await admit({ ...native.data, name }, signal)
      })
    },
    /** Evaluate denial policy before a tool body runs; the guard later reads this ticket. */
    async prepareToolExecution({ key, sessionId, agentPreset, name, arguments: args, callId, rootCallId, native, signal }: ToolPreparation) {
      if (closed) return
      const pre = openPreExecution(key, tickets)
      const before = [...sources.values()].flatMap(item => item.compiled.filter(rule => rule.on === 'tool.before-execute'))
      // 只有 deny-tool 能改变行为。纯提醒规则即使挂在执行前，也不得拦住这次调用：
      // 先把票据结为放行，再照常评估投递——提醒晚一拍没有代价，卡住工具却有很大代价。
      if (!before.some(rule => rule.effect.kind === 'deny-tool')) pre.settle(undefined, true)
      // 一条执行前规则都没有时无需评估。
      if (!before.length) return
      try {
        void admit({ type: 'tool.before-execute', sessionId, ...(agentPreset === undefined ? {} : { agentPreset }),
          callId, rootCallId, name, arguments: args, ...(native ? { native } : {}), clock: { at: wallNow() }, facts: {} }, signal, pre)
          .catch(error => { pre.fail('unclassified', error); report(error) })
      } catch (error) {
        // Serialization and other synchronous entry failures must also reach the guard.
        pre.fail('unclassified', error)
        report(error)
      }
      await pre.done
    },
    /**
     * Declare the custom events a rule may select by name. The owner keeps the returned
     * disposer inside a Cordis effect, so unloading that plugin withdraws its names:
     * nothing can publish them afterwards, and `handlesSessionEvent` reports them as
     * unreachable even though already-compiled rules still mention them.
     */
    registerCustomEvents(descriptors: CustomEventDescriptor[]) {
      if (closed) throw new Error('reminder-runtime-closed')
      return customEvents.register(descriptors)
    },
    /**
     * Publish an alias of a committed Session event. The binding and native seq
     * determine payload, clock and idempotency; copied eventId/at/facts cannot
     * override them. Unbound events remain available only to standalone runtimes.
     */
    async publishCustomEvent({ sessionId, name, eventId, at, facts, native }: {
      sessionId: string; name: string; eventId?: string; at?: number; facts?: unknown
      native?: { type: 'session-event'; seq: number }
    }, signal?: AbortSignal) {
      if (closed) throw new Error('reminder-runtime-closed')
      if (!customEvents.has(name)) throw new Error(`自定义事件 ${name} 未被声明`)
      const bound = customEvents.nativeName(name) !== undefined
      if (bound && !native) throw new Error(`自定义事件 ${name} 需要原生 Session 事件锚点`)
      if (!bound && native) throw new Error(`自定义事件 ${name} 缺少原生日志绑定`)
      if (!bound && !eventId?.trim()) throw new Error('自定义事件缺少幂等键 eventId')
      const callId = bound && native ? `${name}#${native.seq}` : eventId
      await admit(Event.parse(jsonCopy({ type: 'session.event', sessionId, name, arguments: facts,
        callId, rootCallId: callId, ...(native ? { native } : {}), clock: { at: at ?? wallNow() }, facts: {} })), signal)
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
          if (rule.on === 'session.event' && (rule.when.eventType === eventType || customEvents.nativeName(rule.when.eventType) === eventType)) return true
        }
      }
      return false
    },
    /** Synchronous guard decision; never awaits, so another listener cannot re-allow a denial. */
    decideToolExecution(key: object) { return tickets.decide(key) },
    /** Release a settled execution's ticket. */
    settleToolExecution(key: object) { tickets.settle(key) },
    async settle(sessionId: string) {
      // Previous callers have already received write failures. A new collection may retry the durable writer.
      await Promise.allSettled([...admissions].filter(item => item.sessionId === sessionId).map(item => item.task))
      await chains.get(sessionId)?.catch(() => {})
      await Promise.all([running.get(sessionId)?.done, ...(queues.get(sessionId) ?? []).map(run => run.done)])
      await chains.get(sessionId)?.catch(() => {})
    },
    /** Await the owning state lane; standalone writers additionally own late I/O. */
    async drainPersistence(sessionId?: string) {
      if (persistence) await persistence.drain(sessionId)
      else await Promise.allSettled(sessionId === undefined ? [...chains.values()] : [chains.get(sessionId)])
    },
    pendingPersistence() { return persistence?.pending() ?? [] },
    snapshot(sessionId: string) { return structuredClone({ ...(records.get(sessionId) ?? empty()), sources: [...sources.values()].map(item => item.value), storageError: failures.has(sessionId) }) },
    /** Freeze an unreserved match into native pending input; quota is checked when a later request claims it. */
    async queuePending({ sessionId, agentPreset, visible, accepted = [], candidateIds, signal }: CollectInput) {
      restoreHandedMessages(sessionId, accepted)
      const claimed = new Set(accepted.filter(message => message.source?.reminder?.handoff?.queued).map(message => message.id))
      return update(sessionId, async state => {
        const target = await identity(sessionId, agentPreset, signal)
        const visibleKeys = new Set(visible.flatMap(reminderKeys))
        const messages: ReturnType<typeof reminderMessage>[] = []
        for (const candidate of state.candidates) {
          if (candidate.status !== 'pending' || !(candidateIds?.includes(candidate.id) || claimed.has(candidate.messageId))) continue
          if (candidate.queued && !claimed.has(candidate.messageId)) continue
          if (closed || !fresh(candidate) || !current(candidate, target) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
            || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) continue
          if ((candidate.rule.effect.deliver.model.once !== 'none' && visibleKeys.has(candidate.key))
            || state.windows.some(item => item.key === candidate.key)) continue
          if (!candidate.rendered) {
            candidate.text = renderText(candidate.rule.text, candidate.evidence)
            candidate.rendered = true
          }
          candidate.queued = true
          candidate.messageId ??= randomUUID()
          messages.push(reminderMessage(candidate, candidate.messageId, ''))
        }
        return messages
      })
    },
    async collect({ sessionId, agentPreset, visible, accepted = [], committedIds = [], signal, candidateIds }: CollectInput) {
      signal?.throwIfAborted()
      // A caller selecting known candidate ids already owns their evaluation.
      // Broad collection discovers history and waits for all session admissions.
      if (!candidateIds) {
        await recoverNative(sessionId, agentPreset, signal)
        await this.settle(sessionId); signal?.throwIfAborted()
      }
      const queuedMessages = readQueued?.(sessionId)
      restoreHandedMessages(sessionId, [...(queuedMessages ?? []), ...accepted])
      const queuedIds = queuedMessages && new Set([...queuedMessages, ...accepted].map(message => message.id))
      const cached = records.get(sessionId)
      if (!cached?.candidates.some(candidate => candidate.status === 'pending' || candidate.status === 'reserved')
        && !cached?.stickies.length) {
        // Only a sticky rule can produce a delivery without a pending candidate.
        // An unrelated request must not restore history or write an empty state.
        const stickySources = [...sources.values()].filter(source => source.compiled.some(rule =>
          rule.effect.deliver.model.sticky && eligible(sessionId, source.value.sourceId, rule.id)))
        if (!stickySources.length) return []
        const target = await identity(sessionId, agentPreset, signal)
        if (!stickySources.some(source => sourceAccepts(source, target) && source.compiled.some(rule =>
          rule.effect.deliver.model.sticky && ruleAccepts(rule, target)
          && eligible(sessionId, source.value.sourceId, rule.id)))) return []
      }
      const reserved: string[] = []
      return update(sessionId, async state => {
        const messages: ReturnType<typeof reminderMessage>[] = [], present = [...visible, ...accepted]
        const visibleKeys = new Set(visible.flatMap(reminderKeys))
        const occupiedKeys = new Set(accepted.filter(message => !message.source?.reminder?.handoff?.queued).flatMap(reminderKeys))
        // Accepted inbox entries are not committed yet; pre-step filtering still owns their handoff.
        const committed = new Set([...committedIds, ...visible.map(message => message.id)])
        // The human-turn clock advances only on a new human message, not on every request.
        let lastHumanId = ''
        for (const message of present) if (message.source?.kind === 'user' && message.id !== undefined) lastHumanId = message.id
        const deliveries = await readDeliveries?.(sessionId, lastHumanId)
        const humanId = deliveries?.humanId ?? lastHumanId
        if (deliveries) {
          // Committed deliveries, snooze results and sticky activations all come
          // from the native Session fold; these arrays are disposable working state.
          // Candidate reservations added below are transient until their message commits.
          state.windows = deliveries.windows
          state.stickies = deliveries.stickies
        }
        const consume: string[] = []
        const isCommitted = (id: string) => committed.has(id) || deliveries?.committedIds.has(id) === true
        for (const candidate of state.candidates) {
          if (candidate.status !== 'reserved'
            && !(candidate.status === 'pending' && candidate.messageId && isCommitted(candidate.messageId))) continue
          if (!candidate.messageId) throw new Error('reminder-reservation-identity-missing')
          if (isCommitted(candidate.messageId)) {
            candidate.status = 'delivered'
            if (quotaFor(candidate)) consume.push(candidate.messageId)
            // The native projection already spent this committed delivery exactly once.
            if (deliveries) continue
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
          } else if (!aliasCurrent(candidate)) {
            // A withdrawn/rebound alias cannot occupy the new binding's rule
            // slot. A real inbox reservation still waits for native cancellation
            // or the pre-step rollback before its shared quota can be released.
            state.windows = state.windows.filter(item => item.messageId !== candidate.messageId)
            if (!nativeHandoffs.has(candidate.id)) {
              candidate.status = 'discarded'
              if (!candidate.sticky?.charged && quotaFor(candidate)) await claims({ release: [candidate.messageId] })
            }
          } else occupiedKeys.add(candidate.key) // Unknown handoff cannot be retried merely because the process restarted.
        }
        if (consume.length) await claims({ consume })
        const ticked = deliveries?.ticked ?? advanceStickies(state, humanId)
        pendSticky(state, sessionId, ticked)
        for (const candidate of state.candidates) {
          if (candidate.status !== 'pending' || (candidateIds && !candidateIds.includes(candidate.id))) continue
          if (candidate.queued && queuedIds && !queuedIds.has(candidate.messageId)) { candidate.status = 'discarded'; continue }
          // A persisted rollback keeps its old message id until shared release is acknowledged.
          // A later sticky tick never reserved a quota, so it has nothing to release.
          if (candidate.messageId && !candidate.queued && !candidate.sticky?.charged && quotaFor(candidate)) {
            await claims({ release: [candidate.messageId] })
            delete candidate.messageId
          }
          const target = await identity(sessionId, agentPreset, signal)
          if (closed || !fresh(candidate) || !current(candidate, target) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
            || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) { candidate.status = 'discarded'; continue }
          if (occupiedKeys.has(candidate.key)
            || (candidate.rule.effect.deliver.model.once !== 'none' && visibleKeys.has(candidate.key))
            || state.windows.some(item => item.key === candidate.key)) { candidate.status = 'discarded'; continue }
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
          const messageId = candidate.queued && candidate.messageId ? candidate.messageId : randomUUID()
          const quota = candidate.sticky?.charged ? undefined : quotaFor(candidate)
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
          occupiedKeys.add(candidate.key)
          candidate.messageId = messageId; candidate.status = 'reserved'
          delete candidate.queued
          if (candidate.window && candidate.rule.effect.kind === 'remind' && candidate.rule.effect.deliver.model.once === 'window') state.windows.push({ key: candidate.key, until: candidate.window.end, messageId })
          messages.push(reminderMessage(candidate, messageId, humanId))
        }
        return messages
      }, {
        onFailure: async () => { if (reserved.length) await claims({ release: reserved }) },
        onAbandoned: async (messages, io) => {
          // The caller received no messages, but the late reservation really ACKed.
          // Roll it back in this lane BEFORE making its shared quota available again.
          const next = structuredClone(records.get(sessionId) ?? empty())
          const release = rollbackCandidates(next, new Set(messages.map(message => message.id)))
          await io.persist(next)
          if (release.length) await claims({ release })
        },
      })
    },
    async rollback(sessionId: string, messages: MessageView[]) {
      const ids = new Set(messages.flatMap(message => message.source?.kind === REMINDER_MESSAGE_KIND && message.id ? [message.id] : []))
      if (!ids.size) return
      const release = await update(sessionId, state => rollbackCandidates(state, ids), {
        // Timeout did not cancel the write. A late ACK must still finish its release.
        onAbandoned: async release => { if (release.length) await claims({ release }) },
      })
      if (release.length) await claims({ release })
    },
    async filterMessages<Message extends MessageView>(sessionId: string, visible: MessageView[], messages: Message[], agentPreset?: string, queued = false) {
      if (!messages.some(message => message.source?.kind === REMINDER_MESSAGE_KIND)) return messages
      const target = await identity(sessionId, agentPreset)
      restoreHandedMessages(sessionId, messages)
      const visibleKeys = new Set(visible.flatMap(reminderKeys)), handedKeys = new Set<string>()
      const state = records.get(sessionId)
      return messages.filter(message => {
        if (message.source?.kind !== REMINDER_MESSAGE_KIND) return true
        const candidate = state?.candidates.find(item => item.messageId === message.id)
        if (closed || !state || !candidate
          || (queued ? candidate.status !== 'pending' || !candidate.queued
            : candidate.status !== 'reserved' || message.source.reminder?.handoff?.queued)
          || !fresh(candidate) || !current(candidate, target)
          || handedKeys.has(candidate.key) || (candidate.rule.effect.deliver.model.once !== 'none' && visibleKeys.has(candidate.key))
          || state.windows?.some(item => item.key === candidate.key && item.messageId !== message.id) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
          || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) return false
        handedKeys.add(candidate.key); return true
      })
    },
    async close() {
      closed = true
      for (const recovery of recoveries.values()) recovery.controller.abort(new Error('reminder-runtime-closed'))
      for (const admission of admissions) admission.controller.abort(new Error('reminder-runtime-closed'))
      for (const queue of queues.values()) for (const run of queue) { run.resolve() }
      queues.clear()
      for (const run of running.values()) run.controller.abort(new Error('reminder-runtime-closed'))
      await Promise.allSettled([...running.values()].map(run => run.done))
      await Promise.allSettled([...admissions].map(item => item.task))
      await Promise.allSettled([...recoveries.values()].map(recovery => recovery.task))
      tickets.dispose()
      // close rejects on an observation timeout; it never detaches a still-running write.
      // A later close may wait again. drainPersistence is the real I/O resource barrier.
      await persistence?.close()
      await Promise.allSettled([...chains.values(), capacityWrite])
      sources.clear(); detectors.clear(); analyzers.clear(); rejectedSources.clear(); nativeHandoffs.clear()
    },
  }
}
