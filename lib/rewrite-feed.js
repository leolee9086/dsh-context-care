import { createDiagnosticRecordFeed } from './diagnostic-pages.js';
import { z } from 'zod';
const Rewrite = z.object({ hash: z.string().min(1), sessionId: z.string() }).catchall(z.json());
/** Internal token, not a JSON record or an independent cache registry.
 * The owning Session entry holds it; subscribers keep only their active reader. */
class RewriteView {
    feed;
    build;
    rows;
    constructor(feed, build) {
        this.feed = feed;
        this.build = build;
    }
    snapshot() { return this.rows ??= this.build(); }
}
export function rewriteCut(value) {
    return value instanceof RewriteView ? value : undefined;
}
export function rewriteSnapshot(value) {
    const cut = rewriteCut(value);
    if (!cut)
        throw new Error('context-care: rewrite projection unavailable');
    return cut.snapshot();
}
/** Reproducible views live in the unified Host cache, never in another journal.
 * The legacy index has no revision/invalidation contract, so it is still read.
 * Its unchanged rows are compared once here, not serialized by every subscriber. */
export function createRewriteProjection(logs) {
    const key = logs.cache.define('rewrite-view', 'Native Session owner; local append cursor, exact bounded maintenance rows and actual legacy index results.', () => ({ through: 0, local: new Map(), durable: new Map(), legacy: new Map(), selected: new Map(),
        feed: createDiagnosticRecordFeed((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0)) }));
    const rowsKey = logs.cache.define('rewrite-wire', 'Native Session owner; weak immutable identities and only the current external response wire revisions.', () => ({ immutable: new WeakMap(), external: new Map() }));
    const normalize = (wire) => {
        const value = Rewrite.parse(JSON.parse(wire));
        logs.cache.worked(rowsKey);
        return { value, signature: JSON.stringify(value), wire };
    };
    const time = (row) => Number(row.value.at ?? 0);
    return {
        read(owner, sessionId, local, durable, legacy) {
            const state = logs.cache.use(owner, key), dirty = new Set(), wires = logs.cache.use(owner, rowsKey);
            const candidate = (value) => {
                let row = wires.immutable.get(value);
                if (!row) {
                    const wire = JSON.stringify(value);
                    // Host maintenance diagnostics copy the accepted local value. Reuse
                    // the same wire fact across those identities, not just within each copy.
                    const hash = 'hash' in value && typeof value.hash === 'string' ? value.hash : undefined;
                    const prior = hash === undefined ? undefined : [state.durable.get(hash), state.local.get(hash), state.selected.get(hash)]
                        .find(candidate => candidate?.wire === wire);
                    row = prior ?? normalize(wire);
                    wires.immutable.set(value, row);
                }
                return row;
            };
            try {
                const latest = (rows, previous, external = false) => {
                    const next = new Map(), externalWires = new Map();
                    for (const value of rows) {
                        let row;
                        if (external) {
                            // The optional provider returns fresh, mutable JSON rows without a
                            // revision contract. Compare actual bytes; do not trust its object identity.
                            const wire = JSON.stringify(value);
                            row = externalWires.get(wire) ?? wires.external.get(wire) ?? normalize(wire);
                            externalWires.set(wire, row);
                        }
                        else
                            row = candidate(value);
                        if (row.value.sessionId !== sessionId)
                            continue;
                        const old = next.get(row.value.hash);
                        if (!old || time(row) > time(old))
                            next.set(row.value.hash, row);
                    }
                    if (external)
                        wires.external = externalWires;
                    for (const [hash, row] of previous)
                        if (row.signature !== next.get(hash)?.signature)
                            dirty.add(hash);
                    for (const [hash, row] of next)
                        if (row.signature !== previous.get(hash)?.signature)
                            dirty.add(hash);
                    return next;
                };
                state.durable = latest(durable, state.durable);
                state.legacy = latest(legacy, state.legacy, true);
                for (; state.through < local.length; state.through++) {
                    const row = candidate(local[state.through].value);
                    if (row.value.sessionId !== sessionId)
                        continue;
                    const old = state.local.get(row.value.hash);
                    if (!old || time(row) > time(old)) {
                        state.local.set(row.value.hash, row);
                        dirty.add(row.value.hash);
                    }
                }
                for (const hash of dirty) {
                    // Preserve old precedence: durable, then index, then local; only newer wins.
                    let selected;
                    for (const source of [state.durable, state.legacy, state.local]) {
                        const row = source.get(hash);
                        if (row && (!selected || time(row) > time(selected)))
                            selected = row;
                    }
                    const previous = state.selected.get(hash);
                    if (previous?.signature === selected?.signature)
                        continue;
                    if (selected) {
                        state.selected.set(hash, selected);
                        state.feed.set(hash, selected.value);
                    }
                    else {
                        state.selected.delete(hash);
                        state.feed.delete(hash);
                    }
                    state.cut = undefined;
                    logs.cache.worked(key);
                }
                if (!state.cut) {
                    state.cut = new RewriteView(state.feed, () => {
                        // Full HTTP lists explicitly request every row. Preserve the original
                        // durable/index/local first-seen tie order without scanning on deltas.
                        const ordered = new Map();
                        for (const source of [state.durable, state.legacy, state.local])
                            for (const hash of source.keys()) {
                                const row = state.selected.get(hash);
                                if (row && !ordered.has(hash))
                                    ordered.set(hash, row.value);
                            }
                        return [...ordered.values()].sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0));
                    });
                }
                return state.cut;
            }
            catch (error) {
                // Never let an advanced local cursor hide changes after a partial failure.
                logs.cache.invalidate(owner, key);
                throw error;
            }
        },
        close() { logs.cache.clear(key); logs.cache.clear(rowsKey); },
    };
}
//# sourceMappingURL=rewrite-feed.js.map