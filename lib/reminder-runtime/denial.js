/** 每个原因对应一句给人看的拒绝说明：说清发生了什么，而不是让人去猜。 */
const UNFINISHED_REASON = {
    capacity: '提醒策略评估队列已满，本次调用未执行',
    'input-budget': '提醒事件超出体积上限，本次调用未执行',
    'parse-failed': '提醒事件格式无效，本次调用未执行',
    'duplicate-call': '同一调用已有一次未完成的评估，本次调用未执行',
    identity: '提醒策略无法确认会话归属，本次调用未执行',
    'round-timeout': '提醒策略评估超出时间预算，本次调用未执行',
    cancelled: '调用已被取消，提醒策略未完成评估',
    closed: '提醒策略服务已停止，本次调用未执行',
    'matcher-startup': '提醒匹配线程未能启动，本次调用未执行',
    'rule-timeout': '提醒规则评估超时，本次调用未执行',
    'rule-failed': '提醒规则评估失败，本次调用未执行',
    unclassified: '提醒策略未能完成全部规则的评估',
};
/**
 * 从一条失败的文本里读出它属于哪一类。
 *
 * 启动失败和规则跑得慢在用户那里是两件事：一个是装坏了，一个是规则写得太重。
 * 都归进「评估超时」会把排查方向带偏，所以这里单独分出来。
 */
export function codeForFailure(message) {
    if (/matcher-startup-timeout|matcher-worker-startup-failed|matcher-worker-exited|matcher-closed/.test(message))
        return 'matcher-startup';
    if (/reminder-round-timeout/.test(message))
        return 'round-timeout';
    if (/timeout/.test(message))
        return 'rule-timeout';
    return 'rule-failed';
}
/** 从串到主控制器的中止原因里读回它属于哪一类，让中转站不丢失语义。 */
export function codeForReason(reason) {
    if (!(reason instanceof Error))
        return 'cancelled';
    if (/reminder-round-timeout/.test(reason.message))
        return 'round-timeout';
    if (/reminder-rule-timeout|timeout/.test(reason.message))
        return 'rule-timeout';
    if (/reminder-runtime-closed/.test(reason.message))
        return 'closed';
    return 'cancelled';
}
/**
 * One call's denial ticket: the only writer of that execution's verdict. It captures
 * the policy generation when the call opens, so a round that began under an earlier
 * rule set cannot record its answer as if the current policy produced it.
 */
export function openPreExecution(key, tickets) {
    const generation = tickets.current();
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    let settled = false;
    const settle = (verdict, evaluated, code) => {
        if (settled)
            return;
        settled = true;
        tickets.record(key, verdict, evaluated, generation, evaluated ? undefined : code ?? 'unclassified');
        finish();
    };
    return { done, settle, settleUnfinished: (code) => settle(undefined, false, code) };
}
/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict. Elapsed time after a
 * completed evaluation does not change that result: later hooks or approval may
 * legitimately delay the guard. Settlement and policy generation retire tickets.
 */
export function createDenialTickets() {
    const issued = new WeakMap();
    let generation = 0;
    let disposed = false;
    return {
        record(key, verdict, evaluated, issuedUnder, code) {
            if (disposed)
                return;
            issued.set(key, { verdict, evaluated, code: code ?? 'unclassified', generation: issuedUnder });
        },
        decide(key) {
            // A closed service has no policy left to consult, so nothing can be authorized.
            if (disposed)
                return { kind: 'deny', reason: UNFINISHED_REASON.closed };
            const ticket = issued.get(key);
            // A missing ticket means the evaluation never finished: deny instead of assuming allowed.
            if (!ticket)
                return { kind: 'deny', reason: '提醒策略未能在执行前完成评估' };
            // The rule set changed after this round read it, so the verdict is no longer that policy's.
            if (ticket.generation !== generation)
                return { kind: 'deny', reason: '提醒策略已变更，本次调用需重新评估' };
            // 未完成时报告具体是哪一步：规则超时和队列已满都该拒绝，但原因不该长得一样。
            if (!ticket.evaluated)
                return { kind: 'deny', reason: UNFINISHED_REASON[ticket.code] };
            return ticket.verdict ? { kind: 'deny', reason: ticket.verdict.reason } : { kind: 'allow' };
        },
        settle(key) { issued.delete(key); },
        invalidate() { generation += 1; },
        current() { return generation; },
        dispose() { disposed = true; },
    };
}
//# sourceMappingURL=denial.js.map