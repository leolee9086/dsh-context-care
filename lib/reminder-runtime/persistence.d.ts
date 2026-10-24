/**
 * Persistence owns transactions, not a cache of snapshots to retry.
 *
 * A caller may stop waiting while a real write is still running. That does not cancel the
 * write, acknowledge its state, or permit a later transaction to overtake it. The session
 * lane survives until the write and its explicitly requested compensation have settled.
 */
export type PersistencePhase = 'queued' | 'preparing' | 'saving' | 'publishing' | 'compensating';
export interface PersistencePending {
    readonly sessionId: string;
    readonly phase: PersistencePhase;
    /** The caller received no result; the owned transaction may still have side effects. */
    readonly abandoned: boolean;
}
/** A deadline describes observation, not an outcome from the storage backend. */
export declare class PersistenceTimeoutError extends Error {
    readonly scope: 'transaction' | 'close';
    readonly sessionId: string | undefined;
    readonly outcome: 'not-started' | 'unknown';
    readonly code = "CONTEXT_CARE_PERSISTENCE_TIMEOUT";
    constructor(scope: 'transaction' | 'close', sessionId: string | undefined, outcome: 'not-started' | 'unknown');
}
/**
 * Only native rename failures that prove replacement did not occur permit immediate release.
 * In particular, a generic rejection or fsync failure is NOT a negative commit ACK: a JSON
 * backend can reject while syncing the directory after an already successful rename.
 * Wrappers with a single `cause` retain the native evidence; aggregates do not prove which
 * side effect failed, and cycles are rejected conservatively.
 */
export declare function isDefiniteStorageFailure(error: unknown): boolean;
export interface PersistenceIO<State> {
    /**
     * Write and publish another state in this SAME owned transaction, without a new deadline.
     * Await this before releasing any external reservation. Do not enqueue another transaction
     * for the same session from a compensation callback: that would wait on itself.
     */
    persist(next: State): Promise<void>;
}
export interface PersistenceTransaction<State, Value> {
    /** Runs inside the session lane, so reads see the preceding transaction's latest ACK. */
    prepare(): Promise<{
        next: State;
        value: Value;
    }>;
    /**
     * A backend rejection is not universally proof of no commit (a post-rename fsync can fail).
     * Opt in only when this particular error proves the session write was not applied.
     * Preparation failures need no classifier: the session save has not been issued yet.
     */
    isDefiniteFailure?(error: unknown): boolean;
    /** Release only this transaction's confirmed side effects after a definite failure. */
    onFailure?(error: unknown): Promise<void>;
    /**
     * The session write ACKed, but the caller already timed out without receiving its value.
     * Collection can persist a rollback here, THEN release its shared claims. Ordinary state
     * updates need no hook: their late ACK is still valid. No implicit retry happens here.
     */
    onAbandoned?(value: Value, io: PersistenceIO<State>): Promise<void>;
}
export interface PersistenceOptions<State> {
    save(sessionId: string, next: State): Promise<void>;
    /** Synchronous publication after actual ACK. It must not throw or perform more I/O. */
    publish(sessionId: string, next: State): void;
    timeoutMs(): number;
    /** Receives real transaction failures even when the original caller has stopped waiting. */
    onError?(sessionId: string, error: unknown): void;
}
export interface PersistenceOwner<State> {
    transact<Value>(sessionId: string, transaction: PersistenceTransaction<State, Value>): Promise<Value>;
    /** Drain transactions owned at invocation, including their late compensation. No deadline. */
    drain(sessionId?: string): Promise<void>;
    /** Stop accepting work; concurrent calls share a wait, later calls can await a recovered drain. */
    close(): Promise<void>;
    pending(): readonly PersistencePending[];
}
/**
 * This owner cannot abort an uncancellable backend. close() reports that limitation with a
 * timeout and retains every in-flight entry. drain() is the separate real resource barrier;
 * a caller must not treat a timed-out close as permission to destroy the underlying store.
 */
export declare function createPersistenceOwner<State>(options: PersistenceOptions<State>): PersistenceOwner<State>;
