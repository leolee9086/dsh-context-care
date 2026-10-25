import type { SessionCache } from './session-cache.js';
interface Payload {
    messages: readonly {
        content: readonly unknown[];
    }[];
}
interface Analysis<T> {
    hasEmptyMessages: boolean;
    impact: T;
}
/**
 * One planning operation reuses immutable request inputs across output occurrences.
 * Changed requests are measured normally. Requests must not change after first read.
 * @param measure Exact existing request byte comparison.
 * @param cache Host-owned projection storage; close releases this operation's domain.
 * @returns Scoped analysis, comparison and disposal functions.
 */
export declare function createRequestPlanCache<R extends Payload, I>(measure: (before: R, after: R) => I, cache: SessionCache): {
    read: (request: R) => Analysis<I>;
    impact: (before: R, after: R) => I;
    close: () => void;
};
export {};
