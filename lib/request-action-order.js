/** The old scheduler selects the earliest pending action whose first matching
 * dependency is no longer pending. A min-index ready heap preserves that exact
 * order, not a layer-at-a-time topological order. Outcomes stay per evidence.
 * A cycle is data here: the planner must execute the same available prefix
 * before throwing, so an earlier decision/render failure still wins. */
function stageOrder(input) {
    const actions = [...new Set(input)], first = new Map();
    actions.forEach((action, index) => { if (!first.has(action.id))
        first.set(action.id, index); });
    const waiting = actions.map(() => 0), children = actions.map(() => []);
    actions.forEach((action, index) => {
        const parents = new Set();
        for (const id of action.dependsOn) {
            const parent = first.get(id);
            if (parent !== undefined)
                parents.add(parent);
        }
        waiting[index] = parents.size;
        for (const parent of parents)
            children[parent].push(index);
    });
    const ready = [];
    const push = (index) => {
        let at = ready.length;
        ready.push(index);
        while (at > 0) {
            const parent = (at - 1) >> 1;
            if (ready[parent] <= index)
                break;
            ready[at] = ready[parent];
            at = parent;
        }
        ready[at] = index;
    };
    const pop = () => {
        const first = ready[0], last = ready.pop();
        if (ready.length) {
            let at = 0;
            while (at * 2 + 1 < ready.length) {
                let child = at * 2 + 1;
                if (child + 1 < ready.length && ready[child + 1] < ready[child])
                    child++;
                if (ready[child] >= last)
                    break;
                ready[at] = ready[child];
                at = child;
            }
            ready[at] = last;
        }
        return first;
    };
    waiting.forEach((count, index) => { if (!count)
        push(index); });
    const order = [];
    while (ready.length) {
        const index = pop();
        order.push(actions[index]);
        for (const child of children[index])
            if (--waiting[child] === 0)
                push(child);
    }
    return Object.freeze({ order: Object.freeze(order), cycle: order.length !== actions.length });
}
/** Immutable action-array projection. Stage filtering, first-id resolution and
 * structural readiness are shared; no event, decision or outcome is retained. */
export function indexRequestActions(actions) {
    const stages = new Map();
    for (const action of actions) {
        let group = stages.get(action.stage);
        if (!group) {
            group = [];
            stages.set(action.stage, group);
        }
        group.push(action);
    }
    return new Map([...stages].map(([stage, group]) => [stage, stageOrder(group)]));
}
//# sourceMappingURL=request-action-order.js.map