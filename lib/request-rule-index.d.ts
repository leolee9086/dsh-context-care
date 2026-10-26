interface RuleIdentity {
    sourceId: string;
    id: string;
}
/** Group one catalog cut without rescanning every rule for every document.
 * Keep all duplicates and source order: catalog grouping is not identity lookup. */
export declare function groupRulesBySource<R extends {
    sourceId: string;
}>(rules: readonly R[]): ReadonlyMap<string, readonly R[]>;
/** One local cascade pass must preserve Array.find's first-match semantics,
 * including duplicate identities. Tuple keys keep source/id boundaries exact;
 * the caller releases this index when the pass ends, not in another cache. */
export declare function indexFirstRules<R extends RuleIdentity>(rules: readonly R[]): ReadonlyMap<string, R>;
export {};
