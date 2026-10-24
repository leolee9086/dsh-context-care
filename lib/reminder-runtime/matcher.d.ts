import { type ReminderMatch, type TextSampleValue } from './conditions.js';
import type { ExecutionCheckpoint } from '../matcher/progress.js';
type Matched = ReminderMatch & {
    facts?: Record<string, unknown>;
};
export type BatchItem = {
    key: string;
    ms: number;
    match: Matched;
} | {
    key: string;
    ms: number;
    error: {
        name: string;
        message: string;
    };
};
export interface BatchResult {
    items: BatchItem[];
    stopped: boolean;
    elapsedMs: number;
}
export declare function executeReminderMatch(raw: unknown): Promise<ReminderMatch & {
    facts?: Record<string, unknown>;
}>;
/**
 * Preserve the original ordered evaluation, including judge params and exclusive
 * groups, while sharing one event snapshot. A checkpoint surrounds each rule;
 * a stopped worker never implies that its unstarted neighbours timed out.
 */
export declare function executeReminderBatch(raw: unknown, onItem?: (item: BatchItem) => void, checkpoint?: ExecutionCheckpoint, defaultTimeoutMs?: number): Promise<BatchResult>;
export type { ReminderMatch, TextSampleValue };
