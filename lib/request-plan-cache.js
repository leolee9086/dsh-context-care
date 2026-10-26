import { indexRequestBlocks } from './request-block-index.js';
import { createRequestModelProjection } from './request-model-projection.js';
import { publicRequestBytes } from './request-impact-bytes.js';
/**
 * One planning operation reuses immutable request inputs across output occurrences.
 * Each complete public payload is serialized once; comparisons still inspect full bytes.
 * Requests must not change after first measurement and cannot outlive this operation.
 * @param measure Exact existing request byte comparison.
 * @param cache Host-owned projection storage; close releases this operation's domain.
 * @returns Scoped analysis, comparison and disposal functions.
 */
export function createRequestPlanCache(measure, cache, project) {
    let closed = false;
    const active = () => { if (closed)
        throw new Error('request-plan-cache-closed'); };
    const modelProjection = project && createRequestModelProjection(cache, project);
    // Candidates are measured only after their last write. A cascade or budget
    // retry clones before editing, so each identity is an immutable byte cut for
    // this operation. Retain full bytes, not a size-only estimate or a truncation.
    const bytesKey = cache.define('request-plan-bytes', 'Complete public request JSON bytes; immutable candidates within one planning operation.', request => {
        const bytes = publicRequestBytes(request);
        cache.worked(bytesKey);
        return bytes;
    });
    const readBytes = (request) => { active(); return cache.use(request, bytesKey); };
    const key = cache.define('request-plan-analysis', 'Immutable request identity within one planning operation.', request => {
        const value = { hasEmptyMessages: request.messages.some(message => !message.content.length), impact: measure(request, request, readBytes) };
        cache.worked(key);
        return value;
    });
    const blocksKey = cache.define('request-plan-block-index', 'Immutable block array within one planning operation; groups retain original block identities and order.', blocks => {
        cache.worked(blocksKey, blocks.length);
        return indexRequestBlocks(blocks);
    });
    const read = (request) => { active(); return cache.use(request, key); };
    return { read, modelProjection, blockIndex: (blocks) => { active(); return cache.use(blocks, blocksKey); }, impact: (before, after) => { active(); return before === after ? read(before).impact : measure(before, after, readBytes); },
        close: () => { if (!closed) {
            closed = true;
            cache.clear(key);
            cache.clear(blocksKey);
            cache.clear(bytesKey);
            modelProjection?.close();
        } } };
}
//# sourceMappingURL=request-plan-cache.js.map