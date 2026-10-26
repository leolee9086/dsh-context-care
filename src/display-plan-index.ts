import type { SessionCache } from './session-cache.js'
import { indexFirstRules } from './request-rule-index.js'
import { indexRequestActions, type RequestActionDependency, type RequestActionStages } from './request-action-order.js'

export interface DisplayBlockIdentity { id: string; view: string; path: string }
export interface RuleIdentity { sourceId: string; id: string }

/** One committed-message cut. Both old find/findIndex calls select the first
 * display id; duplicate ids remain distinct rows in filtering and output. */
export function indexDisplayBlocks<B extends DisplayBlockIdentity>(blocks: readonly B[]) {
  const baseline = blocks.filter(block => block.view === 'display'), first = new Map<string, number>(), ids = new Map<string, number[]>()
  baseline.forEach((block, index) => {
    if (!first.has(block.id)) first.set(block.id, index)
    let group = ids.get(block.id)
    if (!group) { group = []; ids.set(block.id, group) }
    group.push(index)
  })
  let descendants: Map<string, number[]> | undefined
  const filterGroups = new Map<B, readonly B[]>()
  return { baseline,
    first(id: string): B | undefined { const at = first.get(id); return at === undefined ? undefined : baseline[at] },
    position(id: string): number { return first.get(id) ?? -1 },
    /** Preserve the original path-only prefix rule, even for duplicate ids or
     * synthetic results. Do not add a message boundary that the old predicate
     * did not have. Build path membership only if a filter actually needs it. */
    filterGroup(block: B): readonly B[] {
      if (block.path === '$result') return baseline
      const cached = filterGroups.get(block)
      if (cached) return cached
      if (!descendants) {
        descendants = new Map()
        baseline.forEach((candidate, index) => {
          let end = candidate.path.indexOf('.')
          while (end >= 0) {
            const prefix = candidate.path.slice(0, end)
            let group = descendants!.get(prefix)
            if (!group) { group = []; descendants!.set(prefix, group) }
            group.push(index); end = candidate.path.indexOf('.', end + 1)
          }
        })
      }
      const same = ids.get(block.id) ?? [], nested = descendants.get(block.path) ?? [], group: B[] = []
      // Both lists are baseline ordered. Merge their union without sorting,
      // retaining separate duplicate rows but never adding one row twice.
      let left = 0, right = 0
      while (left < same.length || right < nested.length) {
        const a = same[left] ?? Infinity, b = nested[right] ?? Infinity, index = Math.min(a, b)
        group.push(baseline[index]); if (a === index) left++; if (b === index) right++
      }
      filterGroups.set(block, group)
      return group
    },
  }
}

export interface DisplayInsertion<B> { at: number; priority: number; block: B }

/** The original descending sort followed by splice reverses each same-anchor
 * group, including comparator ties. Traverse that exact sort backwards and
 * merge baseline rows once instead of shifting the growing output per insert. */
export function mergeDisplayInsertions<B extends { id: string }>(baseline: readonly B[], insertions: readonly DisplayInsertion<B>[]): B[] {
  const sorted = [...insertions].sort((a, b) => b.at - a.at || a.priority - b.priority || b.block.id.localeCompare(a.block.id))
  const output: B[] = []
  let next = sorted.length - 1
  for (let at = 0; at <= baseline.length; at++) {
    while (next >= 0 && sorted[next].at === at) output.push(sorted[next--].block)
    if (at < baseline.length) output.push(baseline[at])
  }
  return output
}

/** A Host operation owns these namespaces. No decisions, outcomes, rendered
 * text or cross-await policy is cached; disposal drops all input owners. */
export function createDisplayPlanCache(cache: SessionCache) {
  let closed = false
  const active = () => { if (closed) throw new Error('display-plan-cache-closed') }
  const blocksKey = cache.define<readonly DisplayBlockIdentity[], ReturnType<typeof indexDisplayBlocks>>('display-plan-blocks',
    'Immutable display block cut within one synchronous planning operation.', blocks => {
      const value = indexDisplayBlocks(blocks); cache.worked(blocksKey, blocks.length); return value
    })
  const rulesKey = cache.define<readonly RuleIdentity[], ReadonlyMap<string, RuleIdentity>>('display-plan-rules',
    'First exact rule identity in this display operation, never rule decisions.', rules => {
      const value = indexFirstRules(rules); cache.worked(rulesKey, rules.length); return value
    })
  const actionsKey = cache.define<readonly RequestActionDependency[], RequestActionStages<RequestActionDependency>>('display-plan-actions',
    'Immutable action structure within this display operation; each evidence owns outcomes.', actions => {
      const value = indexRequestActions([...new Set(actions.filter(action => action.stage === 'display.render'))]); cache.worked(actionsKey, actions.length); return value
    })
  return {
    blocks<B extends DisplayBlockIdentity>(blocks: readonly B[]) { active(); return cache.use(blocks, blocksKey) as ReturnType<typeof indexDisplayBlocks<B>> },
    rules<R extends RuleIdentity>(rules: readonly R[]) { active(); return cache.use(rules, rulesKey) as ReadonlyMap<string, R> },
    actions<A extends RequestActionDependency>(actions: readonly A[]) { active(); return cache.use(actions, actionsKey) as RequestActionStages<A> },
    close() { if (!closed) { closed = true; cache.clear(blocksKey); cache.clear(rulesKey); cache.clear(actionsKey) } },
  }
}
