/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict.
 */
export function createDenialTickets(ttlMs, now) {
    const issued = new WeakMap();
    let generation = 0;
    let disposed = false;
    return {
        record(key, verdict, evaluated, issuedUnder) {
            if (disposed)
                return;
            issued.set(key, { verdict, evaluated, expiresAt: now() + ttlMs, generation: issuedUnder });
        },
        decide(key, at) {
            // A closed service has no policy left to consult, so nothing can be authorized.
            if (disposed)
                return { kind: 'deny', reason: '提醒策略服务已停止，本次调用未执行' };
            const ticket = issued.get(key);
            // A missing ticket means the evaluation never finished: deny instead of assuming allowed.
            if (!ticket)
                return { kind: 'deny', reason: '提醒策略未能在执行前完成评估' };
            // The rule set changed after this round read it, so the verdict is no longer that policy's.
            if (ticket.generation !== generation)
                return { kind: 'deny', reason: '提醒策略已变更，本次调用需重新评估' };
            if (ticket.expiresAt <= at)
                return { kind: 'deny', reason: '提醒策略评估已过期' };
            if (!ticket.evaluated)
                return { kind: 'deny', reason: '提醒策略未能完成全部规则的评估' };
            return ticket.verdict ? { kind: 'deny', reason: ticket.verdict.reason } : { kind: 'allow' };
        },
        settle(key) { issued.delete(key); },
        invalidate() { generation += 1; },
        current() { return generation; },
        dispose() { disposed = true; },
    };
}
//# sourceMappingURL=denial.js.map