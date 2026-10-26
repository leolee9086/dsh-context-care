/** Identity directories only: live enabled/failure/dependency decisions are never
 * retained. First matches preserve Array.find even before duplicate validation. */
export declare function indexFirstControlIds<T extends {
    id: string;
}>(values: readonly T[]): ReadonlyMap<string, T>;
export interface ControlIdentitySource {
    sourceId: string;
    rules: readonly {
        id: string;
        actions: readonly {
            id: string;
        }[];
    }[];
}
/** One synchronous catalog owns these directories. Only accessed sources build
 * a rule directory, and only accessed rules build an action directory: a single
 * decision must not materialize every unrelated source's action tree. */
export declare function indexControlSources<S extends ControlIdentitySource>(sources: readonly S[]): {
    get(sourceId: string, ruleId: string): {
        sourceId: string;
        id: string;
        actions: ReadonlyMap<string, S["rules"][number]["actions"][number]>;
    } | undefined;
    clear(): void;
};
interface PreferenceIdentity {
    sourceId: string;
    ruleId: string;
}
interface PreferenceRecord<P> {
    preferences: readonly P[];
}
/** ACK records are immutable identities. A nested synchronous batch can borrow
 * this directory, but a changed record must rebuild it before the next read.
 * The owner explicitly clears it in finally; no Session/event is retained. */
export declare function createControlPreferenceIndex<P extends PreferenceIdentity>(read: () => PreferenceRecord<P> | undefined): {
    get(sourceId: string, ruleId: string): P | undefined;
    clear(): void;
};
export {};
