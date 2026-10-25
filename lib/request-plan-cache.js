/**
 * One planning owner reuses immutable request inputs across output occurrences.
 * Changed requests are measured normally; only same-object measurements and the
 * empty-message check are cached. Do not mutate an input after its first read.
 * @param measure Exact existing request byte comparison.
 * @returns Scoped analysis and comparison functions.
 */
export function createRequestPlanCache(measure) {
    const analyses = new WeakMap();
    const read = (request) => {
        let value = analyses.get(request);
        if (!value) {
            value = { hasEmptyMessages: request.messages.some(message => !message.content.length), impact: measure(request, request) };
            analyses.set(request, value);
        }
        return value;
    };
    return { read, impact: (before, after) => before === after ? read(before).impact : measure(before, after) };
}
//# sourceMappingURL=request-plan-cache.js.map