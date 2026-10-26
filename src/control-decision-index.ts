/** Identity directories only: live enabled/failure/dependency decisions are never
 * retained. First matches preserve Array.find even before duplicate validation. */
export function indexFirstControlIds<T extends { id: string }>(values: readonly T[]): ReadonlyMap<string, T> {
  const result = new Map<string, T>()
  for (const value of values) { const id = value.id; if (!result.has(id)) result.set(id, value) }
  return result
}

export interface ControlIdentitySource { sourceId: string; rules: readonly { id: string; actions: readonly { id: string }[] }[] }

/** One synchronous catalog owns these directories. Only accessed sources build
 * a rule directory, and only accessed rules build an action directory: a single
 * decision must not materialize every unrelated source's action tree. */
export function indexControlSources<S extends ControlIdentitySource>(sources: readonly S[]) {
  type Rule = S['rules'][number]
  const bySource = new Map(sources.map(source => [source.sourceId, source]))
  const byRule = new Map<S, ReadonlyMap<string, Rule>>()
  type IndexedRule = { sourceId: string; id: string; actions: ReadonlyMap<string, Rule['actions'][number]> }
  const byAction = new Map<S, Map<Rule, IndexedRule>>()
  return {
    get(sourceId: string, ruleId: string) {
      const source = bySource.get(sourceId)
      if (!source) return undefined
      let rules = byRule.get(source)
      if (!rules) { rules = indexFirstControlIds(source.rules); byRule.set(source, rules) }
      const rule = rules.get(ruleId)
      if (!rule) return undefined
      let actions = byAction.get(source)
      if (!actions) { actions = new Map(); byAction.set(source, actions) }
      let indexed = actions.get(rule)
      if (!indexed) { indexed = { sourceId, id: rule.id, actions: indexFirstControlIds(rule.actions) }; actions.set(rule, indexed) }
      return indexed
    },
    clear() { bySource.clear(); byRule.clear(); byAction.clear() },
  }
}

interface PreferenceIdentity { sourceId: string; ruleId: string }
interface PreferenceRecord<P> { preferences: readonly P[] }

/** ACK records are immutable identities. A nested synchronous batch can borrow
 * this directory, but a changed record must rebuild it before the next read.
 * The owner explicitly clears it in finally; no Session/event is retained. */
export function createControlPreferenceIndex<P extends PreferenceIdentity>(read: () => PreferenceRecord<P> | undefined) {
  let current: PreferenceRecord<P> | undefined, initialized = false
  const byIdentity = new Map<string, P>()
  return {
    get(sourceId: string, ruleId: string): P | undefined {
      const record = read()
      if (!initialized || record !== current) {
        const next = new Map<string, P>()
        for (const pref of record?.preferences ?? []) {
          const key = JSON.stringify([pref.sourceId, pref.ruleId])
          if (!next.has(key)) next.set(key, pref)
        }
        byIdentity.clear()
        for (const [key, pref] of next) byIdentity.set(key, pref)
        current = record; initialized = true
      }
      return byIdentity.get(JSON.stringify([sourceId, ruleId]))
    },
    clear() { current = undefined; initialized = false; byIdentity.clear() },
  }
}
