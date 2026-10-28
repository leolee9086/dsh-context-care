import { createEngine, deliveryMessageSource } from '@leolee9086/dsh-rule-engine'
import type { DeliveryMessage, EventRuntime, EventRuntimeOptions, RuleDeclaration } from '@leolee9086/dsh-rule-engine'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { SESSION_EVENT_TYPES, SESSION_EVENT_PAYLOAD_SHAPES } from './generated/session-events.js'

export const REMINDER_SERVICE = 'reminderRules'
export const REMINDER_MESSAGE_KIND = 'plugin:dsh-context-care:reminder'
export type ReminderSource = Omit<import('zod').input<typeof import('@leolee9086/dsh-rule-engine').EventSource>, 'rules'> & { rules: RuleDeclaration[] }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-context-care:reminder': ReturnType<typeof deliveryMessageSource>
  }
}
/** 这里只把库拥有的消息身份收窄成 DSH 的品牌类型，不更改内容、回执或投递事实。 */
function nativeMessage(message: DeliveryMessage): Omit<DeliveryMessage, 'id'> & { id: MessageId } {
  return { ...message, id: message.id as MessageId }
}
// Name the public library type so emitted declarations never reach into package internals.
type NativeMessage = ReturnType<typeof nativeMessage>
export type ReminderService = Omit<EventRuntime, 'collect' | 'queuePending'> & {
  collect(input: Parameters<EventRuntime['collect']>[0]): Promise<NativeMessage[]>
  queuePending(input: Parameters<EventRuntime['queuePending']>[0]): Promise<NativeMessage[]>
}
export function createReminderRuntime(options: EventRuntimeOptions, engine = createEngine()): ReminderService {
  const runtime = engine.events({ ...options, catalog: { names: new Set(SESSION_EVENT_TYPES), shapes: new Map(Object.entries(SESSION_EVENT_PAYLOAD_SHAPES)) } })
  return { ...runtime,
    async collect(input: Parameters<typeof runtime.collect>[0]) { return (await runtime.collect(input)).map(nativeMessage) },
    async queuePending(input: Parameters<typeof runtime.queuePending>[0]) { return (await runtime.queuePending(input)).map(nativeMessage) },
  }
}
export type ReminderSourceHandle = ReturnType<ReminderService['registerSource']>
