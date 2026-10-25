import type { SessionCache } from './session-cache.js';
import { type RequestBlock } from './request-block-index.js';
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
export declare function createRequestPlanCache<R extends Payload, I, B = unknown>(measure: (before: R, after: R) => I, cache: SessionCache, project?: (message: R['messages'][number]) => readonly B[]): {
    read: (request: R) => Analysis<I>;
    modelProjection: {
        read(message: R["messages"][number]): readonly B[];
        system(text: string, message: R["messages"][number]): readonly B[];
        cloned(before: readonly R["messages"][number][], after: readonly R["messages"][number][]): void;
        changed(message: R["messages"][number]): void;
        close(): void;
    } | undefined;
    blockIndex: (blocks: readonly RequestBlock[]) => {
        model: RequestBlock[];
        byId: Map<string, RequestBlock>;
        byCall: Map<string, RequestBlock[]>;
    };
    impact: (before: R, after: R) => I;
    close: () => void;
};
export {};
