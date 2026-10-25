const emptyUnits = () => ({ starts: [], seen: new Set() });
const before = (starts, end) => {
    let left = 0, right = starts.length;
    while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (starts[middle] < end)
            left = middle + 1;
        else
            right = middle;
    }
    return left;
};
/**
 * Keep one append-only block index per workbench source. A positional replacement
 * must change generation. Depth counts identities before role/type filtering, as
 * the rule engine does. Noncontiguous duplicate identities retain the full prefix
 * because a suffix would change the engine's first-occurrence ordering.
 */
export function createWorkbenchWindow() {
    let through = 0, generation;
    let units = { block: emptyUnits(), message: emptyUnits(), turn: emptyUnits() };
    let previous;
    return function select(source, rules, maxSeq = Infinity, nextGeneration = 0) {
        if (generation !== nextGeneration) {
            generation = nextGeneration;
            through = 0;
            previous = undefined;
            units = { block: emptyUnits(), message: emptyUnits(), turn: emptyUnits() };
        }
        const at = (index) => {
            const block = source.at(index);
            if (!block)
                throw new Error('workbench-indexed-block-missing');
            return block;
        };
        let end = source.length;
        if (maxSeq !== Infinity) {
            let left = 0, right = end;
            while (left < right) {
                const middle = Math.floor((left + right) / 2), seq = at(middle).seq;
                if (seq === undefined)
                    throw new Error('workbench-history-sequence-missing');
                if (seq <= maxSeq)
                    left = middle + 1;
                else
                    right = middle;
            }
            end = left;
        }
        for (let index = through; index < end; index++) {
            const block = at(index);
            const keys = { block: block.id, message: block.messageId, turn: block.turnId };
            for (const unit of ['block', 'message', 'turn']) {
                const state = units[unit], key = keys[unit];
                if (key === undefined) {
                    state.missingAt ??= index;
                    continue;
                }
                if (state.last === key)
                    continue;
                if (state.seen.has(key))
                    state.repeatedAt ??= index;
                else {
                    state.starts.push(index);
                    state.seen.add(key);
                }
                state.last = key;
            }
        }
        through = Math.max(through, end);
        let from = end;
        for (const rule of rules) {
            const depth = rule.select.depth;
            if (!depth) {
                from = 0;
                break;
            }
            const state = units[depth.unit];
            if (state.missingAt !== undefined && state.missingAt < end)
                throw new Error(`rules-v2: ${depth.unit} identity unavailable`);
            if (state.repeatedAt !== undefined && state.repeatedAt < end) {
                from = 0;
                break;
            }
            const count = before(state.starts, end);
            from = Math.min(from, state.starts[Math.max(0, count - depth.limit)] ?? end);
        }
        // Display responses retain every block of the requested message, even when a
        // rule's block-depth window only inspects its last nested child.
        if (end) {
            const seq = at(end - 1).seq;
            let left = 0, right = end;
            while (left < right) {
                const middle = Math.floor((left + right) / 2);
                if (at(middle).seq === seq)
                    right = middle;
                else
                    left = middle + 1;
            }
            from = Math.min(from, left);
        }
        if (previous?.from === from && previous.end === end)
            return previous.values;
        const values = source.slice(from, end);
        previous = { from, end, values };
        return values;
    };
}
//# sourceMappingURL=workbench-window.js.map