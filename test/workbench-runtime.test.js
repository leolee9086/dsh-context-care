import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbenchStore, variableSnapshot, validateDocument, validateDocumentSet } from '../src/workbench-store.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createActionRuns, createExecutorRegistry } from '../src/action-runs.js'
import { releaseResources } from '../src/resource-cleanup.js'
import { createTemplates } from '../src/templates.js'

const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value }); return { promise, resolve } }
const document = (id = 'doc') => ({ schemaVersion: 2, id, revision: 1, title: id, variables: [
  { name: 'count', scope: 'session', type: 'number', default: 0 },
  { name: 'shared', scope: 'global', type: 'string', default: '' },
  { name: 'presetValue', scope: 'preset', type: 'boolean', default: false },
] })
const memoryStore = (options = {}) => createWorkbenchStore({ save: async () => {}, ...options })
const event = (occurrenceId = 'one') => ({ sourceId: 'plugin:x', ruleId: 'r', ruleRevision: 1, occurrenceId, sourceSeqs: [5] })
const item = (action, occurrenceId = 'one') => ({ event: event(occurrenceId), action: { id: 'run', kind: 'program', executorRef: 'x', dependsOn: [], ...action },
  context: { session: { turnId: 'turn' }, captures: { command: 'literal' } }, inputs: { command: 'literal' } })
const agent = () => ({ session: { id: 'session' }, send() {}, followup() {}, cancel() {} })

test('Workbench publishes after ACK, serializes competing CAS, and retries a failed write explicitly', async () => {
  const gate = deferred(); let fail = false; const errors = []
  const store = memoryStore({ save: async () => { await gate.promise; if (fail) throw new Error('disk-write-failed') }, report: error => errors.push(error.message) })
  const first = store.edit('session', { revision: 0, operation: 'put-document', document: document() })
  const conflict = assert.rejects(store.edit('session', { revision: 0, operation: 'put-document', document: document('other') }), /revision-conflict/)
  assert.equal(store.read('session').revision, 0)
  gate.resolve(); await first; await conflict
  fail = true
  await assert.rejects(store.edit('session', { revision: 1, operation: 'set-variable', variable: 'count', value: 7 }), /storage-unavailable/)
  assert.equal(variableSnapshot(store.read('session'), 'turn').count, 0)
  assert.equal(store.available('session'), false)
  assert.ok(errors.includes('disk-write-failed'))
  fail = false
  await store.edit('session', { revision: 1, operation: 'set-variable', variable: 'count', value: 7 })
  assert.equal(variableSnapshot(store.read('session'), 'turn').count, 7)
  assert.equal(store.available('session'), true)
  await store.close()
})

test('Global and preset variables share persisted values, enforce scope CAS, and isolate preset identities', async () => {
  const persisted = new Map(); const store = memoryStore({ save: async (id, value) => persisted.set(id, value) })
  for (const sessionId of ['a', 'b']) await store.edit(sessionId, { revision: 0, operation: 'put-document', document: document() })
  await store.edit('a', { revision: 1, scopeRevision: 0, operation: 'set-variable', variable: 'shared', value: 'shared-value' })
  assert.equal(variableSnapshot(store.read('b'), 'turn').shared, 'shared-value')
  await assert.rejects(store.edit('b', { revision: 1, scopeRevision: 0, operation: 'set-variable', variable: 'shared', value: 'stale' }), /revision-conflict/)
  await store.edit('a', { revision: 1, scopeRevision: 0, operation: 'set-variable', variable: 'presetValue', value: true, presetId: 'preset-a' })
  assert.equal(variableSnapshot(store.read('b', { presetId: 'preset-a' }), 'turn').presetValue, true)
  assert.equal(variableSnapshot(store.read('b', { presetId: 'preset-b' }), 'turn').presetValue, false)
  const restored = memoryStore({ entries: [...persisted] })
  assert.equal(variableSnapshot(restored.read('b'), 'turn').shared, 'shared-value')
  assert.deepEqual(restored.sessions().sort(), ['a', 'b'])
  await assert.rejects(store.automaticVariable('a', document().variables[1], 'override', 'turn'), /scope-denied/)
  await store.close(); await restored.close()
})

test('Workbench rejects duplicate declaration names across documents and stops accepting writes during close', async () => {
  const gate = deferred(); const store = memoryStore({ save: async () => gate.promise })
  const put = store.edit('session', { revision: 0, operation: 'put-document', document: document() })
  await Promise.resolve(); await Promise.resolve()
  const close = store.close()
  await assert.rejects(store.edit('session', { revision: 0, operation: 'put-document', document: document('late') }), /closed/)
  gate.resolve(); await put; await close
  const other = memoryStore()
  await other.edit('session', { revision: 0, operation: 'put-document', document: document() })
  await assert.rejects(other.edit('session', { revision: 1, operation: 'put-document', document: document('duplicate') }), /conflict/)
  await other.close()
})

test('Source registration can inspect pending document ACKs without publishing them as saved', async () => {
  const gate = deferred(); const saving = deferred(); const store = memoryStore({ save: async () => { saving.resolve(); await gate.promise } })
  const write = store.edit('session', { revision: 0, operation: 'put-document', document: document() })
  await saving.promise
  assert.equal(store.read('session').documents.length, 0)
  const pending = store.documentSets().get('session')
  assert.equal(pending[0].id, 'doc')
  assert.throws(() => validateDocumentSet([...pending, validateDocument(document('external'))]), /variables-conflict/)
  gate.resolve(); await write; await store.close()
})

test('Externally registered documents reject local replacement and declaration collisions before persistence', async () => {
  const external = validateDocument(document('external')); let writes = 0
  const store = memoryStore({ externalDocuments: () => [external], save: async () => { writes++ } })
  await assert.rejects(store.edit('session', { revision: 0, operation: 'put-document', document: document('external') }), /read-only/)
  await assert.rejects(store.edit('session', { revision: 0, operation: 'delete-document', documentId: 'external' }), /read-only/)
  await assert.rejects(store.edit('session', { revision: 0, operation: 'put-document', document: document('local') }), /variables-conflict/)
  assert.equal(writes, 0); assert.equal(store.available('session'), true)
  await store.close()
})

const rule = pattern => ({ schemaVersion: 2, sourceId: 'plugin:test', id: 'match', revision: 1, title: 'match', on: ['output.complete'],
  select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern }, priority: 0,
  actions: [{ id: 'notice', kind: 'notify', stage: 'output.complete', enabledDefault: true, template: '{{captures.0}}' }] })
test('Rule admission seqs commit with the document, survive restore and preserve unchanged revisions', async () => {
  let seq = 10; let fail = false; const persisted = new Map()
  const store = memoryStore({ admissionSeq: () => seq, save: async (id, value) => { if (fail) throw new Error('save-denied'); persisted.set(id, value) } })
  const doc = { ...document(), rules: [rule('FIRST')] }
  await store.edit('session', { revision: 0, operation: 'put-document', document: doc })
  const firstKey = JSON.stringify(['match', 1])
  assert.equal(store.read('session').runtime.state['$admission:doc'][firstKey].seq, 10)
  seq = 20
  await store.edit('session', { revision: 1, operation: 'put-document', document: { ...doc, revision: 2, title: 'New title' } })
  assert.equal(store.read('session').runtime.state['$admission:doc'][firstKey].seq, 10)
  fail = true
  const changed = { ...doc, revision: 3, rules: [{ ...rule('SECOND'), revision: 2 }] }
  await assert.rejects(store.edit('session', { revision: 2, operation: 'put-document', document: changed }), /storage-unavailable/)
  assert.equal(store.read('session').runtime.state['$admission:doc'][firstKey].seq, 10)
  fail = false; seq = 30
  await store.edit('session', { revision: 2, operation: 'put-document', document: changed })
  const restored = memoryStore({ entries: [...persisted] })
  assert.deepEqual(restored.read('session').runtime.state['$admission:doc'], { '["match",2]': { seq: 30 } })
  await store.edit('session', { revision: 3, operation: 'delete-document', documentId: 'doc' })
  assert.equal(store.read('session').runtime.state['$admission:doc'], undefined)
  await store.close(); await restored.close()
})
const matching = pattern => ({ rules: [rule(pattern)], blocks: [{ id: 'b', sessionId: 's', seq: 1, messageId: 'm', turnId: 't', view: 'original', role: 'assistant', type: 'text', text: 'a'.repeat(20000) + '!', raw: { type: 'text' } }], stage: 'output.complete' })

test('Bounded matcher terminates catastrophic backtracking and can still process a later request', { timeout: 15000 }, async () => {
  const matcher = createBoundedMatcher({ timeoutMs: 100 })
  try {
    await assert.rejects(matcher.detect(matching('(a+)+$')), /work-timeout/)
    const events = await matcher.detect(matching('a+'))
    assert.equal(events.length, 1)
    assert.equal(events[0].ranges[0][1], 20000)
  } finally { await matcher.close() }
})

test('Bounded matcher abort and disposal settle pending calls without retaining workers', { timeout: 15000 }, async () => {
  const matcher = createBoundedMatcher(); const controller = new AbortController()
  const rejection = assert.rejects(matcher.detect(matching('(a+)+$'), controller.signal), /caller-aborted/)
  controller.abort(new Error('caller-aborted')); await rejection
  const closedRun = assert.rejects(matcher.detect(matching('(a+)+$')), /matcher-closed/)
  await matcher.close(); await closedRun
  await assert.rejects(matcher.detect(matching('a')), /matcher-closed/)
})

test('Program mappings use the fixed native tool name and never invoke after an approval-time control change', async () => {
  const store = memoryStore(); let calls = 0; let enabled = true
  const registry = createExecutorRegistry({ tools: { get: () => ({}), async execute() { calls++; return { content: [], value: 1 } } } })
  registry.registerTool({ executorRef: 'x', plugin: 'test', toolName: 'fixed-tool', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } })
  const question = deferred(); const asked = deferred()
  const jobs = createActionRuns({ store, registry, approvalFor: () => ({ async request() { asked.resolve(); return question.promise } }), guard: () => ({ enabled, reason: 'disabled' }) })
  await jobs.enqueue('session', [item({})], 'token')
  const drain = jobs.drain(agent()); await asked.promise
  enabled = false; question.resolve('allowed-once'); await drain
  assert.equal(calls, 0); assert.equal(store.read('session').runtime.runs[0].status, 'skipped')
  await jobs.close(); await store.close()
})

test('Execution cancellation remains requested until the native pipeline actually settles', async () => {
  const store = memoryStore(); const started = deferred(); const settle = deferred()
  const registry = { get: () => ({ requiresApproval: false, timeoutMs: 10000, validate: () => true, async run({ signal }) { started.resolve(signal); await settle.promise; return { value: 1 } } }) }
  const jobs = createActionRuns({ store, registry, guard: () => ({ enabled: true }) })
  const [runId] = await jobs.enqueue('session', [item({})], 'token')
  const draining = jobs.drain(agent()); const signal = await started.promise
  await jobs.cancel('session', runId)
  assert.equal(signal.aborted, true)
  assert.equal(store.read('session').runtime.runs[0].status, 'running')
  assert.equal(store.read('session').runtime.runs[0].cancellationRequested, true)
  settle.resolve(); await draining
  assert.equal(store.read('session').runtime.runs[0].status, 'unknown')
  await jobs.close(); await store.close()
})

test('Only explicit continue can consume a recorded dependency failure; disabled and unknown parents still block it', async () => {
  for (const parentStatus of ['failed', 'skipped', 'cancelled', 'unknown']) {
    const store = memoryStore(); const messages = []
    const parent = item({ id: 'parent' })
    await store.runtime('session', runtime => runtime.runs.push({ id: 'parent-run', key: 'parent', ...parent.event,
      actionId: 'parent', status: parentStatus, reason: 'confirmed-error' }))
    const jobs = createActionRuns({ store, registry: {}, templates: createTemplates(), guard: () => ({ enabled: true }) })
    const normal = { ...item({ id: 'default', kind: 'notify', dependsOn: ['parent'], template: 'Must not run' }), text: 'Must not run' }
    const explicit = { ...item({ id: 'explicit', kind: 'notify', dependsOn: ['parent'], failurePolicy: 'continue',
      template: '{{results.parent.status}}: {{results.parent.reason}} ({{outcomes.parent.status}})' }), templateDeferred: true }
    await jobs.enqueue('session', [normal, explicit], 'token')
    await jobs.drain({ ...agent(), send: message => messages.push(message) })
    const runs = store.read('session').runtime.runs
    assert.equal(runs[1].status, 'skipped')
    assert.equal(runs[2].status, parentStatus === 'failed' ? 'succeeded' : 'skipped')
    assert.equal(messages.length, parentStatus === 'failed' ? 1 : 0)
    if (messages.length) assert.equal(messages[0].content[0].text, 'failed: confirmed-error (failed)')
    await jobs.close(); await store.close()
  }
})

test('Failed programs and undelivered notifications retain their ledger without consuming success state', async () => {
  const store = memoryStore(); let sent = 0
  const jobs = createActionRuns({ store, registry: { get: () => ({ requiresApproval: false, timeoutMs: 10000, validate: () => true,
    async run() { throw new Error('confirmed-error') } }) }, guard: (_id, _event, _action, _token, options) => ({ enabled: !options?.delivery, reason: 'disabled-before-delivery' }) })
  await jobs.enqueue('session', [item({}), { ...item({ id: 'notice', kind: 'notify' }), text: 'Must not arrive' }], 'token')
  await jobs.drain({ ...agent(), send() { sent++ } })
  assert.deepEqual(store.read('session').runtime.runs.map(run => run.status), ['failed', 'skipped'])
  assert.deepEqual(store.read('session').runtime.state, {}); assert.equal(sent, 0)
  await jobs.close(); await store.close()
})

test('Delivery followed by a failed completion ACK remains unknown and is not automatically delivered again', async () => {
  let failCompletion = true; let sent = 0
  const store = memoryStore({ save: async (_id, record) => {
    if (failCompletion && record.runtime.runs.some(run => run.status === 'succeeded')) { failCompletion = false; throw new Error('completion-ACK-failed') }
  } })
  const jobs = createActionRuns({ store, registry: {}, guard: () => ({ enabled: true }) })
  const notice = { ...item({ id: 'notice', kind: 'notify' }), text: 'One delivery' }
  await jobs.enqueue('session', [notice], 'token')
  await jobs.drain({ ...agent(), send() { sent++ } })
  assert.equal(store.read('session').runtime.runs[0].status, 'unknown')
  assert.equal(store.read('session').runtime.runs[0].delivery, 'delivered')
  assert.deepEqual(store.read('session').runtime.state, {})
  await jobs.recover(); assert.deepEqual(await jobs.enqueue('session', [notice], 'token'), [])
  await jobs.drain(agent()); assert.equal(sent, 1)
  await jobs.close(); await store.close()
})

test('Crash recovery marks unconfirmed execution unknown and does not rerun it', async () => {
  const store = memoryStore(); const registry = { get() { throw new Error('must-not-run') } }
  await store.runtime('session', runtime => runtime.runs.push({ id: 'unconfirmed', key: 'k', status: 'running' }, { id: 'queued', key: 'q', status: 'queued' }))
  const jobs = createActionRuns({ store, registry, guard: () => ({ enabled: true }) })
  await jobs.recover(); await jobs.drain(agent())
  assert.deepEqual(store.read('session').runtime.runs.map(run => run.status), ['unknown', 'skipped'])
  await jobs.close(); await store.close()
})

test('Concurrent enqueues respect the durable queue budget and disabled work remains observable', async () => {
  const store = memoryStore(); let enabled = true
  const jobs = createActionRuns({ store, registry: {}, maxQueued: 1, guard: () => ({ enabled, reason: 'paused-by-session' }) })
  const outcomes = await Promise.allSettled([jobs.enqueue('session', [item({}, 'first')], 't'), jobs.enqueue('session', [item({}, 'second')], 't')])
  assert.deepEqual(outcomes.map(outcome => outcome.status), ['fulfilled', 'rejected'])
  assert.match(outcomes[1].reason.message, /queue-budget/)
  enabled = false
  assert.deepEqual(await jobs.enqueue('session', [item({}, 'disabled')], 't'), [])
  assert.equal(store.read('session').runtime.runs[1].status, 'skipped')
  assert.equal(store.read('session').runtime.runs[1].reason, 'paused-by-session')
  assert.deepEqual(store.read('session').runtime.state, {})
  await jobs.close(); await store.close()
})

test('A cancelled durable queue record cannot be revived by a stale pending item', async () => {
  const store = memoryStore(); let calls = 0
  const jobs = createActionRuns({ store, registry: { get() { calls++; throw new Error('cancelled-work-executed') } }, guard: () => ({ enabled: true }) })
  const [id] = await jobs.enqueue('session', [item({})], 't')
  // Simulate an acknowledged cancellation that predates publication of an old queue snapshot.
  await store.runtime('session', runtime => { runtime.runs.find(run => run.id === id).status = 'cancelled' })
  await jobs.drain(agent())
  assert.equal(calls, 0); assert.equal(store.read('session').runtime.runs[0].status, 'cancelled')
  await jobs.close(); await store.close()
})

test('Turn cancellation settles a stuck approval without invoking the tool or consuming occurrence state', async () => {
  const store = memoryStore(); const asked = deferred(); let calls = 0; const errors = []
  const registry = { get: () => ({ requiresApproval: true, timeoutMs: 10000, validate: () => true, run() { calls++ } }) }
  const jobs = createActionRuns({ store, registry, approvalFor: () => ({ request() { asked.resolve(); return new Promise(() => {}) } }),
    guard: () => ({ enabled: true }), report: error => errors.push(error.message) })
  await jobs.enqueue('session', [item({})], 't')
  const turn = new AbortController(); const work = jobs.drain(agent(), turn.signal)
  await asked.promise; turn.abort(); await work
  assert.equal(calls, 0); assert.equal(store.read('session').runtime.runs[0].status, 'cancelled')
  assert.deepEqual(store.read('session').runtime.state, {}); assert.ok(errors.includes('turn-cancelled'))
  await jobs.close(); await store.close()
})

test('Action timeout includes approval and cancellation after a running ACK still prevents tool execution', async () => {
  const store = memoryStore(); const asked = deferred(); let calls = 0
  const registry = { get: () => ({ requiresApproval: true, timeoutMs: 30, validate: () => true, run() { calls++ } }) }
  const jobs = createActionRuns({ store, registry, approvalFor: () => ({ request() { asked.resolve(); return new Promise(() => {}) } }), guard: () => ({ enabled: true }) })
  await jobs.enqueue('session', [item({})], 't'); const work = jobs.drain(agent()); await asked.promise; await work
  assert.equal(calls, 0); assert.equal(store.read('session').runtime.runs[0].reason, 'action-timeout')
  await jobs.close(); await store.close()
  const writing = deferred(); const ack = deferred()
  const guarded = memoryStore({ save: async (_id, record) => { if (record.runtime.runs.some(run => run.status === 'running')) { writing.resolve(); await ack.promise } } })
  const other = createActionRuns({ store: guarded, registry: { get: () => ({ requiresApproval: false, timeoutMs: 10000, validate: () => true, async run() { calls++; return { value: 1 } } }) }, guard: () => ({ enabled: true }) })
  const [id] = await other.enqueue('session', [item({})], 't')
  const running = other.drain(agent()); await writing.promise
  const cancellation = other.cancel('session', id); ack.resolve(); await cancellation; await running
  assert.equal(calls, 0); assert.equal(guarded.read('session').runtime.runs[0].status, 'cancelled')
  await other.close(); await guarded.close()
})

test('Execution capacity is shared across sessions and a cancelled waiter never starts', async () => {
  const store = memoryStore(); const started = deferred(); const settle = deferred(); let calls = 0
  const registry = { get: () => ({ requiresApproval: false, timeoutMs: 10000, validate: () => true, async run() { calls++; started.resolve(); await settle.promise; return { value: calls } } }) }
  const jobs = createActionRuns({ store, registry, maxConcurrent: 1, guard: () => ({ enabled: true }) })
  await jobs.enqueue('session', [item({})], 't'); await jobs.enqueue('other', [item({})], 't')
  const first = jobs.drain(agent()); await started.promise
  const turn = new AbortController(); const second = jobs.drain({ ...agent(), session: { id: 'other' } }, turn.signal)
  await Promise.resolve(); turn.abort(); await second
  assert.equal(calls, 1); assert.equal(store.read('other').runtime.runs[0].status, 'cancelled')
  settle.resolve(); await first; await jobs.close(); await store.close()
})

test('Resource cleanup releases later owners after a failure and preserves the startup error', async () => {
  const released = []; const first = new Error('first-close'); const primary = new Error('startup')
  const resources = [['first', () => { released.push('first'); throw first }], ['last', () => { released.push('last') }]]
  await assert.rejects(releaseResources(resources), error => error instanceof AggregateError && error.errors[0] === first)
  assert.deepEqual(released, ['first', 'last']); released.length = 0
  await releaseResources(resources, primary)
  assert.deepEqual(released, ['first', 'last']); assert.equal(primary.message, 'startup')
  assert.equal(primary.secondaryFailures[0].phase, 'first')
})
