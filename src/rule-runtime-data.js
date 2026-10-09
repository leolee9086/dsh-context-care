import { RuntimeWire } from './rule-runtime-wire.js'

/** A bounded management page over producer-owned JSON snapshots, including external declarations. */
export function runtimePage(state, { offset = 0, limit = 20, status = '', search = '' } = {}) {
  const counts = {}
  for (const run of state.runtime.runs) counts[run.status] = (counts[run.status] ?? 0) + 1
  const query = search.toLocaleLowerCase()
  const runs = state.runtime.runs.slice().reverse().filter(run => (!status || run.status === status)
    && (!query || [run.sourceId, run.ruleId, run.actionId, run.reason].some(value => String(value ?? '').toLocaleLowerCase().includes(query))))
  return RuntimeWire.parse({ sessionId: state.sessionId, snapshotId: state.snapshotId, turnId: state.turnId, storageError: state.storageError ?? null, fileError: state.fileError,
    documents: state.documents.map(document => {
      const source = state.sources.find(source => source.sourceId === `context-care:document:${document.id}`)
      if (!source) throw new Error('rule-document-source-unavailable')
      return { id: document.id, title: document.title, revision: document.revision, sourceId: source.sourceId, plugin: source.plugin, registration: source.registration,
        rules: document.rules.map(rule => {
          const registered = source.rules.find(value => value.id === rule.id)
          if (!registered) throw new Error('rule-definition-unavailable')
          return registered.definition
        }), entries: document.entries,
        variables: document.variables.map(variable => ({ name: variable.name, scope: variable.scope, type: variable.type, description: variable.description, value: state.values[variable.name] })),
        partials: document.partials }
    }), executors: state.executors, dispatches: state.dispatches.filter(value => value.status !== 'settled'),
    runs: runs.slice(offset, offset + limit), total: runs.length, counts, offset, nextOffset: offset + limit < runs.length ? offset + limit : null })
}
