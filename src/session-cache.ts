/** One Host-owned lifecycle for reconstructable Session and immutable-value caches. */
export interface CacheKey<O extends object, T> {
  readonly name: string
  /** Explain what the caller supplies as dependencies and how incremental values advance. */
  readonly validity: string
  create(owner: O, dependencies: readonly unknown[]): T
}
export interface CacheReport {
  name: string
  validity: string
  entries: number
  hits: number
  builds: number
  invalidations: number
  failures: number
  work: number
}
interface Entry { dependencies: readonly unknown[]; value: unknown }
interface Bucket { entries: Map<object, Entry>; reference: WeakRef<Bucket> }
interface Counter { name: string; validity: string; hits: number; builds: number; invalidations: number; failures: number; work: number }

/**
 * Cache only reproducible projections, never request reservations or cancellation controllers.
 * Keys are immutable definitions, not module-level storage. Owners are weakly held; explicit
 * domain clearing, native Session disposal and Host shutdown release values immediately.
 */
export function createSessionCache() {
  let owners = new WeakMap<object, Bucket>(), closed = false
  const buckets = new Set<WeakRef<Bucket>>(), counters = new Map<object, Counter>()
  // Finalization only removes diagnostic handles; correctness never relies on GC timing.
  const collected = new FinalizationRegistry<WeakRef<Bucket>>(reference => buckets.delete(reference))
  function active() { if (closed) throw new Error('context-care-cache-closed') }
  function counter<O extends object, T>(key: CacheKey<O, T>): Counter {
    let value = counters.get(key)
    if (!value) {
      value = { name: key.name, validity: key.validity, hits: 0, builds: 0, invalidations: 0, failures: 0, work: 0 }
      counters.set(key, value)
    }
    return value
  }
  function bucket(owner: object): Bucket {
    let value = owners.get(owner)
    if (!value) {
      // The weak diagnostic directory lets clear(key) release values immediately
      // without retaining either the native Session or ephemeral historical cuts.
      const entries = new Map<object, Entry>()
      const created = { entries } as Bucket
      created.reference = new WeakRef(created)
      value = created; owners.set(owner, value); buckets.add(value.reference)
      collected.register(value, value.reference, value.reference)
    }
    return value
  }
  function remove(value: Bucket, key: object) {
    if (value.entries.delete(key)) {
      const count = counters.get(key)
      if (count) count.invalidations++
    }
  }
  return {
    /** Bind one cache namespace to its Host service lifetime. */
    define<O extends object, T>(name: string, validity: string, create: (owner: O, dependencies: readonly unknown[]) => T): CacheKey<O, T> {
      active(); return { name, validity, create }
    },
    /** Read an existing projection without allocating state for an uninterested owner. */
    peek<O extends object, T>(owner: O, key: CacheKey<O, T>, dependencies: readonly unknown[] = []): T | undefined {
      active()
      const prior = owners.get(owner)?.entries.get(key)
      if (!prior || prior.dependencies.length !== dependencies.length
        || !prior.dependencies.every((dependency, index) => Object.is(dependency, dependencies[index]))) return undefined
      counter(key).hits++
      return prior.value as T
    },
    /** Same owner/key/dependencies returns the same value; throws never publish a value. */
    use<O extends object, T>(owner: O, key: CacheKey<O, T>, dependencies: readonly unknown[] = []): T {
      active()
      const value = bucket(owner), count = counter(key), prior = value.entries.get(key)
      if (prior && prior.dependencies.length === dependencies.length
        && prior.dependencies.every((dependency, index) => Object.is(dependency, dependencies[index]))) {
        count.hits++
        // The same typed key creates and retrieves this entry; callers never supply stored values.
        return prior.value as T
      }
      if (prior) remove(value, key)
      let result: T
      try { result = key.create(owner, dependencies) }
      catch (error) { count.failures++; throw error }
      value.entries.set(key, { dependencies: [...dependencies], value: result }); count.builds++
      return result
    },
    /** Discard one failed or outdated derived value without touching independent projections. */
    invalidate<O extends object, T>(owner: O, key: CacheKey<O, T>) {
      active(); const value = owners.get(owner); if (value) remove(value, key)
    },
    /** Clear a consumer domain on disposal, including owners that will not be read again. */
    clear<O extends object, T>(key: CacheKey<O, T>) {
      if (closed) return
      for (const reference of buckets) { const value = reference.deref(); if (value) remove(value, key); else buckets.delete(reference) }
      // Dynamic consumer keys may close over its options. Do not retain them after disposal.
      counters.delete(key)
    },
    /** Native lifecycle invalidation does not clear another Session with the same string id. */
    release(owner: object) {
      active()
      const value = owners.get(owner)
      if (!value) return
      for (const key of value.entries.keys()) remove(value, key)
      owners.delete(owner); buckets.delete(value.reference); collected.unregister(value.reference)
    },
    /** Count actual projection work separately from cache lookup hits. */
    worked<O extends object, T>(key: CacheKey<O, T>, amount = 1) { active(); counter(key).work += amount },
    /** Inspect cache reuse without enumerating or retaining Session objects or body contents. */
    report(): CacheReport[] {
      active()
      const entries = new Map<object, number>()
      for (const reference of buckets) {
        const value = reference.deref()
        if (!value) { buckets.delete(reference); continue }
        for (const key of value.entries.keys()) entries.set(key, (entries.get(key) ?? 0) + 1)
      }
      return [...counters].map(([key, value]) => ({ ...value, entries: entries.get(key) ?? 0 }))
    },
    /** Shutdown drops all owned values; retained facades reject later access. */
    close() {
      if (closed) return
      for (const reference of buckets) { reference.deref()?.entries.clear(); collected.unregister(reference) }
      owners = new WeakMap(); buckets.clear(); counters.clear(); closed = true
    },
  }
}
export type SessionCache = ReturnType<typeof createSessionCache>
