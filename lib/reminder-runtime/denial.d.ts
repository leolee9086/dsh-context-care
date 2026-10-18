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
    record(key: object, verdict: DenialVerdict | undefined, evaluated: boolean, generation: number): void;
    /** Final synchronous decision for a dispatch; never calls back into asynchronous policy. */
    decide(key: object, at: number): {
        kind: 'allow';
    } | {
        kind: 'deny';
        reason: string;
    };
    /** Drop a settled call so the registry does not retain finished executions. */
    settle(key: object): void;
    /**
     * Retire tickets issued under the previous policy, because a changed rule set can
     * change a verdict. Issuance continues: a later round records the new generation.
     * Only this generation counter moves, so a revoke can never disable the policy
     * itself; a source refresh is ordinary operation, not the end of tool use.
     */
    invalidate(): void;
    /** The generation a round must capture when it starts evaluating. */
    current(): number;
    /** Stop issuing and accepting tickets for good; the owning service is shutting down. */
    dispose(): void;
}
export interface PreExecution {
    /** Record this call's verdict once; a later settlement is ignored. */
    settle(verdict: DenialVerdict | undefined, evaluated: boolean): void;
    /** Fail closed for a preparation that ended without a verdict of its own. */
    settleUnfinished(): void;
}
/**
 * One call's denial ticket: the only writer of that execution's verdict. It captures
 * the policy generation when the call opens, so a round that began under an earlier
 * rule set cannot record its answer as if the current policy produced it.
 */
export declare function openPreExecution(key: object, tickets: DenialTickets): PreExecution;
/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict.
 */
export declare function createDenialTickets(ttlMs: number, now: () => number): DenialTickets;
