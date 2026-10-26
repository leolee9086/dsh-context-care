import type { SessionCache, CacheKey } from './session-cache.js'
import { indexRequestBlocks, type RequestBlock } from './request-block-index.js'
import { createRequestModelProjection } from './request-model-projection.js'
import { publicRequestBytes } from './request-impact-bytes.js'
import { indexRequestActions, type RequestActionDependency, type RequestActionStages } from './request-action-order.js'

interface Payload { messages: readonly { content: readonly unknown[] }[] }
interface Analysis<T> { hasEmptyMessages: boolean; impact: T }

/**
 * One planning operation reuses immutable request inputs across output occurrences.
 * Each complete public payload is serialized once; comparisons still inspect full bytes.
 * Requests must not change after first measurement and cannot outlive this operation.
 * @param measure Exact existing request byte comparison.
 * @param cache Host-owned projection storage; close releases this operation's domain.
 * @returns Scoped analysis, comparison and disposal functions.
 */
export function createRequestPlanCache<R extends Payload, I, B = unknown>(measure: (before: R, after: R, bytes?: (request: R) => Buffer) => I, cache: SessionCache,
  project?: (message: R['messages'][number]) => readonly B[]) {
  let closed = false
  const active = () => { if (closed) throw new Error('request-plan-cache-closed') }
  const modelProjection = project && createRequestModelProjection(cache, project)
  // Candidates are measured only after their last write. A cascade or budget
  // retry clones before editing, so each identity is an immutable byte cut for
  // this operation. Retain full bytes, not a size-only estimate or a truncation.
  const bytesKey = cache.define<R, Buffer>('request-plan-bytes',
    'Complete public request JSON bytes; immutable candidates within one planning operation.', request => {
      const bytes = publicRequestBytes(request); cache.worked(bytesKey); return bytes
    })
  const readBytes = (request: R): Buffer => { active(); return cache.use(request, bytesKey) }
  const key: CacheKey<R, Analysis<I>> = cache.define('request-plan-analysis',
    'Immutable request identity within one planning operation.', request => {
      const value = { hasEmptyMessages: request.messages.some(message => !message.content.length), impact: measure(request, request, readBytes) }
      cache.worked(key)
      return value
    })
  const blocksKey = cache.define<readonly RequestBlock[], ReturnType<typeof indexRequestBlocks>>('request-plan-block-index',
    'Immutable block array within one planning operation; groups retain original block identities and order.', blocks => {
      cache.worked(blocksKey, blocks.length)
      return indexRequestBlocks(blocks)
    })
  const actionsKey = cache.define<readonly RequestActionDependency[], RequestActionStages<RequestActionDependency>>('request-plan-actions',
    'Stable dependency structure of one immutable rule action array within this operation; never evidence outcomes.', actions => {
      const value = indexRequestActions(actions); cache.worked(actionsKey, actions.length); return value
    })
  const actionIndex = <A extends RequestActionDependency>(actions: readonly A[]): RequestActionStages<A> => {
    active()
    // This namespace preserves the exact action objects owned by this array.
    return cache.use(actions, actionsKey) as RequestActionStages<A>
  }
  const read = (request: R): Analysis<I> => { active(); return cache.use(request, key) }
  return { read, modelProjection, actionIndex, blockIndex: (blocks: readonly RequestBlock[]) => { active(); return cache.use(blocks, blocksKey) }, impact: (before: R, after: R): I => { active(); return before === after ? read(before).impact : measure(before, after, readBytes) },
    close: () => { if (!closed) { closed = true; cache.clear(key); cache.clear(blocksKey); cache.clear(bytesKey); cache.clear(actionsKey); modelProjection?.close() } } }
}
