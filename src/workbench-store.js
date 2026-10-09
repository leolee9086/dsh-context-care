import { z } from 'zod'
import { normalizeRuleV2 } from './vendor/rule-engine/index.js'
import { ControlError } from './rule-controls.js'
import { recordSecondaryFailure } from './secondary-failure.js'

const Id = z.string().min(1).max(256)
const Revision = z.number().int().positive()
export const Variable = z.object({ name: Id, scope: z.enum(['global', 'preset', 'session', 'turn']), type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  default: z.json(), description: z.string().max(4096).default('') }).strict().refine(value => value.type === 'array' ? Array.isArray(value.default)
    : value.type === 'object' ? value.default !== null && typeof value.default === 'object' && !Array.isArray(value.default) : typeof value.default === value.type, 'variable default type mismatch')
export const Entry = z.object({ id: Id, revision: Revision, title: z.string().max(4096), enabledDefault: z.boolean(), template: z.string().max(16384),
  activation: z.object({ kind: z.enum(['constant', 'keywords', 'condition']), keywords: z.array(z.string().min(1).max(4096)).max(256).optional(),
    mode: z.enum(['ANY', 'ALL']).optional(), caseSensitive: z.boolean().default(false), wordBoundary: z.boolean().default(false),
    secondary: z.object({ values: z.array(z.string().min(1)).min(1).max(256), mode: z.enum(['ANY', 'ALL', 'NOT-ANY', 'NOT-ALL']) }).strict().optional(),
    condition: z.json().optional() }).strict(),
  select: z.json(), target: z.object({ view: z.enum(['model', 'display']), role: z.enum(['system', 'developer', 'user', 'assistant']).default('user'),
    anchor: z.string().default('end'), position: z.enum(['before', 'after']).default('after'), depth: z.number().int().nonnegative().optional() }).strict(),
  priority: z.number().int().min(-100000).max(100000).default(0), exclusiveGroup: Id.optional(),
  cooldownMs: z.number().int().nonnegative().max(86400000).default(0), stickyTurns: z.number().int().nonnegative().max(10000).default(0),
  lifetime: z.enum(['request', 'turn', 'turns', 'until-inactive', 'session']).default('request'),
  lifetimeTurns: z.number().int().min(1).max(10000).optional(), activationCooldownMs: z.number().int().nonnegative().max(86400000).default(0),
  cascade: z.boolean().default(false), maxChars: z.number().int().positive().max(65536).default(16384),
}).strict().refine(entry => (entry.lifetime === 'turns') === (entry.lifetimeTurns !== undefined), 'lifetimeTurns is required only for turns lifetime')
  .refine(entry => entry.target.view === 'model' || entry.lifetime === 'request' && entry.stickyTurns === 0 && entry.activationCooldownMs === 0,
    'display entries require request lifetime without persistent activation')
export const Document = z.object({ schemaVersion: z.literal(2), id: Id, revision: Revision, title: z.string().max(4096),
  rules: z.array(z.json()).max(256).default([]), entries: z.array(Entry).max(256).default([]), variables: z.array(Variable).max(256).default([]),
  partials: z.array(z.object({ name: Id, revision: Revision, template: z.string().max(16384) }).strict()).max(64).default([]),
}).strict()
const Runtime = z.object({ runs: z.array(z.json()), state: z.record(z.string(), z.json()) }).strict()
const Stored = z.object({ revision: z.number().int().nonnegative(), runtimeRevision: z.number().int().nonnegative(), documents: z.array(Document),
  variables: z.record(z.string(), z.json()), runtime: Runtime }).strict()
const empty = () => ({ revision: 0, runtimeRevision: 0, documents: [], variables: {}, runtime: { runs: [], state: {} } })
const source = document => `context-care:document:${document.id}`

/** Compile entry activation into the shared matcher; the Host owns lifetime and budget policy. */
export function entryRule(document, entry, { sticky = false } = {}) {
  let match = entry.activation.kind === 'constant' || sticky ? { kind: 'always' }
    : entry.activation.kind === 'condition' ? entry.activation.condition
      : { kind: 'keywords', values: entry.activation.keywords, mode: entry.activation.mode ?? 'ANY', caseSensitive: entry.activation.caseSensitive, wordBoundary: entry.activation.wordBoundary }
  if (entry.activation.secondary && !sticky) match = { kind: 'all', conditions: [match, { kind: 'keywords', ...entry.activation.secondary,
    caseSensitive: entry.activation.caseSensitive, wordBoundary: entry.activation.wordBoundary }] }
  return normalizeRuleV2({ schemaVersion: 2, sourceId: source(document), id: `entry:${entry.id}`, revision: entry.revision, title: entry.title,
    on: [entry.target.view === 'display' ? 'display.render' : 'request.assemble'], select: entry.select, match, priority: entry.priority,
    ...(entry.exclusiveGroup ? { exclusiveGroup: entry.exclusiveGroup } : {}),
    actions: [{ id: 'inject', kind: 'inject', enabledDefault: entry.enabledDefault, stage: entry.target.view === 'display' ? 'display.render' : 'request.assemble',
      template: entry.template, target: entry.target, cooldownMs: entry.cooldownMs, maxChars: entry.maxChars, dedupe: { mode: 'none' } }] })
}
export function validateDocument(input, templates) {
  const document = Document.parse(input)
  const ids = new Set(); const variables = new Set(); const partials = new Set()
  for (const rule of document.rules) {
    const normalized = normalizeRuleV2({ ...rule, sourceId: source(document) })
    if (ids.has(normalized.id)) throw new Error('document-duplicate-rule')
    ids.add(normalized.id)
    for (const action of normalized.actions) if (action.template !== undefined) templates?.validate(action.template)
  }
  for (const entry of document.entries) {
    if (ids.has(`entry:${entry.id}`)) throw new Error('document-duplicate-entry')
    ids.add(`entry:${entry.id}`); entryRule(document, entry); templates?.validate(entry.template)
  }
  for (const variable of document.variables) {
    if (variables.has(variable.name) || ['__proto__', 'prototype', 'constructor'].includes(variable.name)) throw new Error('document-duplicate-or-unsafe-variable')
    variables.add(variable.name)
  }
  for (const partial of document.partials) {
    if (partials.has(partial.name)) throw new Error('document-duplicate-partial')
    partials.add(partial.name); templates?.validate(partial.template)
  }
  return document
}
/** Reject ambiguous identities before any catalog or snapshot is published. */
export function validateDocumentSet(documents, templates) {
  const ids = new Set(); const variables = new Set(); const partials = new Set(templates?.versions().partials.map(partial => partial.name) ?? [])
  for (const document of documents) {
    if (ids.has(document.id)) throw new ControlError(409, 'workbench-document-source-conflict')
    ids.add(document.id)
    for (const [field, names] of [['variables', variables], ['partials', partials]]) for (const item of document[field]) {
      if (names.has(item.name)) throw new ControlError(409, `cross-document-${field}-conflict`)
      names.add(item.name)
    }
  }
}

/** Session CAS edits publish only after ACK. A rejected storage write disables automatic actions until a successful explicit retry. */
export function createWorkbenchStore({ entries = [], save, templates, maxDocuments = 64, maxRuns = 1000, report = () => {}, externalDocuments = () => [], admissionSeq = () => -1 }) {
  const prospective = new Map()
  const records = new Map(entries.map(([id, value]) => [id, Stored.parse(value)])); const chains = new Map(); const failures = new Map()
  let closed = false; let closing = false
  for (const record of records.values()) for (const document of record.documents) validateDocument(document, templates)
  const current = id => records.get(id) ?? empty()
  function mutate(id, change) {
    if (closed || closing) return Promise.reject(new ControlError(503, 'workbench-closed'))
    const task = (chains.get(id) ?? Promise.resolve()).catch(previous => { report(previous) }).then(async () => {
      if (closed) throw new ControlError(503, 'workbench-closed')
      const next = structuredClone(current(id))
      const result = change(next)
      Stored.parse(next)
      validateDocumentSet([...next.documents, ...externalDocuments(id)], templates)
      // A registration must also inspect a document whose durable ACK is still in flight.
      prospective.set(id, next.documents)
      try {
        await save(id, structuredClone(next))
        records.set(id, next); failures.delete(id)
      } catch (error) { failures.set(id, error); report(error); throw new ControlError(503, 'workbench-storage-unavailable', error) }
      finally { prospective.delete(id) }
      return result ?? structuredClone(next)
    })
    chains.set(id, task)
    return task
  }
  return {
    documentSets: () => new Map([...records].filter(([id]) => !id.startsWith('$scope:')).map(([id, record]) => [id, structuredClone(prospective.get(id) ?? record.documents)])
      .concat([...prospective].filter(([id]) => !records.has(id)).map(([id, docs]) => [id, structuredClone(docs)]))),
    read(id, { presetId } = {}) {
      const globalId = '$scope:global'; const presetScopeId = presetId === undefined ? undefined : `$scope:preset:${presetId}`
      const scopeValues = scopeId => Object.fromEntries(Object.entries(current(scopeId).variables).map(([key, value]) => [key.slice(key.indexOf(':') + 1), structuredClone(value)]))
      return { sessionId: id, ...structuredClone(current(id)), scopes: { global: scopeValues(globalId), preset: presetScopeId ? scopeValues(presetScopeId) : {} },
        scopeRevisions: { global: current(globalId).revision, preset: presetScopeId ? current(presetScopeId).revision : null },
        storageError: [id, globalId, presetScopeId].some(scopeId => failures.has(scopeId)) ? 'workbench-storage-unavailable' : undefined }
    },
    token: (id, presetId, variables = current(id).variables) => JSON.stringify([id, current(id).revision, variables, current('$scope:global').revision,
      presetId === undefined ? null : current(`$scope:preset:${presetId}`).revision, [...failures.keys()], closing, closed]),
    available: id => !closed && !closing && !failures.has(id) && ![...failures.keys()].some(id => id.startsWith('$scope:')),
    sessions: () => [...records.keys()].filter(id => !id.startsWith('$scope:')),
    async edit(id, { revision, operation, document, documentId, variable, value, turnId, presetId, scopeRevision }) {
      const declaration = current(id).documents.flatMap(document => document.variables).find(item => item.name === variable)
      if (operation === 'set-variable' && declaration && ['global', 'preset'].includes(declaration.scope)) {
        if (declaration.scope === 'preset' && !presetId) throw new ControlError(400, 'preset-id-required')
        const scopeId = declaration.scope === 'global' ? '$scope:global' : `$scope:preset:${presetId}`
        await mutate(scopeId, next => {
          if (current(id).revision !== revision || next.revision !== scopeRevision) throw new ControlError(409, 'workbench-revision-conflict')
          validateVariableValue(declaration, value)
          next.variables[variableKey(declaration)] = structuredClone(value); next.revision++
        })
        return this.read(id, { presetId })
      }
      return mutate(id, next => {
        if (next.revision !== revision) throw new ControlError(409, 'workbench-revision-conflict')
        if (['put-document', 'delete-document'].includes(operation) && externalDocuments(id).some(item => item.id === (document?.id ?? documentId)))
          throw new ControlError(403, 'external-document-read-only')
        if (operation === 'put-document') {
          const parsed = validateDocument(document, templates)
          const previous = next.documents.find(item => item.id === parsed.id)
          if (parsed.revision !== (previous?.revision ?? 0) + 1) throw new ControlError(409, 'document-revision-conflict')
          const existing = new Map([...(previous?.rules ?? []), ...(previous?.entries ?? []).map(entry => ({ ...entry, id: `entry:${entry.id}` }))].map(rule => [rule.id, rule]))
          for (const rule of [...parsed.rules, ...parsed.entries.map(entry => ({ ...entry, id: `entry:${entry.id}` }))]) {
            if (existing.has(rule.id) && rule.revision < existing.get(rule.id).revision) throw new ControlError(409, 'rule-revision-regressed')
            if (existing.has(rule.id) && JSON.stringify(rule) !== JSON.stringify(existing.get(rule.id)) && rule.revision === existing.get(rule.id).revision) throw new ControlError(409, 'changed-rule-needs-revision')
          }
          next.documents = [...next.documents.filter(item => item.id !== parsed.id), parsed]
          // Capture the edit's event seq in the same durable transaction. Unchanged rules keep their admission seq.
          const seq = admissionSeq(id)
          if (!Number.isSafeInteger(seq) || seq < -1) throw new ControlError(503, 'workbench-admission-seq-unavailable')
          const admissionKey = `$admission:${parsed.id}`
          const previousAdmission = next.runtime.state[admissionKey] ?? {}
          next.runtime.state[admissionKey] = Object.fromEntries([...parsed.rules, ...parsed.entries.map(entry => ({ ...entry, id: `entry:${entry.id}` }))]
            .map(rule => { const key = JSON.stringify([rule.id, rule.revision]); return [key, previousAdmission[key] ?? { seq }] }))
          for (const field of ['variables', 'partials']) {
            const names = next.documents.flatMap(document => document[field].map(item => item.name))
            if (new Set(names).size !== names.length) throw new ControlError(400, `cross-document-${field}-conflict`)
          }
          if (next.documents.length > maxDocuments) throw new ControlError(413, 'document-limit-exceeded')
        } else if (operation === 'delete-document') {
          if (!next.documents.some(item => item.id === documentId)) throw new ControlError(404, 'document-unavailable')
          next.documents = next.documents.filter(item => item.id !== documentId)
          delete next.runtime.state[`$admission:${documentId}`]
        } else if (operation === 'set-variable') {
          const declaration = next.documents.flatMap(document => document.variables).find(item => item.name === variable)
          if (!declaration) throw new ControlError(404, 'variable-unavailable')
          validateVariableValue(declaration, value)
          if (declaration.scope === 'turn' && !turnId) throw new ControlError(400, 'turn-id-required')
          next.variables[variableKey(declaration, turnId)] = structuredClone(value)
        } else throw new ControlError(400, 'unknown-workbench-operation')
        next.revision++
      }).then(() => this.read(id, { presetId }))
    },
    runtime(id, update) {
      return mutate(id, next => {
        const result = update(next.runtime)
        if (result?.then) throw new ControlError(400, 'runtime-update-must-be-synchronous')
        if (next.runtime.runs.length > maxRuns) {
          const removable = next.runtime.runs.filter(run => ['succeeded', 'failed', 'skipped', 'cancelled'].includes(run.status))
          const remove = new Set(removable.slice(0, next.runtime.runs.length - maxRuns).map(run => run.id))
          next.runtime.runs = next.runtime.runs.filter(run => !remove.has(run.id))
          if (next.runtime.runs.length > maxRuns) throw new ControlError(503, 'active-run-limit-exceeded')
        }
        next.runtimeRevision++
      })
    },
    async automaticVariable(id, declaration, value, turnId, assertCurrent = () => {}) {
      if (!['session', 'turn'].includes(declaration.scope)) throw new ControlError(403, 'automatic-variable-scope-denied')
      validateVariableValue(declaration, value)
      if (declaration.scope === 'turn' && !turnId) throw new ControlError(400, 'turn-id-required')
      return mutate(id, next => { assertCurrent(); next.variables[variableKey(declaration, turnId)] = structuredClone(value); next.runtimeRevision++ })
    },
    async close() {
      closing = true
      const settled = await Promise.allSettled(chains.values()); closed = true
      const errors = settled.filter(item => item.status === 'rejected' && !(item.reason instanceof ControlError)).map(item => item.reason)
      if (errors.length) throw new AggregateError(errors, 'workbench-close-failed')
    },
  }
}
export function variableKey(declaration, turnId) { return `${declaration.scope}:${declaration.scope === 'turn' ? `${turnId}:` : ''}${declaration.name}` }
export function validateVariableValue(declaration, value) {
  const correct = declaration.type === 'array' ? Array.isArray(value) : declaration.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === declaration.type
  if (!correct || (typeof value === 'number' && !Number.isFinite(value))) throw new ControlError(400, 'variable-type-mismatch')
}
export function variableSnapshot(record, turnId, scopes = {}) {
  const result = {}
  for (const declaration of record.documents.flatMap(document => document.variables)) {
    if (Object.hasOwn(result, declaration.name)) throw new Error('variable-name-conflict')
    const value = record.variables[variableKey(declaration, turnId)] ?? record.scopes?.[declaration.scope]?.[declaration.name] ?? scopes[declaration.scope]?.[declaration.name] ?? declaration.default
    validateVariableValue(declaration, value); result[declaration.name] = structuredClone(value)
  }
  return result
}
export async function openWorkbenchStore(storageDomain, options) {
  const handle = await storageDomain.open({ name: 'context_care_workbench', version: 1, layout: 'per-record', tables: { sessions: { valueSchema: Stored } } })
  try {
    const table = handle.table('sessions')
    const store = createWorkbenchStore({ ...options, entries: [...table.entries()], save: (id, value) => table.put(id, value) })
    return { ...store, async close() {
      try { await store.close() } catch (error) { try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'workbench-close') }; throw error }
      await handle.close()
    } }
  } catch (error) { try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'workbench-open') }; throw error }
}
