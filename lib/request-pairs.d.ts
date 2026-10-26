import type { SessionCache } from './session-cache.js';
/** Top-level provider messages only: nested tool-shaped data is not a call. */
export interface RequestPairPayload {
    readonly messages: readonly {
        readonly role?: unknown;
        readonly toolCallId?: unknown;
        readonly content: readonly unknown[];
    }[];
}
export interface RequestPairs {
    readonly calls: ReadonlySet<unknown>;
    readonly results: ReadonlySet<unknown>;
}
type PairMessage = RequestPairPayload['messages'][number];
interface MessagePairs {
    readonly calls: readonly unknown[];
    readonly tool: boolean;
    readonly result: unknown;
    readonly cloneSafe: boolean;
}
/** Preserve Set identity (including missing ids), duplicates and original order.
 * Requests enter the operation cache only after their final cleanup/write.
 * No event, policy, pair decision or second business ledger is retained here. */
export declare function indexRequestPairs(request: RequestPairPayload, read?: (message: PairMessage) => MessagePairs): RequestPairs;
/** Host-owned metadata only, with the planner's exact clone/write notifications.
 * No request contents, decisions or cross-operation mutable identities escape. */
export declare function createRequestPairProjection(cache: SessionCache): {
    read: (request: RequestPairPayload) => RequestPairs;
    cloned(before: readonly PairMessage[], after: readonly PairMessage[]): void;
    changed(message: PairMessage): void;
    close(): void;
};
export {};
