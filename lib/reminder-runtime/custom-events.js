import { createCustomEvents as createEvents } from '@leolee9086/dsh-rule-engine';
import { SESSION_EVENT_TYPES, SESSION_EVENT_PAYLOAD_SHAPES } from './generated/session-events.js';
export function createCustomEvents(requireNative) {
    return createEvents(requireNative, { names: new Set(SESSION_EVENT_TYPES), shapes: new Map(Object.entries(SESSION_EVENT_PAYLOAD_SHAPES)) });
}
//# sourceMappingURL=custom-events.js.map