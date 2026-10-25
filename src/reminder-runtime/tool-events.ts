import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type {} from '@deepseek-ai/dsh-tools'
import { Event, type EventValue, type NativeRecoverySelection } from './state.js'
import { nativeSessionEvent, resolveNativeSessionEvent } from './native-session-events.js'
import { requestContext, type MessageView } from './request-context.js'
import type { OutputConfig } from './output-stream.js'
import { nativeOutputSamples } from './native-output-events.js'
import { sessionMessageTail } from '../session-log.js'

interface Call {
  nativeSeq?: number
  name: string
  arguments: unknown
  rootCallId: string
}
interface Submission { event: EventValue }
export interface NativeHistory {
  sessions: Pick<Context['sessions'], 'get' | 'prepare' | 'messageProjections'>
  readSession: (id: Session['id']) => Promise<{ events: readonly SessionEvent[]; inheritedEventCount?: number;
    at?(seq: number): SessionEvent | undefined; range?(fromSeq: number): Iterable<SessionEvent>; [Symbol.dispose]?(): void }>
}
interface Config {
  maxContextChars: number
  maxContextMessages: number
  maxQueued: number
  maxConcurrent: number
  output?: OutputConfig
}

/** Parse the model's raw arguments using the native dispatch rules. */
function argumentsOf(raw: string): unknown {
  try { return raw ? JSON.parse(raw) : {} }
  catch { return raw }
}

/** The logged call is the recoverable input boundary; replay does not execute its body. */
function beforeCall(sessionId: string, event: SessionEvent): EventValue {
  if (event.type !== 'tool/call' && event.type !== 'tool/ptc-dispatch-start') throw new Error('reminder-native-tool-call-not-found')
  const callId = event.type === 'tool/call' ? String(event.data.callId) : String(event.data.subCallId)
  return Event.parse({ type: 'tool.before-execute', sessionId, callId,
    rootCallId: event.type === 'tool/call' ? callId : String(event.data.rootCallId), name: event.data.name,
    arguments: event.type === 'tool/call' ? argumentsOf(event.data.arguments) : event.data.arguments,
    clock: { at: event.time }, native: { type: 'tool-call', seq: event.seq }, facts: {} })
}

/** The native PTC route rejection happens before the extensible pre-execute pipeline. */
function collapsedCall(event: SessionEvent, name: string): boolean {
  if (event.type !== 'tool/result' || event.data.error?.code !== 'UNKNOWN_TOOL'
    || event.data.error.name !== 'ToolNotFoundError') return false
  const content = event.data.message.content
  // UNKNOWN_TOOL alone is insufficient: an actually unknown name still enters
  // pre-execute. The registry's collapsed-name result includes this exact route.
  const text = `Error: unknown tool "${name}": only \`run_code\` is callable directly — call \`${name}\` from inside a \`run_code\` program instead`
  return content.length === 1 && content[0].type === 'text' && content[0].text === text
}

/** Exclude earlier PTC rejection and cancellations with no proof of a hook observation. */
function unobservedBeforeCalls(events: Iterable<SessionEvent>): ReadonlySet<string> {
  const skipped = new Set<string>(), names = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool/call') names.set(String(event.data.callId), event.data.name)
    else if (event.type === 'tool/result') {
      const id = String(event.data.message.toolCallId), name = names.get(id)
      if (event.data.error?.code === 'ABORTED_BEFORE_DISPATCH' || (name !== undefined && collapsedCall(event, name))) skipped.add(id)
      names.delete(id)
    } else if (event.type === 'tool/ptc-dispatch' && event.data.error?.code === 'ABORTED_BEFORE_DISPATCH') skipped.add(String(event.data.subCallId))
  }
  return skipped
}

/** Build one trigger from committed outcome fields and its historical context. */
function result(config: Config, sessionId: string, terminal: SessionEvent, callId: string, call: Call,
  isError: boolean, code: string | undefined, messages: readonly MessageView[], excludeMessageId?: string): Submission {
  const visible = messages.filter(message => message.id !== excludeMessageId)
  return { event: Event.parse({ type: isError ? 'tool.failed' : 'tool.succeeded',
    sessionId, callId, rootCallId: call.rootCallId, name: call.name, arguments: call.arguments,
    ...(isError ? { error: { code } } : {}), clock: { at: terminal.time }, context: requestContext(visible, config),
    native: { type: 'tool-result', seq: terminal.seq },
  }) }
}

/** One assistant settlement can contain several distinct native output samples. */
function cacheKey(event: EventValue): string {
  const position = event.native
  if (!position) throw new Error('reminder-native-tool-position-missing')
  const key = `${position.type}:${position.seq}`
  return position.type === 'assistant-output' ? `${key}:${event.callId}` : key
}

/**
 * Derive tool reminders from actual committed call/result events. Both maps are
 * disposable; neither records a judge outcome or acknowledges a reminder.
 * @param config - matcher context bounds and live admission capacity.
 * @param history - native reads and detached preparation used after cache loss.
 * @returns the live event fold, canonical trigger resolution and lifecycle release.
 */
export function createToolEvents(config: Config, history?: NativeHistory) {
  let calls = new WeakMap<Session, Map<string, Call>>()
  let cached = new WeakMap<Session, Map<string, EventValue>>()
  let fullyObserved = new WeakMap<Session, string>()
  let outputThrough = new WeakMap<Session, number>()
  const limit = config.maxQueued + config.maxConcurrent
  function put(session: Session, id: string, call: Call) {
    let pending = calls.get(session)
    if (!pending) { pending = new Map(); calls.set(session, pending) }
    pending.set(id, call)
  }
  function take(session: Session, id: string): Call | undefined {
    const pending = calls.get(session), call = pending?.get(id)
    pending?.delete(id)
    if (!pending?.size) calls.delete(session)
    return call
  }
  function remember(session: Session | undefined, submission: Submission): Submission {
    if (!session) return submission
    let events = cached.get(session)
    if (!events) { events = new Map(); cached.set(session, events) }
    const position = submission.event.native
    if (!position) throw new Error('reminder-native-tool-position-missing')
    // Submission recipients can annotate their copy; the private cache retains
    // an independent value so that such changes cannot replace native facts.
    events.set(cacheKey(submission.event), structuredClone(submission.event))
    while (events.size > limit) {
      const first = events.keys().next()
      if (!first.done) events.delete(first.value)
    }
    return submission
  }
  /** One ordered recovery uses the native surface fold; each historical event enters it once. */
  function historicalPrefix(events: readonly SessionEvent[], signal: AbortSignal) {
    if (!history) throw new Error('reminder-native-tool-history-unavailable')
    const prefix: SessionEvent[] = [], nodes: SessionEvent['seq'][] = []
    // Only interpret already validated native observations. Keep position metadata here;
    // message content and plugin-owned rewrites remain owned by the native interpreters.
    let native: Session | undefined
    const definitions = history.sessions.messageProjections
    const used = new Set<(typeof definitions)[number]>()
    const projected = new Map<SessionEvent['seq'], NonNullable<ReturnType<Session['deriveEventMessage']>>>()
    const assertDefinitions = () => {
      for (const definition of used) if (!definitions.includes(definition)) {
        throw new Error(`reminder-native-message-projection-unloaded: ${definition.type}`)
      }
    }
    const pending = new Map<string, Extract<SessionEvent, { type: 'tool/call' }>>()
    return async (terminal: SessionEvent): Promise<{ messages: MessageView[]; call?: Call }> => {
      while (prefix.length < terminal.seq) {
        signal.throwIfAborted()
        const event = events[prefix.length]
        assertDefinitions()
        const definition = definitions.find(item => item.type === event.type)
        if (definition) {
          const updates = definition.project(event, { nodes, events: prefix,
            baseSeq: 0 as Session['inheritedEventCount'], messages: projected })
          for (const [seq, message] of updates) projected.set(seq, message)
          used.add(definition)
        } else if (event.surfaceOp === 'append') nodes.push(event.seq)
        else if (event.surfaceOp && typeof event.surfaceOp === 'object' && 'op' in event.surfaceOp && event.surfaceOp.op === 'replace') {
          const start = nodes.indexOf(event.surfaceOp.startSeq), end = nodes.indexOf(event.surfaceOp.endSeq)
          if (start < 0 || end < start) throw new Error('reminder-native-surface-range-missing')
          nodes.splice(start, end - start + 1, event.seq)
        }
        prefix.push(event)
        // Match the original reverse lookup: each result uses the nearest preceding call,
        // including histories with more than one recorded result for that call.
        if (event.type === 'tool/call') pending.set(String(event.data.callId), event)
        if (prefix.length % 2048 === 0) { await yieldToHost(); signal.throwIfAborted() }
      }
      assertDefinitions()
      const messages: MessageView[] = []
      // One extra message preserves requestContext's truncation flag without deriving the whole surface.
      for (let index = nodes.length - 1; index >= 0 && messages.length <= config.maxContextMessages; index--) {
        native ??= history.sessions.prepare()
        const seq = nodes[index], message = projected.get(seq) ?? native.deriveEventMessage(prefix[seq])
        if (message) messages.unshift(message)
      }
      if (terminal.type !== 'tool/result') return { messages }
      const called = pending.get(String(terminal.data.message.toolCallId))
      return { messages, ...(called ? { call: { name: called.data.name,
        arguments: argumentsOf(called.data.arguments), rootCallId: String(called.data.callId) } } : {}) }
    }
  }
  /** Interpret one native result against its original prefix, never the current surface. */
  function fromLog(sessionId: string, position: number, events: readonly SessionEvent[],
    prefix?: { messages: MessageView[]; call?: Call }): Submission {
    if (!history) throw new Error('reminder-native-tool-history-unavailable')
    const terminal = events[position]
    if (!terminal || terminal.seq !== position
      || (terminal.type !== 'tool/result' && terminal.type !== 'tool/ptc-dispatch')) {
      throw new Error('reminder-native-tool-result-not-found')
    }
    const code = terminal.data.error?.code
    if (code === 'ABORTED_BEFORE_DISPATCH') throw new Error('reminder-native-tool-result-not-dispatched')
    // Native interpretation preserves replacements and content projections at
    // this boundary. A later surface cannot substitute for the historical input.
    if (!prefix) throw new Error('reminder-native-tool-prefix-missing')
    const messages = prefix.messages
    if (terminal.type === 'tool/ptc-dispatch') {
      const data = terminal.data
      return result(config, sessionId, terminal, String(data.subCallId), { name: data.name,
        arguments: data.arguments, rootCallId: String(data.rootCallId) }, data.isError, code, messages)
    }
    const { message } = terminal.data, id = String(message.toolCallId)
    const call = prefix.call
    if (!call) throw new Error('reminder-native-tool-call-not-found')
    return result(config, sessionId, terminal, id, call, message.isError === true, code, messages)
  }
  function outputHistory(sessionId: string, events: readonly SessionEvent[]): Pick<Session, 'id' | 'seq' | 'eventAt'> {
    return { id: sessionId as Session['id'], seq: events.length as Session['seq'],
      eventAt: seq => events[seq] }
  }
  function* outputSamples(session: Pick<Session, 'id' | 'seq' | 'eventAt'>, terminal: Extract<SessionEvent, { type: 'assistant/message' | 'assistant/attempt' }>) {
    if (!config.output) throw new Error('reminder-native-output-config-missing')
    for (const sample of nativeOutputSamples(config.output, session, terminal, error => { throw error })) {
      yield { event: Event.parse({ ...sample.event, native: { type: 'assistant-output', seq: terminal.seq } }), afterCommit: sample.afterCommit }
    }
  }
  return {
    /** Newly created Sessions have no missed tool history; raw events still depend on rule interest. */
    created(session: Session) { if (session.firstLiveSeq === 0) fullyObserved.set(session, '*') },
    /** Cache the actual native event separately from a tool outcome at the same seq. */
    observeSession(session: Session, event: SessionEvent): EventValue {
      return remember(session, { event: nativeSessionEvent(String(session.id), event) }).event
    },
    /** Only an actual logged call can supply a native anchor for the execution hook. */
    preparation(session: Session, callId: string): { type: 'tool-call'; seq: number } | undefined {
      const seq = calls.get(session)?.get(callId)?.nativeSeq
      return seq === undefined ? undefined : { type: 'tool-call', seq }
    },
    /** A paired native call publishes its result after the execution hook. */
    waitForCommit(session: Session, callId: string): boolean {
      return calls.get(session)?.has(callId) === true
    },
    /** Fold the synchronous post-commit feed; old events must use resolve instead. */
    observe(session: Session, event: SessionEvent): Submission | undefined {
      if (event.type === 'tool/call') {
        put(session, String(event.data.callId), { nativeSeq: event.seq, name: event.data.name,
          arguments: argumentsOf(event.data.arguments), rootCallId: String(event.data.callId) })
        remember(session, { event: beforeCall(String(session.id), event) })
      } else if (event.type === 'tool/ptc-dispatch-start') {
        put(session, String(event.data.subCallId), { nativeSeq: event.seq, name: event.data.name,
          arguments: event.data.arguments, rootCallId: String(event.data.rootCallId) })
        remember(session, { event: beforeCall(String(session.id), event) })
      } else if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
        // A final surface contains later messages and later content projections.
        // It cannot supply an old trigger's matcher or judge context.
        if (session.seq !== event.seq + 1) throw new Error('reminder-native-tool-context-is-not-current')
        if (event.type === 'tool/result') {
          const { message, error } = event.data, id = String(message.toolCallId), call = take(session, id)
          if (call?.nativeSeq !== undefined && (error?.code === 'ABORTED_BEFORE_DISPATCH' || collapsedCall(event, call.name))) {
            cached.get(session)?.delete(`tool-call:${call.nativeSeq}`)
          }
          // Mid-call installation remains on the unpaired tools/result path.
          if (call && error?.code !== 'ABORTED_BEFORE_DISPATCH') {
            return remember(session, result(config, String(session.id), event, id, call,
              message.isError === true, error?.code, sessionMessageTail(session, config.maxContextMessages, String(message.id))))
          }
        } else {
          const data = event.data, id = String(data.subCallId), call = take(session, id)
          if (data.error?.code === 'ABORTED_BEFORE_DISPATCH' && call?.nativeSeq !== undefined) {
            cached.get(session)?.delete(`tool-call:${call.nativeSeq}`)
          }
          if (data.error?.code !== 'ABORTED_BEFORE_DISPATCH') {
            return remember(session, result(config, String(session.id), event, id, { name: data.name,
              arguments: data.arguments, rootCallId: String(data.rootCallId) }, data.isError,
            data.error?.code, sessionMessageTail(session, config.maxContextMessages)))
          }
        }
      }
      return undefined
    },
    /**
     * Resolve an anchored submission from its native log, including the model
     * surface immediately before that result. The detached prefix never enters
     * the live store or activates an Agent. Supplied copies of call facts do not win.
     */
    async resolve(event: EventValue, signal?: AbortSignal): Promise<EventValue> {
      if (!event.native) return event
      signal?.throwIfAborted()
      if (!history) throw new Error('reminder-native-tool-history-unavailable')
      const session = history.sessions.get(event.sessionId as Session['id'])
      const hot = session && cached.get(session)?.get(cacheKey(event))
      if (hot) return structuredClone(hot)
      if (event.native.type === 'session-event') {
        return remember(session, { event: await resolveNativeSessionEvent(event, history, signal) }).event
      }
      const log = await history.readSession(event.sessionId as Session['id'])
      using lease = { [Symbol.dispose]: () => log[Symbol.dispose]?.() }
      signal?.throwIfAborted()
      if (event.native.type === 'assistant-output') {
        const native = log.at ? log.at(event.native.seq) : log.events[event.native.seq]
        const inherited = log.inheritedEventCount ?? session?.inheritedEventCount
        if (!native || native.seq !== event.native.seq || inherited === undefined || native.seq < inherited
          || (native.type !== 'assistant/message' && native.type !== 'assistant/attempt')) throw new Error('reminder-native-output-not-found')
        const view = session && session.seq >= native.seq + 1 ? session : outputHistory(event.sessionId, log.events)
        for (const sample of outputSamples(view, native)) if (sample.event.callId === event.callId) {
          return remember(session, sample).event
        }
        throw new Error('reminder-native-output-sample-not-found')
      }
      if (event.native.type === 'tool-call') {
        const native = log.at ? log.at(event.native.seq) : log.events[event.native.seq]
        const inherited = log.inheritedEventCount ?? session?.inheritedEventCount
        if (!native || native.seq !== event.native.seq || inherited === undefined || native.seq < inherited) {
          throw new Error('reminder-native-tool-call-not-found')
        }
        const canonical = beforeCall(event.sessionId, native)
        if (unobservedBeforeCalls(log.range ? log.range(event.native.seq) : log.events.slice(event.native.seq)).has(canonical.callId)) throw new Error('reminder-native-tool-call-not-dispatched')
        return remember(session, { event: canonical }).event
      }
      const terminal = log.events[event.native.seq]
      if (!terminal || terminal.seq !== event.native.seq
        || (terminal.type !== 'tool/result' && terminal.type !== 'tool/ptc-dispatch')) {
        throw new Error('reminder-native-tool-result-not-found')
      }
      if (terminal.data.error?.code === 'ABORTED_BEFORE_DISPATCH') throw new Error('reminder-native-tool-result-not-dispatched')
      const prefix = await historicalPrefix(log.events, signal ?? new AbortController().signal)(terminal)
      return remember(session, fromLog(event.sessionId, event.native.seq, log.events, prefix)).event
    },
    /** Discover selected local native facts in their original order from one log read. */
    async recover(sessionId: string, accept: (event: EventValue) => Promise<void>, signal: AbortSignal,
      selection: NativeRecoverySelection = { tools: true, beforeTools: false, outputs: false, sessionEvents: [] }): Promise<void> {
      signal.throwIfAborted()
      if (!history) throw new Error('reminder-native-tool-history-unavailable')
      const session = history.sessions.get(sessionId as Session['id'])
      const names = new Set(selection.sessionEvents)
      const signature = JSON.stringify([selection.tools, selection.beforeTools, [...names].sort(), selection.sessionAliases ?? []])
      const observed = session && fullyObserved.get(session)
      // The tool observer is unconditional. Raw Session events are submitted only
      // while selected rules exist, so an initially empty Session cannot certify
      // a later event-name or alias registration. Its first scan owns that selection.
      const commonObserved = (observed === '*' && names.size === 0) || observed === signature
      const outputCursor = session && outputThrough.get(session)
      if (commonObserved && (!selection.outputs || (session && outputCursor !== undefined && outputCursor >= session.seq))) return
      let fullEvents: readonly SessionEvent[] | undefined
      let log: Awaited<ReturnType<NativeHistory['readSession']>> | undefined
      using lease = { [Symbol.dispose]: () => log?.[Symbol.dispose]?.() }
      let events: Iterable<SessionEvent>, through: number, inherited: number | undefined
      if (session && commonObserved) {
        // Tool/raw events already have their live observer. Only new committed
        // output needs reconciliation; do not clone or reread the old corpus.
        const live = session
        through = live.seq; inherited = live.inheritedEventCount
        const start = outputCursor ?? live.firstLiveSeq
        events = { *[Symbol.iterator]() {
          for (let cursor = start; cursor < through; cursor++) {
            const event = live.eventAt(cursor as SessionEvent['seq'])
            if (!event) throw new Error('reminder-native-output-event-missing')
            yield event
          }
        } }
      } else {
        log = await history.readSession(sessionId as Session['id'])
        signal.throwIfAborted()
        fullEvents = log.events; events = fullEvents; through = fullEvents.length
        inherited = log.inheritedEventCount ?? session?.inheritedEventCount
      }
      if (inherited === undefined) throw new Error('reminder-native-tool-inheritance-unavailable')
      const outputStart = outputCursor ?? inherited
      const skipped = selection.beforeTools && fullEvents ? unobservedBeforeCalls(fullEvents) : new Set<string>()
      let outputView: Pick<Session, 'id' | 'seq' | 'eventAt'> | undefined = session
      const prefix = !commonObserved && fullEvents && selection.tools ? historicalPrefix(fullEvents, signal) : undefined
      for (const terminal of events) {
        // Admission can be costlier than projection; yield between bounded groups
        // even when no tool context needs to advance (before/raw/output selections).
        if (terminal.seq % 128 === 0) await yieldToHost()
        signal.throwIfAborted()
        // A child inherits readable history, not its parent's local triggers.
        if (terminal.seq < inherited) continue
        const afterCommit: Submission[] = []
        if (selection.outputs && terminal.seq >= outputStart && (terminal.type === 'assistant/message' || terminal.type === 'assistant/attempt')) {
          if (!outputView || outputView.seq < terminal.seq + 1) {
            if (!fullEvents) throw new Error('reminder-native-output-history-unavailable')
            outputView = outputHistory(sessionId, fullEvents)
          }
          for (const sample of outputSamples(outputView, terminal)) {
            if (sample.afterCommit) afterCommit.push(sample)
            else await accept(remember(session, sample).event)
          }
        }
        // A committed pre-execution reminder may be reconstructed, but a historical
        // denial must never be re-executed as if this tool were about to run again.
        if (!commonObserved && selection.beforeTools && (terminal.type === 'tool/call' || terminal.type === 'tool/ptc-dispatch-start')) {
          // The committed call event is published before tools/pre-execute runs.
          if (names.has(terminal.type)) await accept(remember(session, { event: nativeSessionEvent(sessionId, terminal) }).event)
          const before = beforeCall(sessionId, terminal)
          if (!skipped.has(before.callId)) await accept(remember(session, { event: before }).event)
        }
        // Match live publication order: tool outcome first, then its raw Session event.
        if (!commonObserved && fullEvents && selection.tools && (terminal.type === 'tool/result' || terminal.type === 'tool/ptc-dispatch')
          && terminal.data.error?.code !== 'ABORTED_BEFORE_DISPATCH') {
          await accept(remember(session, fromLog(sessionId, terminal.seq, fullEvents, await prefix?.(terminal))).event)
        }
        if (!commonObserved && names.has(terminal.type) && !(selection.beforeTools
          && (terminal.type === 'tool/call' || terminal.type === 'tool/ptc-dispatch-start'))) {
          await accept(remember(session, { event: nativeSessionEvent(sessionId, terminal) }).event)
        }
        for (const sample of afterCommit) await accept(remember(session, sample).event)
      }
      signal.throwIfAborted()
      // Only this exact live instance can prove that every later result will be
      // observed. A dormant log may grow elsewhere, and a reloaded Session is a
      // new object. Neither may be skipped just because its id was scanned once.
      if (selection.outputs && session && history.sessions.get(session.id) === session) outputThrough.set(session, through)
      if (session && fullEvents && history.sessions.get(session.id) === session && session.seq === through) {
        const pending = new Map<string, Call>()
        for (const event of fullEvents) {
          if (event.seq < inherited) continue
          if (event.type === 'tool/call') pending.set(String(event.data.callId), { nativeSeq: event.seq, name: event.data.name,
            arguments: argumentsOf(event.data.arguments), rootCallId: String(event.data.callId) })
          else if (event.type === 'tool/ptc-dispatch-start') pending.set(String(event.data.subCallId), {
            nativeSeq: event.seq, name: event.data.name, arguments: event.data.arguments, rootCallId: String(event.data.rootCallId) })
          else if (event.type === 'tool/result') pending.delete(String(event.data.message.toolCallId))
          else if (event.type === 'tool/ptc-dispatch') pending.delete(String(event.data.subCallId))
        }
        // Calls already pending when the plugin attached must still pair with a
        // future live result; otherwise the completed scan would hide that result.
        calls.set(session, pending)
        fullyObserved.set(session, signature)
      }
    },
    /** Release process-local pairing and context caches without changing any log. */
    close() { calls = new WeakMap(); cached = new WeakMap(); fullyObserved = new WeakMap(); outputThrough = new WeakMap() },
  }
}
