/** Group one catalog cut without rescanning every rule for every document.
 * Keep all duplicates and source order: catalog grouping is not identity lookup. */
export function groupRulesBySource(rules) {
    const sources = new Map();
    for (const rule of rules) {
        const sourceId = rule.sourceId;
        let group = sources.get(sourceId);
        if (!group) {
            group = [];
            sources.set(sourceId, group);
        }
        group.push(rule);
    }
    return sources;
}
/** One local cascade pass must preserve Array.find's first-match semantics,
 * including duplicate identities. Tuple keys keep source/id boundaries exact;
 * the caller releases this index when the pass ends, not in another cache. */
export function indexFirstRules(rules) {
    const byIdentity = new Map();
    for (const rule of rules) {
        const key = JSON.stringify([rule.sourceId, rule.id]);
        if (!byIdentity.has(key))
            byIdentity.set(key, rule);
    }
    return byIdentity;
}
//# sourceMappingURL=request-rule-index.js.map