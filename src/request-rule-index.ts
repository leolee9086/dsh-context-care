interface RuleIdentity { sourceId: string; id: string }

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
