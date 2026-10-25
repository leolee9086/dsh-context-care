import type { SessionCache, CacheKey } from './session-cache.js'
import { indexRequestBlocks, type RequestBlock } from './request-block-index.js'

interface Payload { messages: readonly { content: readonly unknown[] }[] }
interface Analysis<T> { hasEmptyMessages: boolean; impact: T }

/**
 * One planning operation reuses immutable request inputs across output occurrences.
 * Changed requests are measured normally. Requests must not change after first read.
 * @param measure Exact existing request byte comparison.
 * @param cache Host-owned projection storage; close releases this operation's domain.
 * @returns Scoped analysis, comparison and disposal functions.
 */
export function createRequestPlanCache<R extends Payload, I>(measure: (before: R, after: R) => I, cache: SessionCache) {
  const key: CacheKey<R, Analysis<I>> = cache.define('request-plan-analysis',
    'Immutable request identity within one planning operation.', request => {
      const value = { hasEmptyMessages: request.messages.some(message => !message.content.length), impact: measure(request, request) }
      cache.worked(key)
      return value
    })
  const blocksKey = cache.define<readonly RequestBlock[], ReturnType<typeof indexRequestBlocks>>('request-plan-block-index',
    'Immutable block array within one planning operation; groups retain original block identities and order.', blocks => {
      cache.worked(blocksKey, blocks.length)
      return indexRequestBlocks(blocks)
    })
  const read = (request: R): Analysis<I> => cache.use(request, key)
  return { read, blockIndex: (blocks: readonly RequestBlock[]) => cache.use(blocks, blocksKey), impact: (before: R, after: R): I => before === after ? read(before).impact : measure(before, after),
    close: () => { cache.clear(key); cache.clear(blocksKey) } }
}
