import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { localWindow } from './request-context.js'
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
        event: z.object({ clock: z.object({ at: z.number() }).optional() }).optional() }).passthrough() }) }) })
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
  handedEvents: Set<string>
  handedRules: Set<string>
  handedOutputs: Set<string>
  handedChoices: Set<string>
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
    windows: new Map(), stickies: new Map(), toolCalls: new Map(), committed: new Set(), handedEvents: new Set(),
    handedRules: new Set(), handedOutputs: new Set(), handedChoices: new Set(), outputCutoffs: new Map(),
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
function handed(state: Projection, sessionId: string, eventId: string, rule?: HandoffRule): boolean {
  if (!rule) return state.handedEvents.has(eventId)
  if (state.handedRules.has(handoffRuleKey(eventId, rule))) return true
  if (rule.exclusiveGroup && state.handedChoices.has(outputChoiceKey(eventId, rule.exclusiveGroup))) return true
  if (!rule.output) return false
  const outputRule: OutputHandoffRule = { ...rule, output: rule.output }
  if (state.handedOutputs.has(outputRuleKey(outputRule))) return true
  const prefix = `session:${sessionId}:output:`, attempt = outputRule.output.attemptId
  if (!attempt.startsWith(prefix)) return false
  const boundary = Number(attempt.slice(prefix.length)), cutoff = state.outputCutoffs.get(outputStepKey(outputRule))
  return Number.isSafeInteger(boundary) && boundary >= 0 && cutoff !== undefined && boundary < cutoff
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
      projection.handedRules.add(handoffRuleKey(eventId, { sourceId, ruleId }))
    } else if (type !== 'assistant.output') projection.handedEvents.add(eventId)
    if (record(rule) && typeof rule.exclusiveGroup === 'string') {
      projection.handedChoices.add(outputChoiceKey(eventId, rule.exclusiveGroup))
    }
  }
  // A natural boundary coalesces an output rule's pending prefixes from one
  // attempt. Later retries in the same step retain their own native identities.
  if (type === 'assistant.output' && sourceId !== undefined && ruleId !== undefined && output !== undefined) {
    const handed = { sourceId, ruleId, output }
    projection.handedOutputs.add(outputRuleKey(handed))
    // A handed message consumes pending prefixes from attempts already started
    // in that native step. The cursor also covers older lifecycle-local attempt
    // ids without mistaking a later retry for an already delivered observation.
    projection.outputCutoffs.set(outputStepKey(handed), projection.cursor)
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
      const at = trace.evidence.event?.clock?.at
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
  const states = new Map<string, Projection>()
  const pending = new Map<string, SessionEvent[]>()
  const restoring = new Map<string, Promise<Projection>>()
  let closed = false

  async function restore(sessionId: string): Promise<Projection> {
    if (closed) throw new Error('reminder-deliveries-closed')
    const nativeId = sessionId as SessionId, session = ctx.sessions.get(nativeId)
    const state = states.get(sessionId)
    // A live cursor validates the cache. A dormant Session has no live cursor,
    // so its native log must be read without creating an Agent to validate it.
    if (session && state?.cursor === session.seq) return state
    const active = restoring.get(sessionId)
    if (active) return active
    const query = ctx.get('sessionQuery')
    if (!query) throw new Error('reminder-delivery-session-history-unavailable')
    const task = (async () => {
      const queued: SessionEvent[] = []
      pending.set(sessionId, queued)
      try {
        const log = await query.readSession(nativeId)
        if (closed) throw new Error('reminder-deliveries-closed')
        const next = emptyProjection(log.inheritedEventCount)
        for (const event of log.events) apply(next, sessionId, event)
        for (const event of queued) apply(next, sessionId, event)
        states.set(sessionId, next)
        return next
      } finally { pending.delete(sessionId) }
    })()
    restoring.set(sessionId, task)
    try { return await task }
    finally { restoring.delete(sessionId) }
  }

  return {
    /** Newly created sessions can maintain this projection without a history read. */
    created(session: Session) {
      if (!closed && session.firstLiveSeq === 0) states.set(String(session.id), emptyProjection(0))
    },
    /** Reuse the trigger discovery read; a live prefix may already be ahead of it. */
    observeLog(sessionId: string, log: { events: readonly SessionEvent[]; inheritedEventCount?: number }) {
      if (closed) throw new Error('reminder-deliveries-closed')
      const next = states.get(sessionId) ?? emptyProjection(log.inheritedEventCount ?? 0)
      for (const event of log.events) apply(next, sessionId, event)
      states.set(sessionId, next)
    },
    /** Read uncommitted queued handoffs from an already observed native scan. */
    queued(sessionId: string) {
      const state = states.get(sessionId)
      return state ? structuredClone([...state.queued.values()]) : []
    },
    observe(session: Session, event: SessionEvent) {
      if (closed) return
      const id = String(session.id), queued = pending.get(id)
      if (queued) { queued.push(event); return }
      const state = states.get(id)
      if (state) {
        try { apply(state, id, event) }
        catch (error) { states.delete(id); throw error }
      }
    },
    /** Cache-only read for the final synchronous cancel/steer check. */
    currentHumanTurn(sessionId: string): string | undefined {
      const state = states.get(sessionId), session = ctx.sessions.get(sessionId as Session['id'])
      if (closed || !state || !session || state.cursor !== session.seq) return undefined
      return state.humanArrival || state.humanCommit || 'initial'
    },
    /** Native handoff evidence survives cancellation, compaction and an empty runtime cache. */
    async wasHanded(sessionId: string, eventId: string, rule?: HandoffRule): Promise<boolean> {
      return handed(await restore(sessionId), sessionId, eventId, rule)
    },
    /** One cold read serves every sample in the caller's ordered recovery scan. */
    async handoffs(sessionId: string) {
      const state = await restore(sessionId)
      return (eventId: string, rule?: HandoffRule) => handed(state, sessionId, eventId, rule)
    },
    /** Last local human arrival; a delayed commit does not create a new interrupt budget. */
    async humanTurn(sessionId: string): Promise<string> {
      const state = await restore(sessionId)
      return state.humanArrival || state.humanCommit || 'initial'
    },
    async read(sessionId: string, currentHumanId: string): Promise<DeliveryState> {
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
    close() { closed = true; states.clear(); pending.clear() },
  }
}
