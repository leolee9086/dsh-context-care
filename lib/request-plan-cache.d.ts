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
 * One planning owner reuses immutable request inputs across output occurrences.
 * Changed requests are measured normally; only same-object measurements and the
 * empty-message check are cached. Do not mutate an input after its first read.
 * @param measure Exact existing request byte comparison.
 * @returns Scoped analysis and comparison functions.
 */
export declare function createRequestPlanCache<R extends Payload, I>(measure: (before: R, after: R) => I): {
    read: (request: R) => Analysis<I>;
    impact: (before: R, after: R) => I;
};
export {};
