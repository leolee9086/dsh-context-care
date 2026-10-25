import { z } from 'zod'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { localWindow } from './request-context.js'
import { ensureSessionLog } from '../session-log.js'
import type { CacheKey } from '../session-cache.js'
import { readSnoozeResult, SNOOZE_TOOL } from './snooze.js'
import { triggerKey, type HandoffRule, type OutputHandoffRule, type StateValue, type StickyStateValue } from './state.js'

// 历史快照只提供当时的投递参数，不重新执行或校验规则。
type RecordedModel = {
  once: string
  sticky?: Pick<StickyStateValue, 'clock' | 'cooldown'> & { lifetime: number }
  shared?: unknown
}
type RecordedRule = { when: { timeWindow?: { start: string; end: string } } } & (
  | { effect: { deliver: { model: RecordedModel } } }
  | { deliver: { model: RecordedModel } }
)

const KIND = 'plugin:dsh-context-care:reminder'
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const Delivery = z.object({ id: z.string(), content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  source: z.object({ kind: z.literal(KIND), summary: z.string(),
    reminder: z.object({ key: z.string(), candidateId: z.string(), sessionId: z.string().optional(), humanId: z.string().optional(),
      window: z.object({ id: z.string(), start: z.number(), end: z.number() }).optional(),
      shared: z.object({ key: z.string(), until: z.number().optional() }).nullable().optional() }),
    contextCareTrace: z.object({ sourceId: z.string(), ruleId: z.string(), rule: z.unknown(),
      evidence: z.object({ activationId: z.string().optional(),
        event: z.object({ clock: z.object({ at: z.number() }).optional() }).optional(),
        clock: z.object({ at: z.number() }).optional() }).passthrough() }) }) })
const Trigger = z.object({ source: z.object({ kind: z.literal(KIND),
  reminder: z.object({ sessionId: z.string().optional() }),
  // Dedup needs only the recorded trigger kind, not today's validation of an old rule.
  contextCareTrace: z.object({ callId: z.string().optional(), rule: z.unknown().optional(),
    sourceId: z.string().optional(), ruleId: z.string().optional(), output: z.object({ attemptId: z.string(), turn: z.number(), step: z.number() }).optional() }),
}) })
type Activation = { value: StickyStateValue; deliveredStep: number }
interface Projection {
  cursor: number
  step: number
  openStep: boolean
  humanStep: number
  humanId: string
  humanArrival: string
  humanCommit: string
  inheritedEnd: number
  windows: Map<string, StateValue['windows'][number]>
  stickies: Map<string, Activation>
  toolCalls: Map<string, string>
  committed: Set<string>
  handedEvents: Map<string, number>
  handedRules: Map<string, number>
  handedOutputs: Map<string, number>
  handedChoices: Map<string, number>
  outputCutoffs: Map<string, number>
  inbox: Record<'next-turn' | 'next-step', UserMessage[]>
  queued: Map<string, UserMessage>
}
export interface DeliveryState {
  windows: StateValue['windows']
  stickies: StickyStateValue[]
  ticked: Set<string>
  committedIds: ReadonlySet<string>
  humanId: string
  /** Accepted unreserved input remains retryable after claim until commit or cancellation. */
  queued: readonly UserMessage[]
}

function emptyProjection(inheritedEnd: number): Projection {
  return { cursor: 0, step: -1, openStep: false, humanStep: -1, humanId: '', humanArrival: '', humanCommit: '', inheritedEnd,
    windows: new Map(), stickies: new Map(), toolCalls: new Map(), committed: new Set(), handedEvents: new Map(),
    handedRules: new Map(), handedOutputs: new Map(), handedChoices: new Map(), outputCutoffs: new Map(),
    inbox: { 'next-turn': [], 'next-step': [] }, queued: new Map() }
}

/** A clock spends cooldown only after its final delivery has actually committed. */
function tick(projection: Projection, clock: StickyStateValue['clock'], humanId?: string) {
  for (const [id, activation] of projection.stickies) {
    const value = activation.value
    if (value.clock !== clock || (clock === 'human-turn' && value.lastHumanId === humanId)) continue
    if (humanId !== undefined) value.lastHumanId = humanId
    // A queued reminder can precede the human input in the same committed batch.
    // That input belongs to its delivery request, not to a later cooldown turn.
    if (value.remaining === 0 && (clock !== 'human-turn' || activation.deliveredStep !== projection.step)) {
      if (value.cooldown === 0) projection.stickies.delete(id)
      else value.cooldown -= 1
    }
  }
}

/**
 * A snooze is a committed tool result. Its JSON body carries the exact window
 * selected by that invocation, so replay never re-runs current rule selection.
 */
function applySnooze(projection: Projection, sessionId: string, content: unknown, meta: unknown) {
  const result = readSnoozeResult(Array.isArray(content) ? content : [], meta)
  if (!result || result.sessionId !== sessionId) return
  for (const window of result.windows) {
    projection.windows.set(window.key, { key: window.key, until: window.until })
  }
}

function outputRuleKey(rule: OutputHandoffRule): string {
  return JSON.stringify([rule.output.attemptId, rule.sourceId, rule.ruleId])
}
function outputStepKey(rule: OutputHandoffRule): string {
  return JSON.stringify([rule.output.turn, rule.output.step, rule.sourceId, rule.ruleId])
}
function handoffRuleKey(eventId: string, rule: Pick<HandoffRule, 'sourceId' | 'ruleId'>): string {
  return JSON.stringify([eventId, rule.sourceId, rule.ruleId])
}
function outputChoiceKey(eventId: string, group: string): string {
  return JSON.stringify([eventId, group])
}
function handed(state: Projection, sessionId: string, eventId: string, rule?: HandoffRule, fromSeq = 0): boolean {
  const accepted = (seq: number | undefined) => seq !== undefined && seq >= fromSeq
  if (!rule) return accepted(state.handedEvents.get(eventId))
  if (accepted(state.handedRules.get(handoffRuleKey(eventId, rule)))) return true
  if (rule.exclusiveGroup && accepted(state.handedChoices.get(outputChoiceKey(eventId, rule.exclusiveGroup)))) return true
  if (!rule.output) return false
  const outputRule: OutputHandoffRule = { ...rule, output: rule.output }
  if (accepted(state.handedOutputs.get(outputRuleKey(outputRule)))) return true
  const prefix = `session:${sessionId}:output:`, attempt = outputRule.output.attemptId
  if (!attempt.startsWith(prefix)) return false
  const boundary = Number(attempt.slice(prefix.length)), cutoff = state.outputCutoffs.get(outputStepKey(outputRule))
  return Number.isSafeInteger(boundary) && boundary >= 0 && cutoff !== undefined && cutoff - 1 >= fromSeq && boundary < cutoff
}

/** A real inbox acceptance or message commit establishes this trigger's completed match. */
function rememberTrigger(projection: Projection, sessionId: string, value: unknown) {
  if (!record(value) || !record(value.source) || value.source.kind !== KIND) return
  const source = Trigger.parse(value).source
  if (source.reminder.sessionId !== undefined && source.reminder.sessionId !== sessionId) return
  const { callId, rule, sourceId, ruleId, output } = source.contextCareTrace
  const type = record(rule) && typeof rule.on === 'string' ? rule.on : undefined
  // Each rule owns its handoff. A shared native event id must not suppress
  // another rule whose candidate has not entered the inbox or Session yet.
  if (callId !== undefined) {
    const eventId = triggerKey(type, callId)
    if (sourceId !== undefined && ruleId !== undefined) {
      const key = handoffRuleKey(eventId, { sourceId, ruleId })
      projection.handedRules.set(key, Math.max(projection.handedRules.get(key) ?? -1, projection.cursor - 1))
    } else if (type !== 'assistant.output') projection.handedEvents.set(eventId, Math.max(projection.handedEvents.get(eventId) ?? -1, projection.cursor - 1))
    if (record(rule) && typeof rule.exclusiveGroup === 'string') {
      const key = outputChoiceKey(eventId, rule.exclusiveGroup)
      projection.handedChoices.set(key, Math.max(projection.handedChoices.get(key) ?? -1, projection.cursor - 1))
    }
  }
  // A natural boundary coalesces an output rule's pending prefixes from one
  // attempt. Later retries in the same step retain their own native identities.
  if (type === 'assistant.output' && sourceId !== undefined && ruleId !== undefined && output !== undefined) {
    const handed = { sourceId, ruleId, output }
    const key = outputRuleKey(handed)
    projection.handedOutputs.set(key, Math.max(projection.handedOutputs.get(key) ?? -1, projection.cursor - 1))
    // A handed message consumes pending prefixes from attempts already started
    // in that native step. The cursor also covers older lifecycle-local attempt
    // ids without mistaking a later retry for an already delivered observation.
    const stepKey = outputStepKey(handed)
    projection.outputCutoffs.set(stepKey, Math.max(projection.outputCutoffs.get(stepKey) ?? 0, projection.cursor))
  }
}

/** Native message commits, not visibility after compaction, establish delivery. */
function apply(projection: Projection, sessionId: string, event: SessionEvent) {
  if (event.seq < projection.cursor) return
  projection.cursor = event.seq + 1
  if (event.type === 'agent/inbox/spliced') {
    const splice = event.data, inbox = projection.inbox[splice.target]
    const removed = inbox.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
    if (splice.outcome === 'canceled') for (const message of removed) projection.queued.delete(String(message.id))
    if (event.seq >= projection.inheritedEnd) {
      for (const message of splice.inserted) {
        rememberTrigger(projection, sessionId, message)
        if (message.source.kind === KIND && message.source.reminder.handoff?.queued
          && message.source.reminder.sessionId === sessionId) projection.queued.set(String(message.id), message)
      }
      if (splice.inserted.some(message => message.source.kind === 'user')) projection.humanArrival = String(event.seq)
    }
    return
  }
  if (event.type === 'user/message' && event.seq >= projection.inheritedEnd && event.data.source.kind === 'user') {
    projection.humanCommit = String(event.seq)
  }
  if (event.type === 'step/start') {
    projection.step = event.seq
    projection.openStep = true
    tick(projection, 'main-request')
    return
  }
  if (event.type === 'step/end' || event.type === 'turn/start' || event.type === 'turn/end') {
    projection.openStep = false
    return
  }
  if (event.type === 'tool/call') {
    const data: unknown = event.data
    if (record(data) && typeof data.callId === 'string' && typeof data.name === 'string') {
      projection.toolCalls.set(data.callId, data.name)
    }
    return
  }
  if (event.type === 'tool/ptc-dispatch') {
    const data: unknown = event.data
    if (record(data) && data.name === SNOOZE_TOOL && data.isError !== true) {
      applySnooze(projection, sessionId, data.content, data.meta)
    }
    return
  }
  if (event.type === 'tool/result') {
    const data: unknown = event.data
    const message = record(data) && record(data.message) ? data.message : undefined
    if (!message || message.isError === true) return
    const source = record(message.source) ? message.source : undefined
    const meta = record(data) ? data.meta : undefined
    const callId = typeof message.toolCallId === 'string' ? message.toolCallId
      : source && typeof source.callId === 'string' ? source.callId : undefined
    const name = callId === undefined ? undefined : projection.toolCalls.get(callId)
    if (name === SNOOZE_TOOL) applySnooze(projection, sessionId, message.content, meta)
    if (callId !== undefined) projection.toolCalls.delete(callId)
    return
  }
  if (event.type !== 'user/message' || projection.committed.has(String(event.data.id))) return
  projection.committed.add(String(event.data.id))
  projection.queued.delete(String(event.data.id))
  if (event.seq >= projection.inheritedEnd) rememberTrigger(projection, sessionId, event.data)
  if (event.data.source.kind === 'user') {
    projection.humanId = String(event.data.id)
    if (!projection.openStep || projection.humanStep !== projection.step) tick(projection, 'human-turn', projection.humanId)
    else for (const { value } of projection.stickies.values()) {
      if (value.clock === 'human-turn') value.lastHumanId = projection.humanId
    }
    projection.humanStep = projection.step
    return
  }
  if (event.data.source.kind !== KIND) return
  const message = Delivery.parse(event.data)
  // A fork inherits readable context, not its parent's local activation counters.
  if (event.seq < projection.inheritedEnd || (message.source.reminder.sessionId !== undefined
    && message.source.reminder.sessionId !== sessionId)) return
  const { reminder, contextCareTrace: trace } = message.source
  const rule = trace.rule as RecordedRule
  const model = 'effect' in rule ? rule.effect.deliver.model : rule.deliver.model
  if (model.once === 'window') {
    let window = reminder.window
    if (!window) {
      // 早期 request.before 把触发时钟直接记在 evidence.clock；它同样是原生投递事实。
      const at = trace.evidence.event?.clock?.at ?? trace.evidence.clock?.at
      if (at === undefined || !rule.when.timeWindow) throw new Error('reminder-delivery-window-evidence-missing')
      window = localWindow(rule.when.timeWindow, at)
      if (!window || reminder.key !== JSON.stringify([trace.sourceId, trace.ruleId, 'model', window.id])) {
        throw new Error('reminder-delivery-window-evidence-mismatch')
      }
    }
    projection.windows.set(reminder.key, { key: reminder.key, until: window.end, messageId: message.id })
  }
  const parent = trace.evidence.activationId
  if (parent !== undefined) {
    const activation = projection.stickies.get(parent)
    if (activation) {
      activation.value.remaining = Math.max(0, activation.value.remaining - 1)
      activation.deliveredStep = projection.step
      activation.value.lastHumanId = projection.humanId
    }
  } else if (model.sticky) {
    projection.stickies.set(reminder.candidateId, { deliveredStep: projection.step, value: {
      key: JSON.stringify([trace.sourceId, trace.ruleId, reminder.candidateId]), activationId: reminder.candidateId,
      sourceId: trace.sourceId, ruleId: trace.ruleId, sessionId,
      text: message.content.map(block => block.text).join(''), title: message.source.summary,
      clock: model.sticky.clock, remaining: model.sticky.lifetime - 1, cooldown: model.sticky.cooldown,
      charged: reminder.shared === undefined ? model.shared !== undefined : reminder.shared !== null,
      lastHumanId: projection.humanId,
    } })
  }
}

/**
 * Disposable delivery projection. Cold reads use the native query service; live
 * commits advance the same fold. No rule, judge or template runs while restoring.
 */
export function createSessionDeliveries(ctx: Context, now: () => number = Date.now) {
  const history = ensureSessionLog(ctx)
  const stateKey: CacheKey<object, Projection> = history.cache.define('reminder-deliveries',
    'Exact live Session or immutable cold log owner; successful native fold cursor.',
    (_owner, dependencies) => emptyProjection(Number(dependencies[0])))
  // The lightweight outstanding-input view does not restore clocks or old tools.
  const queuedKey: CacheKey<Session, Pick<Projection, 'cursor' | 'inheritedEnd' | 'inbox' | 'queued'>> = history.cache.define('reminder-queued-input',
    'Native Session identity and committed acceptance cursor.',
    session => ({ cursor: 0, inheritedEnd: session.inheritedEventCount, inbox: { 'next-turn': [], 'next-step': [] }, queued: new Map() }))
  const cached = (session: Session) => history.cache.peek(session, stateKey, [session.inheritedEventCount])
  const receiptKey: CacheKey<object, { state: Projection; from: number; through: number; commits: Map<string, number>;
    selected?: { from: number; revision: number; ids: ReadonlySet<string> }; revision: number }> = history.cache.define('reminder-handoff-receipts',
    'Immutable log owner and covered native suffix; receipt sequence validates each requested anchor.',
    (_owner, dependencies) => ({ state: emptyProjection(Number(dependencies[0])), from: Infinity, through: 0, commits: new Map(), revision: 0 }))
  async function receipts(sessionId: string, fromSeq: number) {
    using log = await history.read(sessionId as SessionId)
    if (closed) throw new Error('reminder-deliveries-closed')
    const indexed = history.cache.use(log.owner, receiptKey, [log.inheritedEventCount])
    const from = Math.max(fromSeq, log.inheritedEventCount)
    const fold = (start: number, end: number) => {
      for (const event of log.select(['user/message', 'agent/inbox/spliced'], start, end)) {
        indexed.state.cursor = event.seq + 1
        if (event.type === 'user/message') {
          rememberTrigger(indexed.state, sessionId, event.data)
          const id = String(event.data.id), prior = indexed.commits.get(id)
          if (prior === undefined || prior < event.seq) { indexed.commits.set(id, event.seq); indexed.revision++ }
        } else if (event.type === 'agent/inbox/spliced') {
          for (const message of event.data.inserted) rememberTrigger(indexed.state, sessionId, message)
        }
        history.cache.worked(receiptKey)
      }
    }
    try {
      if (indexed.from === Infinity) fold(from, log.length)
      else {
        if (from < indexed.from) fold(from, Math.min(indexed.from, log.length))
        if (indexed.through < log.length) fold(Math.max(indexed.from, indexed.through), log.length)
      }
      indexed.from = Math.min(indexed.from, from); indexed.through = Math.max(indexed.through, log.length)
      return { indexed, from, through: log.length }
    } catch (error) { history.cache.invalidate(log.owner, receiptKey); throw error }
  }
  // These queues are in-flight transactions, not reconstructable cached views.
  // Exact owners prevent a detached Session's fold from becoming a reused id's state.
  const pending = new Map<object, SessionEvent[]>()
  const restoring = new Map<object, Promise<Projection>>()
  let closed = false

  async function restore(sessionId: string): Promise<Projection> {
    if (closed) throw new Error('reminder-deliveries-closed')
    const nativeId = sessionId as SessionId, session = ctx.sessions.get(nativeId)
    const state = session && cached(session)
    if (session && !restoring.has(session) && state?.cursor === session.seq) return state
    using log = await history.read(nativeId)
    if (closed) throw new Error('reminder-deliveries-closed')
    const active = restoring.get(log.owner)
    if (active) return active
    const queued: SessionEvent[] = []
    pending.set(log.owner, queued)
    const task = (async () => {
      const dependencies = [log.inheritedEventCount], next = history.cache.use(log.owner, stateKey, dependencies)
      try {
        let processed = 0
        for (const event of log.select(['user/message', 'agent/inbox/spliced', 'step/start', 'step/end',
          'turn/start', 'turn/end', 'tool/call', 'tool/result', 'tool/ptc-dispatch'], next.cursor)) {
          apply(next, sessionId, event); history.cache.worked(stateKey)
          if (++processed % 2048 === 0) {
            await yieldToHost()
            if (closed) throw new Error('reminder-deliveries-closed')
          }
        }
        next.cursor = Math.max(next.cursor, log.length)
        for (const event of queued) apply(next, sessionId, event)
        return next
      } catch (error) {
        if (!closed && history.cache.peek(log.owner, stateKey, dependencies) === next) history.cache.invalidate(log.owner, stateKey)
        throw error
      }
    })()
    restoring.set(log.owner, task)
    try { return await task }
    finally { restoring.delete(log.owner); pending.delete(log.owner) }
  }

  return {
    /** Newly created sessions can maintain this projection without a history read. */
    created(session: Session) {
      if (!closed && session.firstLiveSeq === 0) history.cache.use(session, stateKey, [session.inheritedEventCount])
    },
    /** Read accepted inputs, including quota-blocked claims no longer in the inbox. */
    queued(sessionId: string) {
      if (closed) throw new Error('reminder-deliveries-closed')
      const session = ctx.sessions.get(sessionId as SessionId)
      const full = session && cached(session)
      let accepted = full?.queued
      if (session && full?.cursor !== session.seq) {
        const state = history.cache.use(session, queuedKey)
        using log = history.live(session)
        // No rule matching, rendering or judges run here. Only native acceptance,
        // commit and cancellation can change the frozen outstanding input set.
        try {
          for (const event of log.select(['agent/inbox/spliced', 'user/message'], state.cursor)) {
            if (event.type === 'agent/inbox/spliced') {
              const splice = event.data
              const removed = state.inbox[splice.target].splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
              if (splice.outcome === 'canceled') for (const message of removed) state.queued.delete(String(message.id))
              if (event.seq >= state.inheritedEnd) for (const message of splice.inserted) {
                if (message.source.kind === KIND && message.source.reminder.handoff?.queued
                  && message.source.reminder.sessionId === sessionId) state.queued.set(String(message.id), message)
              }
            } else if (event.type === 'user/message') state.queued.delete(String(event.data.id))
            history.cache.worked(queuedKey)
          }
          state.cursor = log.length
          accepted = state.queued
        } catch (error) { history.cache.invalidate(session, queuedKey); throw error }
      }
      const messages = new Map(accepted)
      const agent = ctx.get('agents')?.get(sessionId as SessionId)
      for (const message of [...(agent?.inbox.nextTurn ?? []), ...(agent?.inbox.nextStep ?? [])]) {
        if (message.source.kind === KIND && message.source.reminder.handoff?.queued
          && message.source.reminder.sessionId === sessionId) messages.set(String(message.id), message)
      }
      return structuredClone([...messages.values()])
    },
    observe(session: Session, event: SessionEvent) {
      if (closed) return
      const id = String(session.id), queued = pending.get(session)
      if (queued) { queued.push(event); return }
      const state = cached(session)
      if (state) {
        try { apply(state, id, event) }
        catch (error) { history.cache.invalidate(session, stateKey); throw error }
      }
    },
    /** Cache-only read for the final synchronous cancel/steer check. */
    currentHumanTurn(sessionId: string): string | undefined {
      const session = ctx.sessions.get(sessionId as Session['id']), state = session && cached(session)
      if (closed || !state || !session || restoring.has(session) || state.cursor !== session.seq) return undefined
      return state.humanArrival || state.humanCommit || 'initial'
    },
    /** Native handoff evidence survives cancellation, compaction and an empty runtime cache. */
    async wasHanded(sessionId: string, eventId: string, rule?: HandoffRule, fromSeq?: number): Promise<boolean> {
      if (closed) throw new Error('reminder-deliveries-closed')
      if (fromSeq === undefined) return handed(await restore(sessionId), sessionId, eventId, rule)
      const session = ctx.sessions.get(sessionId as SessionId)
      const state = session && cached(session)
      if (session && !restoring.has(session) && state?.cursor === session.seq) return handed(state, sessionId, eventId, rule, fromSeq)
      const { indexed, from } = await receipts(sessionId, fromSeq)
      return handed(indexed.state, sessionId, eventId, rule, from)
    },
    /** Last local human arrival; a delayed commit does not create a new interrupt budget. */
    async humanTurn(sessionId: string): Promise<string> {
      const state = await restore(sessionId)
      return state.humanArrival || state.humanCommit || 'initial'
    },
    async read(sessionId: string, currentHumanId: string, fromSeq?: number): Promise<DeliveryState> {
      if (closed) throw new Error('reminder-deliveries-closed')
      if (fromSeq !== undefined) {
        const { indexed, from, through } = await receipts(sessionId, fromSeq)
        if (indexed.selected?.from !== from || indexed.selected.revision !== indexed.revision) {
          const ids = new Set<string>()
          for (const [id, seq] of indexed.commits) if (seq >= from && seq < through) ids.add(id)
          indexed.selected = { from, revision: indexed.revision, ids }
        }
        return { windows: [], stickies: [], ticked: new Set(), committedIds: indexed.selected.ids, humanId: currentHumanId, queued: [] }
      }
      const state = await restore(sessionId)
      // Compaction can remove the last human message from visibility, not from the
      // real turn clock. Only a new accepted human input prospectively advances it.
      const humanId = currentHumanId && !state.committed.has(currentHumanId) ? currentHumanId : state.humanId
      const stickies: StickyStateValue[] = [], ticked = new Set<string>()
      for (const activation of state.stickies.values()) {
        const value = structuredClone(activation.value)
        if (value.clock === 'main-request' && !state.openStep) {
          // Native admission precedes step/start. This copy previews its tick;
          // only the subsequent committed event advances the cached clock.
          if (value.remaining > 0) ticked.add(value.activationId)
          else if (value.cooldown === 0) continue
          else value.cooldown -= 1
        } else if (value.clock === 'human-turn' && value.lastHumanId !== humanId) {
          value.lastHumanId = humanId
          if (value.remaining > 0) ticked.add(value.activationId)
          else if (value.cooldown === 0) continue
          else value.cooldown -= 1
        }
        stickies.push(value)
      }
      for (const [key, window] of state.windows) if (window.until <= now()) state.windows.delete(key)
      return { windows: [...state.windows.values()], stickies, ticked, committedIds: state.committed, humanId,
        queued: structuredClone([...state.queued.values()]) }
    },
    close() { closed = true; history.cache.clear(stateKey); history.cache.clear(queuedKey); history.cache.clear(receiptKey); pending.clear() },
  }
}
