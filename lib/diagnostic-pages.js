var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
export const compareDiagnosticRecords = (left, right) => left.at - right.at || left.key.localeCompare(right.key);
export const isDiagnosticDelta = (records) => !Array.isArray(records);
const emptyDelta = { added: [], removed: [] };
/** The owning Session cache contains this feed. Consumers hold only their cursor;
 * weak readers cannot retain disposed page projections or abandoned subscriptions.
 * Coalesce pending edits by record identity instead of retaining a revision log. */
export function createDiagnosticRecordFeed(compare) {
    const values = new Map();
    const cursors = new WeakMap(), readers = new Set();
    let snapshot;
    const readSnapshot = () => snapshot ??= [...values.values()].sort(compare);
    const publish = (id, before, after) => {
        if (before === after)
            return;
        snapshot = undefined;
        for (const reference of readers) {
            const reader = reference.deref();
            if (!reader) {
                readers.delete(reference);
                continue;
            }
            const pending = reader.pending.get(id);
            const change = { before: pending ? pending.before : before, after };
            if (change.before === change.after)
                reader.pending.delete(id);
            else
                reader.pending.set(id, change);
        }
    };
    return {
        set(id, record) { const before = values.get(id); values.set(id, record); publish(id, before, record); },
        delete(id) { const before = values.get(id); if (values.delete(id))
            publish(id, before, undefined); },
        snapshot() { return readSnapshot(); },
        consume(cursor) {
            let reader = cursors.get(cursor);
            if (!reader) {
                const added = readSnapshot();
                reader = { pending: new Map() };
                cursors.set(cursor, reader);
                readers.add(new WeakRef(reader));
                return { added, removed: [] };
            }
            if (!reader.pending.size)
                return emptyDelta;
            const added = [], removed = [];
            for (const change of reader.pending.values()) {
                if (change.before !== undefined)
                    removed.push(change.before);
                if (change.after !== undefined)
                    added.push(change.after);
            }
            added.sort(compare);
            reader.pending.clear();
            return { added, removed };
        },
    };
}
/** Whole-list compatibility callers may replace arrays; production passes deltas. */
export function createDiagnosticRecordChanges() {
    let previous;
    return (records) => {
        if (isDiagnosticDelta(records))
            return records;
        if (records === previous)
            return emptyDelta;
        const before = new Set(previous), after = new Set(records);
        const delta = { added: records.filter(record => !before.has(record)), removed: (previous ?? []).filter(record => !after.has(record)), order: records };
        previous = records;
        return delta;
    };
}
/** Sorted scalar candidates. Updates inspect only changed records; array shifts
 * move references but never re-parse or re-sort the complete historical list. */
export function createDiagnosticOrder(compare) {
    const values = [];
    const position = (value) => {
        let low = 0, high = values.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (compare(values[middle], value) < 0)
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    };
    return {
        update(delta) {
            for (const record of delta.removed) {
                const at = position(record);
                if (values[at] === record)
                    values.splice(at, 1);
            }
            for (const record of delta.added)
                values.splice(position(record), 0, record);
        },
        last() { return values.at(-1); },
    };
}
/** Sorted metadata only. Binary searches avoid re-sorting unchanged entries. */
export function createDiagnosticIndex() {
    const entries = [], byId = new Map();
    const bySeq = new Map();
    // Native events arrive in increasing order. Append them without shifting an
    // entire array; reverse only the bounded page exposed as newest-first.
    const compare = (a, b) => a.order - b.order || a.id.localeCompare(b.id);
    const position = (entry) => {
        let low = 0, high = entries.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (compare(entries[middle], entry) < 0)
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    };
    const remove = (id) => {
        const previous = byId.get(id);
        if (!previous)
            return;
        entries.splice(position(previous), 1);
        byId.delete(id);
        if (previous.seq !== undefined) {
            const bucket = bySeq.get(previous.seq);
            bucket.delete(previous);
            if (!bucket.size)
                bySeq.delete(previous.seq);
        }
    };
    return {
        get size() { return entries.length; },
        get: id => byId.get(id),
        set(entry) {
            if (byId.get(entry.id) === entry)
                return;
            remove(entry.id);
            entries.splice(position(entry), 0, entry);
            byId.set(entry.id, entry);
            if (entry.seq !== undefined) {
                let bucket = bySeq.get(entry.seq);
                if (!bucket) {
                    bucket = new Set();
                    bySeq.set(entry.seq, bucket);
                }
                bucket.add(entry);
            }
        },
        delete: remove, slice: (from, to) => entries.slice(Math.max(0, entries.length - to), Math.max(0, entries.length - from)).reverse(),
        position(seq) {
            const bucket = bySeq.get(seq);
            if (!bucket)
                return undefined;
            let first;
            for (const entry of bucket)
                if (!first || compare(entry, first) > 0)
                    first = entry;
            return first ? entries.length - 1 - position(first) : undefined;
        },
    };
}
/** Keep relation buckets stable across immutable record-list revisions. */
export function createDiagnosticRelations(keys, compare) {
    const indexed = new Map(), buckets = new Map();
    let order = new Map(), deltaOrder = false;
    const views = new Map();
    return {
        update(records, rekey = false) {
            if (isDiagnosticDelta(records)) {
                deltaOrder = true;
                const changed = new Set();
                for (const record of records.removed) {
                    for (const key of indexed.get(record) ?? []) {
                        const bucket = buckets.get(key);
                        bucket.delete(record);
                        if (!bucket.size)
                            buckets.delete(key);
                        changed.add(key);
                    }
                    indexed.delete(record);
                    order.delete(record);
                }
                for (const record of records.added) {
                    const selected = [...new Set(keys(record))];
                    indexed.set(record, selected);
                    for (const key of selected) {
                        let bucket = buckets.get(key);
                        if (!bucket) {
                            bucket = new Set();
                            buckets.set(key, bucket);
                        }
                        bucket.add(record);
                        changed.add(key);
                    }
                }
                for (const key of changed)
                    views.delete(key);
                return changed;
            }
            deltaOrder = false;
            const next = new Map(records.map((record, index) => [record, index])), changed = new Set();
            for (const [record, previous] of indexed)
                if (!next.has(record) || (rekey && (() => {
                    const selected = [...new Set(keys(record))];
                    return selected.length !== previous.length || selected.some((key, index) => key !== previous[index]);
                })())) {
                    for (const key of previous) {
                        const bucket = buckets.get(key);
                        bucket.delete(record);
                        if (!bucket.size)
                            buckets.delete(key);
                        changed.add(key);
                    }
                    indexed.delete(record);
                }
            for (const record of records)
                if (!indexed.has(record)) {
                    const selected = [...new Set(keys(record))];
                    indexed.set(record, selected);
                    for (const key of selected) {
                        let bucket = buckets.get(key);
                        if (!bucket) {
                            bucket = new Set();
                            buckets.set(key, bucket);
                        }
                        ;
                        bucket.add(record);
                        changed.add(key);
                    }
                }
            // A list revision may reorder retained records. Absolute positions shift
            // after unrelated inserts; invalidate only inversions inside a bucket.
            const last = new Map();
            for (const record of records) {
                const previous = order.get(record);
                if (previous === undefined)
                    continue;
                for (const key of indexed.get(record) ?? []) {
                    if ((last.get(key) ?? -1) > previous)
                        changed.add(key);
                    last.set(key, previous);
                }
            }
            order = next;
            for (const key of changed)
                views.delete(key);
            return changed;
        },
        rekey(records) {
            const changed = new Set();
            for (const record of records) {
                const previous = indexed.get(record);
                if (!previous)
                    continue;
                const selected = [...new Set(keys(record))];
                if (selected.length === previous.length && selected.every((key, index) => key === previous[index]))
                    continue;
                for (const key of previous) {
                    const bucket = buckets.get(key);
                    bucket.delete(record);
                    if (!bucket.size)
                        buckets.delete(key);
                    changed.add(key);
                }
                indexed.set(record, selected);
                for (const key of selected) {
                    let bucket = buckets.get(key);
                    if (!bucket) {
                        bucket = new Set();
                        buckets.set(key, bucket);
                    }
                    ;
                    bucket.add(record);
                    changed.add(key);
                }
            }
            for (const key of changed)
                views.delete(key);
            return changed;
        },
        get(key) {
            let view = views.get(key);
            if (!view) {
                view = [...(buckets.get(key) ?? [])].sort(deltaOrder && compare ? compare : ((a, b) => order.get(a) - order.get(b)));
                views.set(key, view);
            }
            return view;
        },
    };
}
/** HTTP and subscriptions borrow the same owner-scoped Session projection. */
export function createDiagnosticPages(history, types, create) {
    const stateKey = { name: `diagnostic-index:${types.join(',')}`,
        validity: 'Native Session identity; relevant event cursor and immutable record-list identity.',
        create: () => ({ through: 0, update: create() }) };
    const bodyKey = { name: `diagnostic-body:${types.join(',')}`,
        validity: 'Immutable entry identity; a missing future evidence seq expires when that event exists.', create: () => ({}) };
    const page = (session, records, query) => {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const log = __addDisposableResource(env_1, history.live(session), false);
            let state = history.cache.use(session, stateKey);
            if ('consume' in records && state.records && state.records !== records) {
                history.cache.invalidate(session, stateKey);
                state = history.cache.use(session, stateKey);
            }
            const added = log.select(types, state.through);
            const input = 'consume' in records ? records.consume(state) : records;
            const changed = isDiagnosticDelta(input) ? input.added.length + input.removed.length > 0 : state.records !== records;
            if (!state.index || added.length || changed) {
                try {
                    state.index = state.update(input, added);
                }
                catch (error) {
                    // A builder may already have changed its relation buckets before failing.
                    // Rebuild from cached native facts on explicit retry, not that partial state.
                    history.cache.invalidate(session, stateKey);
                    throw error;
                }
                state.records = records;
                history.cache.worked(stateKey, added.length);
            }
            // Publish a cursor only after its index update succeeds.
            state.through = log.length;
            const { index } = state;
            const selected = query.seq === undefined ? undefined : index.entries.position(query.seq);
            const offset = selected === undefined ? query.offset : Math.floor(selected / query.limit) * query.limit;
            const items = index.entries.slice(offset, offset + query.limit).map(entry => {
                const body = history.cache.use(entry, bodyKey), cached = body.cached;
                if (cached && (cached.missing === undefined || cached.missing >= log.length))
                    return cached.value;
                let missing;
                const value = entry.materialize({ at(seq) {
                        const event = log.at(seq);
                        if (!event && seq >= log.length)
                            missing = Math.min(missing ?? seq, seq);
                        return event;
                    } });
                body.cached = { value, missing };
                history.cache.worked(bodyKey);
                return value;
            });
            return { items, admission: index.admission, total: index.entries.size, offset,
                selectedFound: query.seq === undefined ? undefined : selected !== undefined,
                nextOffset: offset + items.length < index.entries.size ? offset + items.length : null };
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    };
    return Object.assign(page, { close() { history.cache.clear(stateKey); history.cache.clear(bodyKey); } });
}
//# sourceMappingURL=diagnostic-pages.js.map