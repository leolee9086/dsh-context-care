import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { type EventValue } from './state.js';
import type { NativeHistory } from './tool-events.js';
/** Only the actual accepted event determines source, causation, payload and time. */
export declare function nativeSessionEvent(sessionId: string, event: SessionEvent): EventValue;
/** An anchored caller cannot override any part of a committed Session event. */
export declare function resolveNativeSessionEvent(event: EventValue, history: NativeHistory, signal?: AbortSignal): Promise<EventValue>;
