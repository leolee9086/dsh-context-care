import { RuleEventInput as Event } from '@leolee9086/dsh-rule-engine'
import type { EventValue } from '@leolee9086/dsh-rule-engine'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

import type { NativeHistory } from './tool-events.js'

/** Only the actual accepted event determines source, causation, payload and time. */
export function nativeSessionEvent(sessionId: string, event: SessionEvent): EventValue {
  const data = event.data
  let origin: EventValue['origin'] = 'background'
  let causationId: string | undefined
  if (typeof data === 'object' && data !== null && 'source' in data
    && typeof data.source === 'object' && data.source !== null
    && 'kind' in data.source && data.source.kind === 'plugin:dsh-context-care:reminder') {
    origin = 'reminder'
    const trace = 'contextCareTrace' in data.source ? data.source.contextCareTrace : undefined
    if (typeof trace === 'object' && trace !== null && 'sourceId' in trace && 'ruleId' in trace
      && typeof trace.sourceId === 'string' && typeof trace.ruleId === 'string') {
      causationId = `${trace.sourceId}:${trace.ruleId}`
    }
  } else if (event.type === 'user/message') origin = 'human'
  else if (event.type.startsWith('tool/')) origin = 'tool'
  const callId = `${event.type}#${event.seq}`
  return Event.parse({ type: 'session.event', sessionId, name: event.type, arguments: data, callId, rootCallId: callId,
    origin, ...(causationId === undefined ? {} : { causationId }), clock: { at: event.time }, facts: {},
    native: { type: 'session-event', seq: event.seq } })
}

/** An anchored caller cannot override any part of a committed Session event. */
export async function resolveNativeSessionEvent(event: EventValue, history: NativeHistory, signal?: AbortSignal): Promise<EventValue> {
  if (event.native?.type !== 'session-event') return event
  signal?.throwIfAborted()
  const log = await history.readSession(event.sessionId as Session['id'], signal)
  using lease = { [Symbol.dispose]: () => log[Symbol.dispose]?.() }
  signal?.throwIfAborted()
  const native = log.at(event.native.seq)
  const inherited = log.inheritedEventCount
  if (!native || native.seq !== event.native.seq || native.seq < inherited) {
    throw new Error('reminder-native-session-event-not-found')
  }
  return nativeSessionEvent(event.sessionId, native)
}
