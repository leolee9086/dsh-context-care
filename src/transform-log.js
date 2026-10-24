/** Historical event name is retained for imports; no custom Session event is appended. */
export const TRANSFORM_EVENT = 'context-care/transform'

/**
 * Runtime diagnostics belong in the logger. A committed notice already carries its
 * exact evaluation in source.contextCareTrace inside the Session log; writing a
 * second action_<uuid>.json for every rule evaluation adds no authoritative fact.
 * @param deps declared plugin context with logger
 * @returns synchronous diagnostic recorder with no storage dependency
 */
export function createTransformLog({ ctx }) {
  function record(entry) {
    ctx.logger.info(`context-care rule: layer=${entry.layer} ruleId=${entry.ruleId} outcome=${entry.outcome}`
      + (entry.detail === undefined ? '' : ` detail=${entry.detail}`))
  }
  return { record }
}
