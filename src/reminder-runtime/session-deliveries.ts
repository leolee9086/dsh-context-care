import { readSnoozeResult, createDeliveryRuntime } from '@leolee9086/dsh-rule-engine'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'

import type { DeliveryLog, DeliveryObservation } from '@leolee9086/dsh-rule-engine'
import { ensureSessionLog, type SessionLogRead } from '../session-log.js'
import { SNOOZE_TOOL } from './snooze.js'

/** Native events are converted without copying their message bodies or replaying a Session. */
function fact(event: SessionEvent): DeliveryObservation<UserMessage> {
  switch (event.type) {
    case 'agent/inbox/spliced': case 'user/message': case 'step/start': case 'step/end':
    case 'turn/start': case 'turn/end': case 'tool/call': case 'tool/result': case 'tool/ptc-dispatch': return event
    default: return { type: 'other', seq: event.seq }
  }
}
function nativeLog(log: SessionLogRead): DeliveryLog<UserMessage> {
  return { owner: log.owner, length: log.length, inheritedEventCount: log.inheritedEventCount,
    [Symbol.dispose]: () => log[Symbol.dispose](),
    *select(types, fromSeq, toSeqExclusive) {
      for (const event of log.select(types, fromSeq, toSeqExclusive)) {
        const value = fact(event)
        if (value.type !== 'other') yield value
      }
    },
  }
}
type DeliveryRuntime = ReturnType<typeof createDeliveryRuntime<Session, UserMessage>>
// Only the native event parameter differs; keep every other method's public library contract.
type SessionDeliveries = Omit<DeliveryRuntime, 'observe'> & {
  observe(session: Session, event: SessionEvent): void
}
/** The Host owns exact Session identities, immutable cuts, cache generations and native inbox access. */
export function createSessionDeliveries(ctx: Context, now: () => number = Date.now): SessionDeliveries {
  const history = ensureSessionLog(ctx)
  const runtime = createDeliveryRuntime<Session, UserMessage>({ cache: history.cache, now,
    snoozeTool: SNOOZE_TOOL, readSnooze: readSnoozeResult,
    getSession: id => ctx.sessions.get(id as SessionId),
    read: async id => nativeLog(await history.read(id as SessionId)),
    live: session => nativeLog(history.live(session)),
    inbox(id) {
      const agent = ctx.get('agents')?.get(id as SessionId)
      return [...(agent?.inbox.nextTurn ?? []), ...(agent?.inbox.nextStep ?? [])]
    },
  })
  return { ...runtime, observe: (session: Session, event: SessionEvent) => runtime.observe(session, fact(event)) }
}
export type DeliveryState = Awaited<ReturnType<ReturnType<typeof createSessionDeliveries>['read']>>
