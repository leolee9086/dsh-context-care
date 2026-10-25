interface Payload { messages: readonly { content: readonly unknown[] }[] }
interface Analysis<T> { hasEmptyMessages: boolean; impact: T }

/**
 * One planning owner reuses immutable request inputs across output occurrences.
 * Changed requests are measured normally; only same-object measurements and the
 * empty-message check are cached. Do not mutate an input after its first read.
 * @param measure Exact existing request byte comparison.
 * @returns Scoped analysis and comparison functions.
 */
export function createRequestPlanCache<R extends Payload, I>(measure: (before: R, after: R) => I) {
  const analyses = new WeakMap<R, Analysis<I>>()
  const read = (request: R): Analysis<I> => {
    let value = analyses.get(request)
    if (!value) {
      value = { hasEmptyMessages: request.messages.some(message => !message.content.length), impact: measure(request, request) }
      analyses.set(request, value)
    }
    return value
  }
  return { read, impact: (before: R, after: R): I => before === after ? read(before).impact : measure(before, after) }
}
