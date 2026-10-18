export interface DenialVerdict {
  ruleId: string
  sourceId: string
  reason: string
}

interface Ticket {
  verdict: DenialVerdict | undefined
  evaluated: boolean
  expiresAt: number
}

export interface DenialTickets {
  /**
   * Record one pre-execution round. `evaluated: false` means the round was cut short,
   * which must deny: an unfinished policy check is not permission.
   */
  record(key: object, verdict: DenialVerdict | undefined, evaluated: boolean): void
  /** Final synchronous decision for a dispatch; never calls back into asynchronous policy. */
  decide(key: object, at: number): { kind: 'allow' } | { kind: 'deny'; reason: string }
  /** Drop a settled call so the registry does not retain finished executions. */
  settle(key: object): void
  /** Invalidate every uncommitted ticket after a policy change or unload. */
  revoke(): void
}

/**
 * Correlates an asynchronous pre-execute evaluation with the later synchronous
 * guard. Tickets are keyed by the execution token, not the call id: a reused
 * call id therefore cannot inherit another call's verdict.
 */
export function createDenialTickets(ttlMs: number, now: () => number): DenialTickets {
  const issued = new WeakMap<object, Ticket>()
  let revoked = false
  return {
    record(key, verdict, evaluated) {
      if (revoked) return
      issued.set(key, { verdict, evaluated, expiresAt: now() + ttlMs })
    },
    decide(key, at) {
      if (revoked) return { kind: 'deny', reason: '提醒策略已变更，本次调用需重新评估' }
      const ticket = issued.get(key)
      // A missing or expired ticket means the evaluation never finished: deny instead of assuming allowed.
      if (!ticket) return { kind: 'deny', reason: '提醒策略未能在执行前完成评估' }
      if (ticket.expiresAt <= at) return { kind: 'deny', reason: '提醒策略评估已过期' }
      if (!ticket.evaluated) return { kind: 'deny', reason: '提醒策略未能完成全部规则的评估' }
      return ticket.verdict ? { kind: 'deny', reason: ticket.verdict.reason } : { kind: 'allow' }
    },
    settle(key) { issued.delete(key) },
    revoke() { revoked = true },
  }
}
