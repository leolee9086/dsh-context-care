import { type ReminderMatch, type TextSampleValue } from './conditions.js';
/** 匹配结果可能带判定器补的事实，这里的形状就是回传给父线程的那份。 */
type Matched = ReminderMatch & {
    facts?: Record<string, unknown>;
};
/** 一条规则的结果。失败也是结果：它带着自己的理由回去，不会把整批拖成没有答案。 */
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
/** Worker entry for reminder JSON. Native regex and plugin judges share the worker's cancellation budget. */
export declare function executeReminderMatch(raw: unknown): Promise<ReminderMatch & {
    facts?: Record<string, unknown>;
}>;
/**
 * 一批规则在一次往返里算完。
 * 检查点放在规则边界上：单条规则内部没法安全打断（判定器是别人的代码），
 * 但规则之间停得下来，已经算完的结果照常带回去——这比整批掐死强得多。
 */
export declare function executeReminderBatch(raw: unknown, onItem?: (item: BatchItem) => void): Promise<BatchResult>;
export type { ReminderMatch, TextSampleValue };
