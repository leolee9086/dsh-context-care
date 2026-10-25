import { indexRequestBlocks } from './request-block-index.js';
/**
 * One planning operation reuses immutable request inputs across output occurrences.
 * Changed requests are measured normally. Requests must not change after first read.
 * @param measure Exact existing request byte comparison.
 * @param cache Host-owned projection storage; close releases this operation's domain.
 * @returns Scoped analysis, comparison and disposal functions.
 */
export function createRequestPlanCache(measure, cache) {
    const key = cache.define('request-plan-analysis', 'Immutable request identity within one planning operation.', request => {
        const value = { hasEmptyMessages: request.messages.some(message => !message.content.length), impact: measure(request, request) };
        cache.worked(key);
        return value;
    });
    const blocksKey = cache.define('request-plan-block-index', 'Immutable block array within one planning operation; groups retain original block identities and order.', blocks => {
        cache.worked(blocksKey, blocks.length);
        return indexRequestBlocks(blocks);
    });
    const read = (request) => cache.use(request, key);
    return { read, blockIndex: (blocks) => cache.use(blocks, blocksKey), impact: (before, after) => before === after ? read(before).impact : measure(before, after),
        close: () => { cache.clear(key); cache.clear(blocksKey); } };
}
//# sourceMappingURL=request-plan-cache.js.map