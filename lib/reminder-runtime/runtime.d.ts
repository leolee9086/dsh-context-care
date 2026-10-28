import { deliveryMessageSource } from '@leolee9086/dsh-rule-engine';
import type { DeliveryMessage, EventRuntime, EventRuntimeOptions, RuleDeclaration } from '@leolee9086/dsh-rule-engine';
import type { MessageId } from '@deepseek-ai/dsh-llm';
export declare const REMINDER_SERVICE = "reminderRules";
export declare const REMINDER_MESSAGE_KIND = "plugin:dsh-context-care:reminder";
export type ReminderSource = Omit<import('zod').input<typeof import('@leolee9086/dsh-rule-engine').EventSource>, 'rules'> & {
    rules: RuleDeclaration[];
};
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'plugin:dsh-context-care:reminder': ReturnType<typeof deliveryMessageSource>;
    }
}
/** 这里只把库拥有的消息身份收窄成 DSH 的品牌类型，不更改内容、回执或投递事实。 */
declare function nativeMessage(message: DeliveryMessage): Omit<DeliveryMessage, 'id'> & {
    id: MessageId;
};
type NativeMessage = ReturnType<typeof nativeMessage>;
export type ReminderService = Omit<EventRuntime, 'collect' | 'queuePending'> & {
    collect(input: Parameters<EventRuntime['collect']>[0]): Promise<NativeMessage[]>;
    queuePending(input: Parameters<EventRuntime['queuePending']>[0]): Promise<NativeMessage[]>;
};
export declare function createReminderRuntime(options: EventRuntimeOptions, engine?: import("@leolee9086/dsh-rule-engine").Engine): ReminderService;
export type ReminderSourceHandle = ReturnType<ReminderService['registerSource']>;
export {};
