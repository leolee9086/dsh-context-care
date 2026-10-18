export interface DenialVerdict {
    ruleId: string;
    sourceId: string;
    reason: string;
}
export interface DenialTickets {
    /**
     * Record one pre-execution round. `evaluated: false` means the round was cut short,
     * which must deny: an unfinished policy check is not permission.
     */
    record(key: object, verdict: DenialVerdict | undefined, evaluated: boolean): void;
    /** Final synchronous decision for a dispatch; never calls back into asynchronous policy. */
    decide(key: object, at: number): {
        kind: 'allow';
    } | {
        kind: 'deny';
        reason: string;
    };
    /** Drop a settled call so the registry does not retain finished executions. */
    settle(key: object): void;
    /** Invalidate every uncommitted ticket after a policy change or unload. */
    revoke(): void;
}
/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict.
 */
export declare function createDenialTickets(ttlMs: number, now: () => number): DenialTickets;
