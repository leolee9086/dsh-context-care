export interface RequestActionDependency { id: string; stage: string; dependsOn: readonly string[] }
export interface RequestActionOrder<A> { readonly order: readonly A[]; readonly cycle: boolean }
export type RequestActionStages<A> = ReadonlyMap<string, RequestActionOrder<A>>

/** The old scheduler selects the earliest pending action whose first matching
 * dependency is no longer pending. A min-index ready heap preserves that exact
 * order, not a layer-at-a-time topological order. Outcomes stay per evidence.
 * A cycle is data here: the planner must execute the same available prefix
 * before throwing, so an earlier decision/render failure still wins. */
function stageOrder<A extends RequestActionDependency>(input: readonly A[]): RequestActionOrder<A> {
  const actions = [...new Set(input)], first = new Map<string, number>()
  actions.forEach((action, index) => { if (!first.has(action.id)) first.set(action.id, index) })
  const waiting = actions.map(() => 0), children = actions.map(() => [] as number[])
  actions.forEach((action, index) => {
    const parents = new Set<number>()
    for (const id of action.dependsOn) { const parent = first.get(id); if (parent !== undefined) parents.add(parent) }
    waiting[index] = parents.size
    for (const parent of parents) children[parent].push(index)
  })
  const ready: number[] = []
  const push = (index: number) => {
    let at = ready.length; ready.push(index)
    while (at > 0) { const parent = (at - 1) >> 1; if (ready[parent] <= index) break; ready[at] = ready[parent]; at = parent }
    ready[at] = index
  }
  const pop = (): number => {
    const first = ready[0], last = ready.pop()!
    if (ready.length) {
      let at = 0
      while (at * 2 + 1 < ready.length) {
        let child = at * 2 + 1
        if (child + 1 < ready.length && ready[child + 1] < ready[child]) child++
        if (ready[child] >= last) break
        ready[at] = ready[child]; at = child
      }
      ready[at] = last
    }
    return first
  }
  waiting.forEach((count, index) => { if (!count) push(index) })
  const order: A[] = []
  while (ready.length) {
    const index = pop(); order.push(actions[index])
    for (const child of children[index]) if (--waiting[child] === 0) push(child)
  }
  return Object.freeze({ order: Object.freeze(order), cycle: order.length !== actions.length })
}

/** Immutable action-array projection. Stage filtering, first-id resolution and
 * structural readiness are shared; no event, decision or outcome is retained. */
export function indexRequestActions<A extends RequestActionDependency>(actions: readonly A[]): RequestActionStages<A> {
  const stages = new Map<string, A[]>()
  for (const action of actions) {
    let group = stages.get(action.stage)
    if (!group) { group = []; stages.set(action.stage, group) }
    group.push(action)
  }
  return new Map([...stages].map(([stage, group]) => [stage, stageOrder(group)]))
}
