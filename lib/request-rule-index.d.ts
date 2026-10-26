interface RuleIdentity {
    sourceId: string;
    id: string;
}
/** One local cascade pass must preserve Array.find's first-match semantics,
 * including duplicate identities. Tuple keys keep source/id boundaries exact;
 * the caller releases this index when the pass ends, not in another cache. */
export declare function indexFirstRules<R extends RuleIdentity>(rules: readonly R[]): ReadonlyMap<string, R>;
export {};
