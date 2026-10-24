export interface DenialVerdict {
  ruleId: string
  sourceId: string
  reason: string
}

/**
 * 一条规则没给出确定答案时，是哪一步失去的。
 * 每个退回路径各自具名：拒绝原因要能指出「评估没做完」发生在哪一环，
 * 否则「未完成」只是一个让人猜不透的黑箱。
 */
export type UnfinishedCode =
  /** 准入队列已满，本轮根本没进队列。 */
  | 'capacity'
  /** 事件序列化后超出体积上限。 */
  | 'input-budget'
  /** 事件载荷解析失败。 */
  | 'parse-failed'
  /** 同一 callId 已在处理，重复提交被跳过。 */
  | 'duplicate-call'
  /** 读取或重建原生触发记录失败。 */
  | 'native-event'
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
  | 'unclassified'

/** 每个原因对应一句给人看的拒绝说明：说清发生了什么，而不是让人去猜。 */
const UNFINISHED_REASON: Record<UnfinishedCode, string> = {
  capacity: '提醒策略评估队列已满，本次调用未执行',
  'input-budget': '提醒事件超出体积上限，本次调用未执行',
  'parse-failed': '提醒事件格式无效，本次调用未执行',
  'duplicate-call': '同一调用已有一次未完成的评估，本次调用未执行',
  'native-event': '提醒原生触发记录读取或重建失败，本次调用未执行',
  identity: '提醒策略无法确认会话归属，本次调用未执行',
  'round-timeout': '提醒策略评估超出时间预算，本次调用未执行',
  cancelled: '调用已被取消，提醒策略未完成评估',
  closed: '提醒策略服务已停止，本次调用未执行',
  'matcher-startup': '提醒匹配线程未能启动，本次调用未执行',
  'rule-timeout': '提醒规则评估超时，本次调用未执行',
  'rule-failed': '提醒规则评估失败，本次调用未执行',
  unclassified: '提醒策略未能完成全部规则的评估',
}

/**
 * 从一条失败的文本里读出它属于哪一类。
 *
 * 启动失败和规则跑得慢在用户那里是两件事：一个是装坏了，一个是规则写得太重。
 * 都归进「评估超时」会把排查方向带偏，所以这里单独分出来。
 */
export function codeForFailure(message: string): UnfinishedCode {
  if (/matcher-startup-timeout|matcher-worker-startup-failed|matcher-worker-exited|matcher-closed/.test(message)) return 'matcher-startup'
  if (/reminder-round-timeout/.test(message)) return 'round-timeout'
  if (/timeout/.test(message)) return 'rule-timeout'
  return 'rule-failed'
}

/** 从串到主控制器的中止原因里读回它属于哪一类，让中转站不丢失语义。 */
export function codeForReason(reason: unknown): UnfinishedCode {
  if (!(reason instanceof Error)) return 'cancelled'
  if (/reminder-round-timeout/.test(reason.message)) return 'round-timeout'
  if (/reminder-rule-timeout|timeout/.test(reason.message)) return 'rule-timeout'
  if (/reminder-runtime-closed/.test(reason.message)) return 'closed'
  return 'cancelled'
}

/** A preparation failure retains its actual phase and original exception for the tool result. */
export class ReminderPreparationError extends Error {
  constructor(readonly phase: UnfinishedCode, cause: unknown) {
    const detail = cause instanceof Error ? cause.toString()
      : cause !== null && typeof cause === 'object' && 'message' in cause ? String(cause.message) : String(cause)
    super(`${UNFINISHED_REASON[phase]} [${phase}]：${detail}`, { cause })
    this.name = 'ReminderPreparationError'
  }
}

interface Ticket {
  verdict: DenialVerdict | undefined
  evaluated: boolean
  /** 未完成时是哪一步失去的；evaluated 为真时忽略。 */
  code: UnfinishedCode
  /** Preparation exceptions remain distinct from matched rule denials. */
  failure?: ReminderPreparationError
  /** Policy generation the round was evaluated under. */
  generation: number
}

export interface DenialTickets {
  /**
   * Record one pre-execution round. `evaluated: false` means the round was cut short,
   * which must deny: an unfinished policy check is not permission. `code` names the
   * step that cut it short so the denial can say which one.
   */
  record(key: object, verdict: DenialVerdict | undefined, evaluated: boolean, generation: number,
    code?: UnfinishedCode, failure?: ReminderPreparationError): void
  /** Final synchronous decision for this execution token; valid until settlement or a relevant policy change. */
  decide(key: object): { kind: 'allow' } | { kind: 'deny'; reason: string; error?: ReminderPreparationError }
  /** Drop a settled call so the registry does not retain finished executions. */
  settle(key: object): void
  /**
   * Retire tickets issued under the previous policy, because a changed rule set can
   * change a verdict. Issuance continues: a later round records the new generation.
   * Only this generation counter moves, so a revoke can never disable the policy
   * itself; a source refresh is ordinary operation, not the end of tool use.
   */
  invalidate(): void
  /** The generation a round must capture when it starts evaluating. */
  current(): number
  /** Stop issuing and accepting tickets for good; the owning service is shutting down. */
  dispose(): void
}

export interface PreExecution {
  /** Policy completion, independent of durable reminder delivery and diagnostics. */
  readonly done: Promise<void>
  /** Record this call's verdict once; a later settlement is ignored. */
  settle(verdict: DenialVerdict | undefined, evaluated: boolean, code?: UnfinishedCode): void
  /** Fail closed for a preparation that ended without a verdict of its own. */
  settleUnfinished(code?: UnfinishedCode): void
  /** Retain the original exception when preparation fails before its verdict. */
  fail(code: UnfinishedCode, cause: unknown): void
}

/**
 * One call's denial ticket: the only writer of that execution's verdict. It captures
 * the policy generation when the call opens, so a round that began under an earlier
 * rule set cannot record its answer as if the current policy produced it.
 */
export function openPreExecution(key: object, tickets: DenialTickets): PreExecution {
  const generation = tickets.current()
  let finish!: () => void
  const done = new Promise<void>(resolve => { finish = resolve })
  let settled = false
  const settle = (verdict: DenialVerdict | undefined, evaluated: boolean, code?: UnfinishedCode, failure?: ReminderPreparationError) => {
    if (settled) return
    settled = true
    tickets.record(key, verdict, evaluated, generation, evaluated ? undefined : code ?? 'unclassified', failure)
    finish()
  }
  return { done, settle, settleUnfinished: (code?: UnfinishedCode) => settle(undefined, false, code),
    fail: (code, cause) => {
      if (!settled) settle(undefined, false, code, new ReminderPreparationError(code, cause))
    } }
}

/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict. Elapsed time after a
 * completed evaluation does not change that result: later hooks or approval may
 * legitimately delay the guard. Settlement and policy generation retire tickets.
 */
export function createDenialTickets(): DenialTickets {
  const issued = new WeakMap<object, Ticket>()
  let generation = 0
  let disposed = false
  return {
    record(key, verdict, evaluated, issuedUnder, code, failure) {
      if (disposed) return
      issued.set(key, { verdict, evaluated, code: code ?? 'unclassified', generation: issuedUnder, failure })
    },
    decide(key) {
      // A closed service has no policy left to consult, so nothing can be authorized.
      if (disposed) return { kind: 'deny', reason: UNFINISHED_REASON.closed }
      const ticket = issued.get(key)
      // A missing ticket means the evaluation never finished: deny instead of assuming allowed.
      if (!ticket) return { kind: 'deny', reason: '提醒策略未能在执行前完成评估' }
      // A concurrent policy change must not hide the exception that already stopped preparation.
      if (ticket.failure) return { kind: 'deny', reason: ticket.failure.message, error: ticket.failure }
      // The rule set changed after this round read it, so the verdict is no longer that policy's.
      if (ticket.generation !== generation) return { kind: 'deny', reason: '提醒策略已变更，本次调用需重新评估' }
      // 未完成时报告具体是哪一步：规则超时和队列已满都该拒绝，但原因不该长得一样。
      if (!ticket.evaluated) return { kind: 'deny', reason: UNFINISHED_REASON[ticket.code] }
      return ticket.verdict ? { kind: 'deny', reason: ticket.verdict.reason } : { kind: 'allow' }
    },
    settle(key) { issued.delete(key) },
    invalidate() { generation += 1 },
    current() { return generation },
    dispose() { disposed = true },
  }
}
