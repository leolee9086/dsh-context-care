import test from 'node:test'
import assert from 'node:assert/strict'
import { ZodError } from 'zod'
// pnpm test builds the same runtime that the public JS adapter imports.
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { asBatch } from './batch-execute.ts'

const config = { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }
const source = () => ({ sourceId: 'boundary-source', plugin: 'test', revision: 1, rules: [{
  format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'ORIGINAL_NOTICE',
  when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
}] })
const event = (callId = 'probe-1') => ({ sessionId: 'boundary-session', callId, rootCallId: callId,
  name: 'probe', arguments: { file_path: 'original.ts' } })

test('runtime rejects malformed persisted records before accepting work', () => {
  // These are transport inputs, not a substitute implementation of Host storage.
  const malformed: unknown[] = [null, { seen: [], candidates: [] },
    { seen: [42], candidates: [], diagnostics: [] },
    { seen: [], candidates: [{ id: 'incomplete' }], diagnostics: [] },
    { seen: [], candidates: [], diagnostics: [], windows: [{ key: 'bad', until: 'tomorrow' }] }]
  for (const value of malformed) assert.throws(() => createReminderRuntime({
    entries: [['boundary-session', value]],
  }), ZodError)
})

test('runtime restores legacy records without windows or source signatures', async t => {
  const original = createReminderRuntime({ config, execute: asBatch(async () => ({ ok: true })) })
  t.after(() => original.close())
  original.registerSource(source())
  await original.submit(event())
  const snapshot = original.snapshot('boundary-session')
  const legacy = { seen: snapshot.seen, diagnostics: snapshot.diagnostics,
    candidates: snapshot.candidates.map(candidate => {
      const { sourceSignature: _signature, ...value } = candidate
      return value
    }) }
  const restored = createReminderRuntime({ entries: [['boundary-session', legacy]] })
  t.after(() => restored.close())
  assert.deepEqual(restored.snapshot('boundary-session').windows, [])
  assert.equal(restored.snapshot('boundary-session').candidates[0]?.text, 'ORIGINAL_NOTICE')
  assert.equal(restored.snapshot('boundary-session').candidates[0]?.sourceSignature, undefined)
})

test('runtime restores string policy epochs and rejects candidates after a policy change', async t => {
  let policy = '1:0:false'
  const original = createReminderRuntime({ config, epoch: () => policy, execute: asBatch(async () => ({ ok: true })) })
  t.after(() => original.close())
  original.registerSource(source())
  await original.submit(event())
  const { sources: _sources, storageError: _error, ...state } = original.snapshot('boundary-session')
  assert.equal(state.candidates[0]?.policy, policy)
  // JSON serialization matches durable storage; the policy token retains its original type.
  const entry: unknown = JSON.parse(JSON.stringify(state))
  const restored = createReminderRuntime({ entries: [['boundary-session', entry]], epoch: () => policy })
  t.after(() => restored.close())
  restored.registerSource(source())
  const messages = await restored.collect({ sessionId: 'boundary-session', visible: [] })
  assert.equal(messages[0]?.content[0]?.text, 'ORIGINAL_NOTICE')
  await restored.rollback('boundary-session', messages)
  policy = '1:1:false'
  assert.deepEqual(await restored.collect({ sessionId: 'boundary-session', visible: [] }), [])
  assert.equal(restored.snapshot('boundary-session').candidates[0]?.status, 'discarded')
})

test('runtime restores signed pending candidates and isolates entry snapshots', async t => {
  const original = createReminderRuntime({ config, execute: asBatch(async () => ({ ok: true })) })
  t.after(() => original.close())
  original.registerSource(source())
  await original.submit(event())
  const { sources: _sources, storageError: _error, ...entry } = original.snapshot('boundary-session')
  const restored = createReminderRuntime({ entries: [['boundary-session', entry]] })
  t.after(() => restored.close())
  restored.registerSource(source())
  entry.seen.push('foreign-event')
  const candidate = entry.candidates[0]
  assert.ok(candidate)
  candidate.text = 'MUTATED_ENTRY'
  const messages = await restored.collect({ sessionId: 'boundary-session', visible: [] })
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.content[0]?.text, 'ORIGINAL_NOTICE')
  assert.equal(restored.snapshot('boundary-session').seen.includes('foreign-event'), false)
})

for (const [name, result] of [
  ['missing flag', {}], ['non-boolean flag', { ok: 'yes' }], ['null result', null],
  ['non-JSON evidence', { ok: true, evidence: () => 'invalid' }],
] satisfies [string, unknown][]) {
  test(`runtime records invalid executor ${name} as failure without delivering`, async t => {
    const runtime = createReminderRuntime({ config, execute: asBatch(async () => result) })
    t.after(() => runtime.close())
    runtime.registerSource(source())
    await runtime.submit(event())
    const snapshot = runtime.snapshot('boundary-session')
    assert.equal(snapshot.candidates.length, 0)
    assert.equal(snapshot.diagnostics.length, 1)
    assert.equal(snapshot.diagnostics[0]?.status, 'failed')
    assert.equal(snapshot.diagnostics[0]?.ruleId, 'notice')
    assert.deepEqual(await runtime.collect({ sessionId: 'boundary-session', visible: [] }), [])
  })
}

test('runtime rejects invalid analyzer facts and still evaluates independent rules', async t => {
  const runtime = createReminderRuntime({ config, execute: asBatch(async input =>
    'analysis' in input ? ['not-a-fact-record'] : { ok: true }) })
  t.after(() => runtime.close())
  // The injected execution port does not import this module; it returns invalid wire data.
  runtime.registerAnalyzer({ ref: 'boundary-analyzer', revision: 1, module: import.meta.url })
  runtime.registerSource(source())
  await runtime.submit(event())
  const snapshot = runtime.snapshot('boundary-session')
  assert.equal(snapshot.candidates.length, 1)
  assert.equal(snapshot.diagnostics.find(item => item.analyzer === 'boundary-analyzer')?.status, 'failed')
  assert.equal(snapshot.diagnostics.find(item => item.ruleId === 'notice')?.status, 'matched')
})

test('runtime detaches registration, submitted events and returned snapshots from callers', async t => {
  let observedPath: unknown
  const runtime = createReminderRuntime({ config, execute: asBatch(async input => {
    if ('reminder' in input) {
      const args = input.reminder.event.arguments
      if (args && typeof args === 'object' && !Array.isArray(args)) observedPath = args.file_path
    }
    return { ok: true }
  }) })
  t.after(() => runtime.close())
  const definition = source(), submitted = event()
  runtime.registerSource(definition)
  const rule = definition.rules[0]
  assert.ok(rule)
  rule.text = 'MUTATED_SOURCE'
  const pending = runtime.submit(submitted)
  submitted.arguments.file_path = 'mutated.ts'
  await pending
  assert.equal(observedPath, 'original.ts')
  const snapshot = runtime.snapshot('boundary-session')
  const candidate = snapshot.candidates[0]
  assert.ok(candidate)
  assert.equal(candidate.text, 'ORIGINAL_NOTICE')
  candidate.text = 'MUTATED_SNAPSHOT'
  snapshot.seen.push('foreign-event')
  snapshot.sources.length = 0
  const fresh = runtime.snapshot('boundary-session')
  assert.equal(fresh.candidates[0]?.text, 'ORIGINAL_NOTICE')
  assert.equal(fresh.seen.includes('foreign-event'), false)
  assert.equal(fresh.sources.length, 1)
})
