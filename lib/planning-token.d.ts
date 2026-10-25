/**
 * Reuse an exact policy-token comparison only while its owners report unchanged
 * mutation revisions. Stamps are cheap invalidation hints, never policy tokens:
 * a changed stamp always rechecks the original serialization so unrelated ACKs
 * and remove/re-register cycles retain the original equality semantics.
 * The callback and its predicate are scoped to one synchronous planning pass.
 */
export declare function withPlanningToken<T>(expected: string, readStamp: () => readonly unknown[], readToken: () => string, run: (current: () => boolean) => T): T;
