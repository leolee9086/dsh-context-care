export interface MatcherDiagnostic {
    operationId: string;
    stage: string;
    phase: 'admission' | 'startup' | 'processing';
    rules: {
        sourceId: string;
        ruleId: string;
        revision: unknown;
    }[];
    inputBytes: number;
    blockCount: number;
    elapsedMs: number;
    startupMs: number;
    queueMs: number;
    roundTripMs: number | null;
    processingElapsedMs: number | null;
    timeoutMs: number;
    activeOperations: number;
}
/** Checkpoint identifies the rule actually executing, never an inferred retry candidate. */
export interface InterruptedRule {
    index: number;
    elapsedMs: number;
    completedMs: number;
    roundLimited: boolean;
}
export declare class MatcherFailure extends Error {
    readonly diagnostic: MatcherDiagnostic;
    readonly checkpoint?: InterruptedRule | undefined;
    readonly code = "CONTEXT_CARE_MATCH_FAILED";
    constructor(message: string, diagnostic: MatcherDiagnostic, cause?: unknown, checkpoint?: InterruptedRule | undefined);
}
export interface MatcherTiming {
    onDispatch?: () => void;
    workTimeoutMs?: number;
    onItem?: (item: unknown) => void;
    /** Actual worker execution, excluding startup, queue residence and response transport. */
    onTiming?: (timing: {
        processingMs: number;
    }) => void;
}
export interface MatcherOptions {
    timeoutMs?: number;
    startupMs?: number;
    maxBytes?: number;
    maxPending?: number;
    maxIdle?: number;
}
/**
 * The Host owns the queue. Each worker receives only its current task, so stopping
 * that thread cannot execute, cancel or consume another task's allowance.
 */
export declare function createBoundedMatcher({ timeoutMs, startupMs, maxBytes, maxPending, maxIdle }?: MatcherOptions): {
    detect: (raw: unknown, signal?: AbortSignal, timing?: MatcherTiming) => Promise<unknown>;
    warmup: (signal?: AbortSignal) => Promise<void>;
    close: () => Promise<void>;
    getStats(): {
        active: number;
        idle: number;
        preparing: number;
        threads: number;
        workersStarted: number;
        completed: number;
        failed: number;
        closed: boolean;
    };
};
