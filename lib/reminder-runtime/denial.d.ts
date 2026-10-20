export interface DenialVerdict {
    ruleId: string;
    sourceId: string;
    reason: string;
}
/**
 * 一条规则没给出确定答案时，是哪一步失去的。
 * 每个退回路径各自具名：拒绝原因要能指出「评估没做完」发生在哪一环，
 * 否则「未完成」只是一个让人猜不透的黑箱。
 */
export type UnfinishedCode = 
/** 准入队列已满，本轮根本没进队列。 */
'capacity'
/** 事件序列化后超出体积上限。 */
 | 'input-budget'
/** 事件载荷解析失败。 */
 | 'parse-failed'
/** 同一 callId 已在处理，重复提交被跳过。 */
 | 'duplicate-call'
/** 会话归属查询失败，无法判断规则是否适用。 */
 | 'identity'
/** 整轮超出时间预算。 */
 | 'round-timeout'
/** 调用方取消。 */
 | 'cancelled'
/** 服务已停止。 */
 | 'closed'
/** 匹配线程根本没能启动：模块加载失败、依赖缺失、线程一启动就退出。 */
 | 'matcher-startup'
/** 某条规则在自己的预算内没算完。 */
 | 'rule-timeout'
/** 某条规则评估抛错。 */
 | 'rule-failed'
/**
 * 没有更具体的原因。保留这一档，是为了让「未分类」显式存在，
 * 而不是把未知路径悄悄伪装成上面某一个。
 */
 | 'unclassified';
/**
 * 从一条失败的文本里读出它属于哪一类。
 *
 * 启动失败和规则跑得慢在用户那里是两件事：一个是装坏了，一个是规则写得太重。
 * 都归进「评估超时」会把排查方向带偏，所以这里单独分出来。
 */
export declare function codeForFailure(message: string): UnfinishedCode;
/** 从串到主控制器的中止原因里读回它属于哪一类，让中转站不丢失语义。 */
export declare function codeForReason(reason: unknown): UnfinishedCode;
export interface DenialTickets {
    /**
     * Record one pre-execution round. `evaluated: false` means the round was cut short,
     * which must deny: an unfinished policy check is not permission. `code` names the
     * step that cut it short so the denial can say which one.
     */
    record(key: object, verdict: DenialVerdict | undefined, evaluated: boolean, generation: number, code?: UnfinishedCode): void;
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
    settle(verdict: DenialVerdict | undefined, evaluated: boolean, code?: UnfinishedCode): void;
    /** Fail closed for a preparation that ended without a verdict of its own. */
    settleUnfinished(code?: UnfinishedCode): void;
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
