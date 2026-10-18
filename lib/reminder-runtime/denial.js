/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict.
 */
export function createDenialTickets(ttlMs, now) {
    const issued = new WeakMap();
    let revoked = false;
    return {
        record(key, verdict, evaluated) {
            if (revoked)
                return;
            issued.set(key, { verdict, evaluated, expiresAt: now() + ttlMs });
        },
        decide(key, at) {
            if (revoked)
                return { kind: 'deny', reason: '提醒策略已变更，本次调用需重新评估' };
            const ticket = issued.get(key);
            // A missing or expired ticket means the evaluation never finished: deny instead of assuming allowed.
            if (!ticket)
                return { kind: 'deny', reason: '提醒策略未能在执行前完成评估' };
            if (ticket.expiresAt <= at)
                return { kind: 'deny', reason: '提醒策略评估已过期' };
            if (!ticket.evaluated)
                return { kind: 'deny', reason: '提醒策略未能完成全部规则的评估' };
            return ticket.verdict ? { kind: 'deny', reason: ticket.verdict.reason } : { kind: 'allow' };
        },
        settle(key) { issued.delete(key); },
        revoke() { revoked = true; },
    };
}
//# sourceMappingURL=denial.js.map