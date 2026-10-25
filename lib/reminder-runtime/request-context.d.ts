import type { z } from 'zod';
import type { ReminderRule } from './schema.js';
type Rule = z.infer<typeof ReminderRule>;
export interface MessageView {
    id?: string;
    role: string;
    content?: readonly {
        type: string;
        text?: string;
    }[];
    source?: {
        kind?: string;
        reminder?: {
            key: string;
            handoff?: {
                queued?: true;
            };
        };
    };
}
export interface HistoryEvent {
    type: string;
    seq: number;
    time: number;
    data: unknown;
}
/** A lazy log view: callers need not copy the whole session to inspect its recent tail. */
export interface HistoryView {
    readonly length: number;
    at(index: number): HistoryEvent | undefined;
}
export interface EligibilityEvent {
    type?: Rule['on'];
    name?: string;
    error?: {
        code?: string;
    };
    output?: {
        type: 'text' | 'reasoning';
    };
    clock?: {
        at: number;
    };
    humanActivity?: {
        at: number;
        evidence: string;
    } | null;
}
/** Local calendar windows use civil dates, including across midnight and DST changes. */
export declare function localWindow(spec: {
    start: string;
    end: string;
} | undefined, timestamp: number | undefined): {
    id: string;
    start: number;
    end: number;
} | undefined;
/**
 * Presence is recent input, not a session-global inventory of human message IDs.
 * Walk backwards only inside the interested rules' time window. A user/message
 * is a surface commit and can happen much later than input; it never refreshes presence.
 */
export declare function humanActivity(events: HistoryView, now: number, withinMs: number): {
    at: number;
    evidence: string;
} | null;
export declare function requestContext(visible: readonly MessageView[], config: {
    maxContextChars: number;
    maxContextMessages: number;
}): {
    messages: {
        role: string;
        text: string;
        truncated: boolean;
    }[];
    truncated: boolean;
};
/** Built-in facts are evaluated before optional worker analysis and cannot be overwritten by it. */
export declare function requestEligible(rule: Rule, event: EligibilityEvent): boolean;
export {};
