import { z } from 'zod'
import { normalizeRule, normalizeRuleV2 } from '@leolee9086/dsh-rule-engine'
import { recordSecondaryFailure } from './secondary-failure.js'

const Id = z.string().min(1).max(256)
const Action = z.object({ id: Id, title: z.string().optional(), defaultEnabled: z.boolean().default(true),
  available: z.boolean().default(true), reason: z.string().optional(), requires: z.array(Id).default([]) }).strict()
const Rule = z.object({ id: Id, title: z.string().optional(), description: z.string().optional(),
  actions: z.array(Action).min(1), definition: z.json().optional() }).strict()
const Source = z.object({ sourceId: Id, plugin: z.string().nullable(), registration: z.string(), executor: z.string(),
  sessionId: Id.optional(), readOnly: z.boolean().optional(), rules: z.array(Rule) }).strict()
const Preference = z.object({ sourceId: Id, ruleId: Id, paused: z.boolean().default(false),
  actions: z.record(z.string(), z.boolean()).default({}), sinceSeq: z.number().int().default(-1), epoch: z.number().int().nonnegative().default(0) }).strict()
const Stored = z.object({ revision: z.number().int().nonnegative(), preferences: z.array(Preference) }).strict()
export const ControlPatch = z.object({ revision: z.number().int().nonnegative(), sourceId: Id, ruleId: Id,
  actionId: Id.optional(), enabled: z.boolean().optional(), paused: z.boolean().optional(), reset: z.literal(true).optional() }).strict()
  .refine(value => Number(value.reset === true) + Number(value.paused !== undefined) + Number(value.actionId !== undefined && value.enabled !== undefined) === 1,
    'choose pause, action toggle, or reset')
  .refine(value => (value.actionId === undefined) === (value.enabled === undefined), 'actionId and enabled belong together')

/** HTTP callers retain a machine-readable status without exposing storage internals. */
export class ControlError extends Error {
  constructor(status, code, cause) { super(code, cause === undefined ? undefined : { cause }); this.status = status; this.code = code }
}
const identity = (sourceId, ruleId) => JSON.stringify([sourceId, ruleId])

/**
 * Create the policy owner from acknowledged records and an asynchronous durable writer.
 * Registration is declarative: plugin is the registrant's explicit identity, never the consumer's guessed name.
 * @param options persisted entries and save(sessionId, record) ACK callback
 * @returns registry, session snapshots, execution decisions and serialized CAS updates
 */
export function createRuleControls({ entries = [], save, boundary = () => -1 }) {
  const records = new Map(entries.map(([id, value]) => [id, Stored.parse(value)]))
  const sources = new Map()
  const providers = new Set()
  const chains = new Map()
  const failures = new Map()
  const samples = new Map()
  let generation = 0
  let closed = false
  const stored = sessionId => records.get(sessionId) ?? { revision: 0, preferences: [] }
  function validate(source) {
    const value = Source.parse(source)
    const ids = new Set()
    for (const rule of value.rules) {
      if (ids.has(rule.id)) throw new Error(`context-care: duplicate rule ${rule.id}`)
      ids.add(rule.id)
      // Definitions delegated to our rule engine must fail during registration,
      // before the sidebar can describe a malformed rule as executable.
      if (rule.definition?.action?.by === 'context-care') normalizeRule({ ...rule.definition, id: rule.id }, 0)
      if (rule.definition?.schemaVersion === 2) {
        const definition = normalizeRuleV2(rule.definition)
        if (definition.sourceId !== value.sourceId || definition.id !== rule.id) throw new Error('context-care: v2 definition identity mismatch')
        if (definition.actions.length !== rule.actions.length || definition.actions.some(action => {
          const control = rule.actions.find(item => item.id === action.id)
          return !control || control.defaultEnabled !== action.enabledDefault || JSON.stringify(control.requires) !== JSON.stringify(action.dependsOn)
        })) throw new Error('context-care: v2 action controls mismatch')
      }
      const actions = new Set(rule.actions.map(action => action.id))
      if (rule.definition?.action?.by === 'context-care' && !actions.has(rule.definition.action.kind)) {
        throw new Error(`context-care: missing control action ${rule.definition.action.kind} in ${rule.id}`)
      }
      if (actions.size !== rule.actions.length) throw new Error(`context-care: duplicate actions in ${rule.id}`)
      const visited = new Set()
      const visiting = new Set()
      const visit = action => {
        if (visiting.has(action.id)) throw new Error(`context-care: cyclic action dependency in ${rule.id}`)
        if (visited.has(action.id)) return
        visiting.add(action.id)
        for (const required of action.requires) {
          if (!actions.has(required)) throw new Error(`context-care: unknown action dependency ${required}`)
          visit(rule.actions.find(item => item.id === required))
        }
        visiting.delete(action.id); visited.add(action.id)
      }
      for (const action of rule.actions) visit(action)
    }
    return value
  }
  function catalog(sessionId) {
    if (closed) return []
    const result = [...sources.values(), ...[...providers].flatMap(provider => provider(sessionId).map(validate))]
      .filter(source => source.sessionId === undefined || source.sessionId === sessionId)
    const ids = new Set()
    for (const source of result) {
      if (ids.has(source.sourceId)) throw new Error(`context-care: conflicting source ${source.sourceId}`)
      ids.add(source.sourceId)
    }
    return result
  }
  function preference(sessionId, sourceId, ruleId) {
    return stored(sessionId).preferences.find(item => item.sourceId === sourceId && item.ruleId === ruleId)
  }
  function decisionFor(sessionId, source, ruleId, actionId) {
    if (!sessionId || closed || failures.has(sessionId)) return { enabled: false, reason: 'storage-unavailable' }
    const sourceId = source?.sourceId
    const rule = source?.rules.find(item => item.id === ruleId)
    const action = rule?.actions.find(item => item.id === actionId)
    if (!action) return { enabled: false, reason: 'source-unavailable' }
    const pref = preference(sessionId, sourceId, ruleId)
    if (pref?.paused) return { enabled: false, reason: 'rule-paused' }
    if (!(pref?.actions[actionId] ?? action.defaultEnabled ?? true)) return { enabled: false, reason: 'action-disabled' }
    if (action.available === false) return { enabled: false, reason: action.reason ?? 'executor-unavailable' }
    for (const required of action.requires) {
      if (!decisionFor(sessionId, source, ruleId, required).enabled) return { enabled: false, reason: 'dependency-disabled' }
    }
    return { enabled: true, reason: 'enabled' }
  }
  function decision(sessionId, sourceId, ruleId, actionId) {
    return decisionFor(sessionId, catalog(sessionId).find(item => item.sourceId === sourceId), ruleId, actionId)
  }
  function snapshot(sessionId) {
    const record = stored(sessionId)
    return { sessionId, revision: record.revision, storageError: failures.has(sessionId) ? 'storage-unavailable' : undefined,
      sample: samples.get(sessionId), sources: catalog(sessionId).map(source => ({ ...source, rules: source.rules.map(rule => {
        const pref = preference(sessionId, source.sourceId, rule.id)
        return { ...rule, definition: undefined, paused: pref?.paused ?? false, actions: rule.actions.map(action => ({ ...action,
          selected: pref?.actions[action.id] ?? action.defaultEnabled ?? true,
          ...decisionFor(sessionId, source, rule.id, action.id) })) }
      }) })) }
  }
  function patch(sessionId, input) {
    const change = ControlPatch.parse(input)
    // The preceding caller receives its rejection. A handled failure must not
    // poison the next explicit retry or a later compare-and-swap operation.
    const task = (chains.get(sessionId) ?? Promise.resolve()).catch(previousError => {
      if (!(previousError instanceof ControlError)) throw previousError
    }).then(async () => {
      if (closed) throw new ControlError(503, 'controls-closed')
      const previous = stored(sessionId)
      if (change.revision !== previous.revision) throw new ControlError(409, 'revision-conflict')
      const rule = catalog(sessionId).find(source => source.sourceId === change.sourceId)?.rules.find(rule => rule.id === change.ruleId)
      if (!rule) throw new ControlError(404, 'rule-unavailable')
      if (change.actionId !== undefined && !rule.actions.some(action => action.id === change.actionId)) throw new ControlError(404, 'action-unavailable')
      const old = preference(sessionId, change.sourceId, change.ruleId)
      const pref = { sourceId: change.sourceId, ruleId: change.ruleId, paused: old?.paused ?? false,
        actions: { ...old?.actions }, sinceSeq: boundary(sessionId), epoch: previous.revision + 1 }
      if (change.reset) { pref.paused = false; pref.actions = {} }
      else if (change.paused !== undefined) pref.paused = change.paused
      else pref.actions[change.actionId] = change.enabled
      const next = { revision: previous.revision + 1, preferences: [...previous.preferences.filter(item => identity(item.sourceId, item.ruleId) !== identity(pref.sourceId, pref.ruleId)), pref] }
      // Some stores mutate their cache before rejecting a write. Execution reads
      // this detached ACK-only map, and a failed save disables this session until retry succeeds.
      try { await save(sessionId, structuredClone(next)) }
      catch (error) { failures.set(sessionId, error); throw new ControlError(503, 'storage-unavailable', error) }
      records.set(sessionId, next)
      failures.delete(sessionId)
      return snapshot(sessionId)
    })
    chains.set(sessionId, task)
    return task
  }
  return {
    register(input) {
      if (closed) throw new ControlError(503, 'controls-closed')
      const source = validate(input)
      if (sources.has(source.sourceId)) throw new Error(`context-care: duplicate source ${source.sourceId}`)
      sources.set(source.sourceId, source); generation++
      return () => { if (sources.get(source.sourceId) === source) { sources.delete(source.sourceId); generation++ } }
    },
    registerProvider(provider) { if (closed) throw new ControlError(503, 'controls-closed'); providers.add(provider); generation++; return () => { providers.delete(provider); generation++ } },
    catalog, decision, snapshot, patch,
    enabled: (sessionId, sourceId, ruleId, actionId) => decision(sessionId, sourceId, ruleId, actionId).enabled,
    sinceSeq: (sessionId, sourceId, ruleId) => preference(sessionId, sourceId, ruleId)?.sinceSeq ?? -1,
    epoch: (sessionId, sourceId, ruleId) => `${generation}:${preference(sessionId, sourceId, ruleId)?.epoch ?? 0}:${failures.has(sessionId)}`,
    revision: sessionId => stored(sessionId).revision,
    currentSample: sessionId => samples.get(sessionId),
    sample(sessionId, value) { if (!closed) samples.set(sessionId, { ...value, at: Date.now() }) },
    async close() {
      closed = true
      const settled = await Promise.allSettled(chains.values())
      sources.clear(); providers.clear(); samples.clear()
      // Expected request rejections were already delivered to their callers;
      // unexpected lifecycle failures must remain visible to the Host disposer.
      const unexpected = settled.filter(result => result.status === 'rejected' && !(result.reason instanceof ControlError)).map(result => result.reason)
      if (unexpected.length) throw new AggregateError(unexpected, 'context-care: controls shutdown failed')
    },
  }
}

/** Open preferences once in the Host storage domain; malformed persisted records prevent activation. */
export async function openRuleControls(storageDomain, options = {}) {
  const handle = await storageDomain.open({ name: 'context_care_controls', version: 1, layout: 'per-record',
    tables: { sessions: { valueSchema: Stored } } })
  try {
    const table = handle.table('sessions')
    const controls = createRuleControls({ ...options, entries: [...table.entries()], save: (id, value) => table.put(id, value) })
    return { ...controls, async close() {
      try { await controls.close() }
      catch (error) {
        try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'controls shutdown') }
        throw error
      }
      await handle.close()
    } }
  } catch (error) {
    try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'controls rollback') }
    throw error
  }
}
