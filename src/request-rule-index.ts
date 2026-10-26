interface RuleIdentity { sourceId: string; id: string }

/** Group one catalog cut without rescanning every rule for every document.
 * Keep all duplicates and source order: catalog grouping is not identity lookup. */
export function groupRulesBySource<R extends { sourceId: string }>(rules: readonly R[]): ReadonlyMap<string, readonly R[]> {
  const sources = new Map<string, R[]>()
  for (const rule of rules) {
    const sourceId = rule.sourceId
    let group = sources.get(sourceId)
    if (!group) { group = []; sources.set(sourceId, group) }
    group.push(rule)
  }
  return sources
}

/** One local cascade pass must preserve Array.find's first-match semantics,
 * including duplicate identities. Tuple keys keep source/id boundaries exact;
 * the caller releases this index when the pass ends, not in another cache. */
export function indexFirstRules<R extends RuleIdentity>(rules: readonly R[]): ReadonlyMap<string, R> {
  const byIdentity = new Map<string, R>()
  for (const rule of rules) {
    const key = JSON.stringify([rule.sourceId, rule.id])
    if (!byIdentity.has(key)) byIdentity.set(key, rule)
  }
  return byIdentity
}
