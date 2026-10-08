/** Historical event name is retained for imports; no custom Session event is appended. */
export const TRANSFORM_EVENT = 'context-care/transform'

/**
 * Persist rule evaluations in the Host journal, which supports replay without changing Session types.
 * @param deps declared plugin context with sessions, contextCareRequests and logger
 * @returns synchronous recorder; journal flush retains asynchronous write failures
 */
export function createTransformLog({ ctx }) {
  function record(entry) {
    const session = entry.sessionId === undefined ? undefined : ctx.sessions.get(entry.sessionId)
    if (session) {
      // Event callbacks cannot await; the journal owns serialization, ACK and retained failures.
      void ctx.contextCareRequests.recordAction(session, { ...entry, action: 'rule-evaluation', phase: 'evaluated' })
        .catch(error => ctx.logger.warn(`context-care: rule audit failed: ${String(error)}`))
    }
    ctx.logger.info(`context-care rule: layer=${entry.layer} ruleId=${entry.ruleId} outcome=${entry.outcome}`
      + (entry.detail === undefined ? '' : ` detail=${entry.detail}`))
  }
  return { record }
}
