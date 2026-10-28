import { createEngine } from '@leolee9086/dsh-rule-engine';
import { SESSION_EVENT_TYPES, SESSION_EVENT_PAYLOAD_SHAPES } from './generated/session-events.js';
export const REMINDER_SERVICE = 'reminderRules';
export const REMINDER_MESSAGE_KIND = 'plugin:dsh-context-care:reminder';
/** 这里只把库拥有的消息身份收窄成 DSH 的品牌类型，不更改内容、回执或投递事实。 */
function nativeMessage(message) {
    return { ...message, id: message.id };
}
export function createReminderRuntime(options, engine = createEngine()) {
    const runtime = engine.events({ ...options, catalog: { names: new Set(SESSION_EVENT_TYPES), shapes: new Map(Object.entries(SESSION_EVENT_PAYLOAD_SHAPES)) } });
    return { ...runtime,
        async collect(input) { return (await runtime.collect(input)).map(nativeMessage); },
        async queuePending(input) { return (await runtime.queuePending(input)).map(nativeMessage); },
    };
}
//# sourceMappingURL=runtime.js.map