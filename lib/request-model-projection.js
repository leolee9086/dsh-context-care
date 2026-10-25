/** Freeze only owned projection data, never the request or native message itself. */
function freezeProjection(value, seen = new WeakSet()) {
    if (value && typeof value === 'object' && !Object.isFrozen(value) && !seen.has(value)) {
        seen.add(value);
        for (const child of Object.values(value))
            freezeProjection(child, seen);
        Object.freeze(value);
    }
}
/** One planning operation borrows immutable bodies; envelope ids and positions stay per view. */
export function createRequestModelProjection(cache, project) {
    const owner = {};
    let closed = false;
    const active = () => { if (closed)
        throw new Error('request-model-projection-closed'); };
    const key = cache.define('request-model-projection', 'Planning lifetime; immutable message identities, exact clone lineage and explicitly invalidated writes.', () => ({ messages: new WeakMap() }));
    const build = (message) => {
        const blocks = project(message);
        freezeProjection(blocks);
        cache.worked(key);
        return blocks;
    };
    return {
        read(message) {
            active();
            const state = cache.use(owner, key);
            let blocks = state.messages.get(message);
            if (!blocks) {
                blocks = build(message);
                state.messages.set(message, blocks);
            }
            return blocks;
        },
        system(text, message) {
            active();
            const state = cache.use(owner, key);
            if (state.system?.text !== text)
                state.system = { text, blocks: build(message) };
            return state.system.blocks;
        },
        /** The planner has just cloned all messages but has not edited any payload yet. */
        cloned(before, after) {
            active();
            if (before.length !== after.length)
                throw new Error('request-projection-clone-length-mismatch');
            const state = cache.use(owner, key);
            for (let index = 0; index < before.length; index++) {
                const blocks = state.messages.get(before[index]);
                if (blocks)
                    state.messages.set(after[index], blocks);
            }
        },
        /** Detach the cloned message before its first payload edit; old cuts stay valid. */
        changed(message) {
            active();
            cache.use(owner, key).messages.delete(message);
        },
        close() { if (!closed) {
            closed = true;
            cache.clear(key);
        } },
    };
}
//# sourceMappingURL=request-model-projection.js.map