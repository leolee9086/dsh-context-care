const primitive = (value) => value === null || (typeof value !== 'object' && typeof value !== 'function');
function messagePairs(message) {
    const calls = [];
    // Like the original filter/map, ignore sparse holes but not explicit invalid values.
    message.content.forEach(value => {
        const block = value;
        if (block.type === 'tool-call')
            calls.push(block.id);
    });
    const tool = message.role === 'tool', result = tool ? message.toolCallId : undefined;
    return Object.freeze({ calls: Object.freeze(calls), tool, result, cloneSafe: calls.every(primitive) && primitive(result) });
}
/** Preserve Set identity (including missing ids), duplicates and original order.
 * Requests enter the operation cache only after their final cleanup/write.
 * No event, policy, pair decision or second business ledger is retained here. */
export function indexRequestPairs(request, read = messagePairs) {
    const calls = new Set(), results = new Set();
    request.messages.forEach(message => {
        const pairs = read(message);
        for (const id of pairs.calls)
            calls.add(id);
        if (pairs.tool)
            results.add(pairs.result);
    });
    return Object.freeze({ calls, results });
}
/** Host-owned metadata only, with the planner's exact clone/write notifications.
 * No request contents, decisions or cross-operation mutable identities escape. */
export function createRequestPairProjection(cache) {
    const owner = {};
    let closed = false;
    const active = () => { if (closed)
        throw new Error('request-pair-projection-closed'); };
    const key = cache.define('request-plan-pair-messages', 'Pair metadata per immutable message and exact clone lineage within one operation.', () => new WeakMap());
    const entryFor = (message) => {
        const messages = cache.use(owner, key);
        let entry = messages.get(message);
        if (!entry) {
            entry = { message };
            messages.set(message, entry);
        }
        return entry;
    };
    const resolve = (entry) => {
        if (entry.pairs)
            return entry.pairs;
        const inherited = entry.parent && resolve(entry.parent);
        if (inherited?.cloneSafe)
            return (entry.pairs = inherited);
        const pairs = messagePairs(entry.message);
        cache.worked(key);
        entry.pairs = pairs;
        return pairs;
    };
    const readMessage = (message) => {
        active();
        return resolve(entryFor(message));
    };
    return {
        read: (request) => { active(); return indexRequestPairs(request, readMessage); },
        cloned(before, after) {
            active();
            if (before.length !== after.length)
                throw new Error('request-pair-clone-length-mismatch');
            const messages = cache.use(owner, key);
            before.forEach((message, index) => {
                // Link only: an earlier render/budget error must not start pair parsing.
                // Resolution borrows only primitive keys. structuredClone changes object
                // IDs, which must be indexed from the actual clone instead.
                messages.set(after[index], { message: after[index], parent: entryFor(message) });
            });
        },
        changed(message) { active(); cache.use(owner, key).delete(message); },
        close() { if (!closed) {
            closed = true;
            cache.clear(key);
        } },
    };
}
//# sourceMappingURL=request-pairs.js.map