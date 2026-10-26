import type { SessionCache } from './session-cache.js';
import { type RequestActionDependency, type RequestActionStages } from './request-action-order.js';
export interface DisplayBlockIdentity {
    id: string;
    view: string;
    path: string;
}
export interface RuleIdentity {
    sourceId: string;
    id: string;
}
/** One committed-message cut. Both old find/findIndex calls select the first
 * display id; duplicate ids remain distinct rows in filtering and output. */
export declare function indexDisplayBlocks<B extends DisplayBlockIdentity>(blocks: readonly B[]): {
    baseline: B[];
    first(id: string): B | undefined;
    position(id: string): number;
    /** Preserve the original path-only prefix rule, even for duplicate ids or
     * synthetic results. Do not add a message boundary that the old predicate
     * did not have. Build path membership only if a filter actually needs it. */
    filterGroup(block: B): readonly B[];
};
export interface DisplayInsertion<B> {
    at: number;
    priority: number;
    block: B;
}
/** The original descending sort followed by splice reverses each same-anchor
 * group, including comparator ties. Traverse that exact sort backwards and
 * merge baseline rows once instead of shifting the growing output per insert. */
export declare function mergeDisplayInsertions<B extends {
    id: string;
}>(baseline: readonly B[], insertions: readonly DisplayInsertion<B>[]): B[];
/** A Host operation owns these namespaces. No decisions, outcomes, rendered
 * text or cross-await policy is cached; disposal drops all input owners. */
export declare function createDisplayPlanCache(cache: SessionCache): {
    blocks<B extends DisplayBlockIdentity>(blocks: readonly B[]): ReturnType<typeof indexDisplayBlocks<B>>;
    rules<R extends RuleIdentity>(rules: readonly R[]): ReadonlyMap<string, R>;
    actions<A extends RequestActionDependency>(actions: readonly A[]): RequestActionStages<A>;
    close(): void;
};
