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
        };
    };
}
export interface HistoryEvent {
    type: string;
    seq: number;
    time: number;
    data: unknown;
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
/** Read the earliest durable arrival for each human message, not its later surface commit.
 * Inherited fork events and producer-owned synthetic inputs do not establish local presence. */
export declare function humanActivity(events: HistoryEvent[]): {
    at: number;
    evidence: string;
} | null;
export declare function requestContext(visible: MessageView[], config: {
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
