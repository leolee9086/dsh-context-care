export interface DenialVerdict {
  ruleId: string
  sourceId: string
  reason: string
}

interface Ticket {
  verdict: DenialVerdict | undefined
  evaluated: boolean
  expiresAt: number
  /** Policy generation the round was evaluated under. */
  generation: number
}

export interface DenialTickets {
  /**
   * Record one pre-execution round. `evaluated: false` means the round was cut short,
   * which must deny: an unfinished policy check is not permission.
   */
  record(key: object, verdict: DenialVerdict | undefined, evaluated: boolean, generation: number): void
  /** Final synchronous decision for a dispatch; never calls back into asynchronous policy. */
  decide(key: object, at: number): { kind: 'allow' } | { kind: 'deny'; reason: string }
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
  /** Record this call's verdict once; a later settlement is ignored. */
  settle(verdict: DenialVerdict | undefined, evaluated: boolean): void
  /** Fail closed for a preparation that ended without a verdict of its own. */
  settleUnfinished(): void
}

/**
 * One call's denial ticket: the only writer of that execution's verdict. It captures
 * the policy generation when the call opens, so a round that began under an earlier
 * rule set cannot record its answer as if the current policy produced it.
 */
export function openPreExecution(key: object, tickets: DenialTickets): PreExecution {
  const generation = tickets.current()
  let settled = false
  const settle = (verdict: DenialVerdict | undefined, evaluated: boolean) => {
    if (settled) return
    settled = true
    tickets.record(key, verdict, evaluated, generation)
  }
  return { settle, settleUnfinished: () => settle(undefined, false) }
}

/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict.
 */
export function createDenialTickets(ttlMs: number, now: () => number): DenialTickets {
  const issued = new WeakMap<object, Ticket>()
  let generation = 0
  let disposed = false
  return {
    record(key, verdict, evaluated, issuedUnder) {
      if (disposed) return
      issued.set(key, { verdict, evaluated, expiresAt: now() + ttlMs, generation: issuedUnder })
    },
    decide(key, at) {
      // A closed service has no policy left to consult, so nothing can be authorized.
      if (disposed) return { kind: 'deny', reason: '提醒策略服务已停止，本次调用未执行' }
      const ticket = issued.get(key)
      // A missing ticket means the evaluation never finished: deny instead of assuming allowed.
      if (!ticket) return { kind: 'deny', reason: '提醒策略未能在执行前完成评估' }
      // The rule set changed after this round read it, so the verdict is no longer that policy's.
      if (ticket.generation !== generation) return { kind: 'deny', reason: '提醒策略已变更，本次调用需重新评估' }
      if (ticket.expiresAt <= at) return { kind: 'deny', reason: '提醒策略评估已过期' }
      if (!ticket.evaluated) return { kind: 'deny', reason: '提醒策略未能完成全部规则的评估' }
      return ticket.verdict ? { kind: 'deny', reason: ticket.verdict.reason } : { kind: 'allow' }
    },
    settle(key) { issued.delete(key) },
    invalidate() { generation += 1 },
    current() { return generation },
    dispose() { disposed = true },
  }
}
