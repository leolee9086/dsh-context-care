import type { SessionCache } from './session-cache.js';
import { type RequestBlock } from './request-block-index.js';
import { type RequestPairs } from './request-pairs.js';
import { type RequestActionDependency, type RequestActionStages } from './request-action-order.js';
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
 * Each complete public payload is serialized once; comparisons still inspect full bytes.
 * Requests must not change after first measurement and cannot outlive this operation.
 * @param measure Exact existing request byte comparison.
 * @param cache Host-owned projection storage; close releases this operation's domain.
 * @returns Scoped analysis, comparison and disposal functions.
 */
export declare function createRequestPlanCache<R extends Payload, I, B = unknown>(measure: (before: R, after: R, bytes?: (request: R) => Buffer) => I, cache: SessionCache, project?: (message: R['messages'][number]) => readonly B[]): {
    read: (request: R) => Analysis<I>;
    modelProjection: {
        read(message: R["messages"][number]): readonly B[];
        system(text: string, message: R["messages"][number]): readonly B[];
        cloned(before: readonly R["messages"][number][], after: readonly R["messages"][number][]): void;
        changed(message: R["messages"][number]): void;
        close(): void;
    } | undefined;
    actionIndex: <A extends RequestActionDependency>(actions: readonly A[]) => RequestActionStages<A>;
    pairIndex: (request: R) => RequestPairs;
    cloned: (before: R["messages"], after: R["messages"]) => void;
    changed: (message: R["messages"][number]) => void;
    blockIndex: (blocks: readonly RequestBlock[]) => {
        model: RequestBlock[];
        byId: Map<string, RequestBlock>;
        byCall: Map<string, RequestBlock[]>;
        firstModel(id: string): RequestBlock | undefined;
    };
    impact: (before: R, after: R) => I;
    close: () => void;
};
export {};
