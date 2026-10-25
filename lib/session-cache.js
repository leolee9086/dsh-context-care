/**
 * Cache only reproducible projections, never request reservations or cancellation controllers.
 * Keys are immutable definitions, not module-level storage. Owners are weakly held; explicit
 * domain clearing, native Session disposal and Host shutdown release values immediately.
 */
export function createSessionCache() {
    let owners = new WeakMap(), closed = false;
    const buckets = new Set(), counters = new Map();
    // Finalization only removes diagnostic handles; correctness never relies on GC timing.
    const collected = new FinalizationRegistry(reference => buckets.delete(reference));
    function active() { if (closed)
        throw new Error('context-care-cache-closed'); }
    function counter(key) {
        let value = counters.get(key);
        if (!value) {
            value = { name: key.name, validity: key.validity, hits: 0, builds: 0, invalidations: 0, failures: 0, work: 0 };
            counters.set(key, value);
        }
        return value;
    }
    function bucket(owner) {
        let value = owners.get(owner);
        if (!value) {
            // The weak diagnostic directory lets clear(key) release values immediately
            // without retaining either the native Session or ephemeral historical cuts.
            const entries = new Map();
            const created = { entries };
            created.reference = new WeakRef(created);
            value = created;
            owners.set(owner, value);
            buckets.add(value.reference);
            collected.register(value, value.reference, value.reference);
        }
        return value;
    }
    function remove(value, key) {
        if (value.entries.delete(key)) {
            const count = counters.get(key);
            if (count)
                count.invalidations++;
        }
    }
    return {
        /** Bind one cache namespace to its Host service lifetime. */
        define(name, validity, create) {
            active();
            return { name, validity, create };
        },
        /** Read an existing projection without allocating state for an uninterested owner. */
        peek(owner, key, dependencies = []) {
            active();
            const prior = owners.get(owner)?.entries.get(key);
            if (!prior || prior.dependencies.length !== dependencies.length
                || !prior.dependencies.every((dependency, index) => Object.is(dependency, dependencies[index])))
                return undefined;
            counter(key).hits++;
            return prior.value;
        },
        /** Same owner/key/dependencies returns the same value; throws never publish a value. */
        use(owner, key, dependencies = []) {
            active();
            const value = bucket(owner), count = counter(key), prior = value.entries.get(key);
            if (prior && prior.dependencies.length === dependencies.length
                && prior.dependencies.every((dependency, index) => Object.is(dependency, dependencies[index]))) {
                count.hits++;
                // The same typed key creates and retrieves this entry; callers never supply stored values.
                return prior.value;
            }
            if (prior)
                remove(value, key);
            let result;
            try {
                result = key.create(owner, dependencies);
            }
            catch (error) {
                count.failures++;
                throw error;
            }
            value.entries.set(key, { dependencies: [...dependencies], value: result });
            count.builds++;
            return result;
        },
        /** Discard one failed or outdated derived value without touching independent projections. */
        invalidate(owner, key) {
            active();
            const value = owners.get(owner);
            if (value)
                remove(value, key);
        },
        /** Clear a consumer domain on disposal, including owners that will not be read again. */
        clear(key) {
            if (closed)
                return;
            for (const reference of buckets) {
                const value = reference.deref();
                if (value)
                    remove(value, key);
                else
                    buckets.delete(reference);
            }
            // Dynamic consumer keys may close over its options. Do not retain them after disposal.
            counters.delete(key);
        },
        /** Native lifecycle invalidation does not clear another Session with the same string id. */
        release(owner) {
            active();
            const value = owners.get(owner);
            if (!value)
                return;
            for (const key of value.entries.keys())
                remove(value, key);
            owners.delete(owner);
            buckets.delete(value.reference);
            collected.unregister(value.reference);
        },
        /** Count actual projection work separately from cache lookup hits. */
        worked(key, amount = 1) { active(); counter(key).work += amount; },
        /** Inspect cache reuse without enumerating or retaining Session objects or body contents. */
        report() {
            active();
            const entries = new Map();
            for (const reference of buckets) {
                const value = reference.deref();
                if (!value) {
                    buckets.delete(reference);
                    continue;
                }
                for (const key of value.entries.keys())
                    entries.set(key, (entries.get(key) ?? 0) + 1);
            }
            return [...counters].map(([key, value]) => ({ ...value, entries: entries.get(key) ?? 0 }));
        },
        /** Shutdown drops all owned values; retained facades reject later access. */
        close() {
            if (closed)
                return;
            for (const reference of buckets) {
                reference.deref()?.entries.clear();
                collected.unregister(reference);
            }
            owners = new WeakMap();
            buckets.clear();
            counters.clear();
            closed = true;
        },
    };
}
//# sourceMappingURL=session-cache.js.map