/** One Host-owned lifecycle for reconstructable Session and immutable-value caches. */
export interface CacheKey<O extends object, T> {
    readonly name: string;
    /** Explain what the caller supplies as dependencies and how incremental values advance. */
    readonly validity: string;
    create(owner: O, dependencies: readonly unknown[]): T;
}
export interface CacheReport {
    name: string;
    validity: string;
    entries: number;
    hits: number;
    builds: number;
    invalidations: number;
    failures: number;
    work: number;
}
/**
 * Cache only reproducible projections, never request reservations or cancellation controllers.
 * Keys are immutable definitions, not module-level storage. Owners are weakly held; explicit
 * domain clearing, native Session disposal and Host shutdown release values immediately.
 */
export declare function createSessionCache(): {
    /** Bind one cache namespace to its Host service lifetime. */
    define<O extends object, T>(name: string, validity: string, create: (owner: O, dependencies: readonly unknown[]) => T): CacheKey<O, T>;
    /** Read an existing projection without allocating state for an uninterested owner. */
    peek<O extends object, T>(owner: O, key: CacheKey<O, T>, dependencies?: readonly unknown[]): T | undefined;
    /** Same owner/key/dependencies returns the same value; throws never publish a value. */
    use<O extends object, T>(owner: O, key: CacheKey<O, T>, dependencies?: readonly unknown[]): T;
    /** Discard one failed or outdated derived value without touching independent projections. */
    invalidate<O extends object, T>(owner: O, key: CacheKey<O, T>): void;
    /** Clear a consumer domain on disposal, including owners that will not be read again. */
    clear<O extends object, T>(key: CacheKey<O, T>): void;
    /** Native lifecycle invalidation does not clear another Session with the same string id. */
    release(owner: object): void;
    /** Count actual projection work separately from cache lookup hits. */
    worked<O extends object, T>(key: CacheKey<O, T>, amount?: number): void;
    /** Inspect cache reuse without enumerating or retaining Session objects or body contents. */
    report(): CacheReport[];
    /** Shutdown drops all owned values; retained facades reject later access. */
    close(): void;
};
export type SessionCache = ReturnType<typeof createSessionCache>;
