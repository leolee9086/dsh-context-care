import test from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime } from '../src/reminder-runtime/index.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { setTimeout as delay } from 'node:timers/promises'

const rule = { format: 'reminder/v1', id: 'no-any', on: 'tool.succeeded', text: '禁止使用 any',
  when: { tool: 'read', arguments: { file_path: { regex: '\\.ts$', flags: 'i' } } }, deliver: { model: { once: 'surface' } } }
const source = { sourceId: 'test', plugin: 'test', revision: 1, rules: [rule] }
const event = (id, file = 'code.ts', sessionId = 's') => ({ callId: id, rootCallId: id, sessionId, name: 'read', arguments: { file_path: file } })
function fixture(t, options = {}) {
  const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 2000 })
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }, execute: (input, signal) => matcher.detect(input, signal), ...options })
  t.after(async () => { await runtime.close(); await matcher.close() })
  return runtime
}

test('actual TS reads match; different input text does not reset visible reminder identity', async t => {
  const runtime = fixture(t)
  runtime.registerSource(source)
  await runtime.submit(event('1', 'x.ts.txt'))
  assert.equal((await runtime.collect({ sessionId: 's', visible: [] })).length, 0)
  await runtime.submit(event('2', 'x.d.ts'))
  const first = await runtime.collect({ sessionId: 's', visible: [] })
  assert.equal(first.length, 1)
  assert.equal(first[0].content[0].text, '禁止使用 any')
  await runtime.submit(event('3'))
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: first, accepted: [{ role: 'user', content: [] }] }), [])
  await runtime.submit(event('4'))
  assert.equal((await runtime.collect({ sessionId: 's', visible: [] })).length, 1)
})

test('analysis runs once before matching and supplies facts to multiple rules', async t => {
  const runtime = fixture(t)
  const module = new URL('./fixtures/reminder-analysis.js', import.meta.url).href
  runtime.registerAnalyzer({ ref: 'typescript', revision: 1, module })
  runtime.registerSource({ ...source, rules: [rule, { ...rule, id: 'facts',
    when: { tool: 'read', condition: { kind: 'compare', field: 'facts.typescript.language', op: 'eq', value: 'ts' } } }] })
  await runtime.submit(event('1'))
  const snapshot = runtime.snapshot('s')
  assert.equal(snapshot.diagnostics.filter(item => item.status === 'analyzed').length, 1)
  assert.equal(snapshot.candidates.length, 2)
})

test('async judge resolves; CPU loop is terminated and later independent rules can finish', async t => {
  const runtime = fixture(t, { config: { ruleTimeoutMs: 500, roundTimeoutMs: 4000 } })
  const module = new URL('./fixtures/reminder-analysis.js', import.meta.url).href
  runtime.registerDetector({ ref: 'loop', revision: 1, module, exportName: 'loop' })
  runtime.registerDetector({ ref: 'async', revision: 1, module, exportName: 'judge' })
  runtime.registerSource({ ...source, rules: [{ ...rule, id: 'loop', priority: 10, judge: { ref: 'loop', revision: 1 } },
    { ...rule, judge: { ref: 'async', revision: 1 } }] })
  await runtime.submit(event('1'))
  assert.deepEqual(runtime.snapshot('s').candidates.map(item => item.ruleId), ['no-any'])
  assert.equal(runtime.snapshot('s').diagnostics.find(item => item.ruleId === 'loop').status, 'timed-out')
})

test('source replacement during analysis cannot publish old results', async t => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const runtime = fixture(t, { execute: async (_input, signal) => { started(); await delay(1000, null, { signal }); return { ok: true } } })
  const handle = runtime.registerSource(source)
  const pending = runtime.submit(event('1'))
  await ready
  handle.replace({ ...source, revision: 2, rules: [] })
  await pending
  assert.equal(runtime.snapshot('s').candidates.length, 0)
})

test('failed persistence is not published and a known pre-commit failure releases reservation', async t => {
  let reject = false
  const runtime = fixture(t, { save: async () => { if (reject) throw new Error('disk'); } })
  runtime.registerSource(source)
  await runtime.submit(event('1'))
  reject = true
  await assert.rejects(runtime.collect({ sessionId: 's', visible: [] }), /disk/)
  reject = false
  const messages = await runtime.collect({ sessionId: 's', visible: [] })
  assert.equal(messages.length, 1)
  await runtime.rollback('s', messages)
  assert.equal((await runtime.collect({ sessionId: 's', visible: [] })).length, 1)
})

test('admission freezes sources before storage waits and bounds pending writes', async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  let writes = 0, executions = 0
  const runtime = fixture(t, { config: { maxQueued: 1, maxConcurrent: 1 },
    save: async () => { if (++writes === 1) { entered(); await gate } },
    execute: async () => { executions++; return { ok: true } } })
  t.after(() => release())
  const handle = runtime.registerSource(source)
  const first = runtime.submit(event('1'))
  await ready
  handle.replace({ ...source, revision: 2 })
  const second = runtime.submit(event('2'))
  await assert.rejects(runtime.submit(event('3')), /capacity/)
  release()
  await Promise.all([first, second])
  assert.equal(executions, 1)
  assert.deepEqual(runtime.snapshot('s').candidates.map(item => item.eventId), ['2'])
})

test('cancellation during storage admission prevents evaluation and close drains the admission', async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  let writes = 0, executions = 0
  const runtime = fixture(t, { save: async () => { if (++writes === 1) { entered(); await gate } },
    execute: async () => { executions++; return { ok: true } } })
  t.after(() => release())
  runtime.registerSource(source)
  const controller = new AbortController()
  const pending = runtime.submit(event('1'), controller.signal)
  await ready
  controller.abort()
  const closing = runtime.close()
  release()
  await Promise.all([pending, closing])
  assert.equal(executions, 0)
  assert.equal(runtime.snapshot('s').candidates.length, 0)
})

test('restart reconciles committed reservations and inherited surface suppresses fork duplicates', async t => {
  const original = fixture(t)
  original.registerSource(source)
  await original.submit(event('1'))
  const messages = await original.collect({ sessionId: 's', visible: [] })
  const { seen, candidates, diagnostics } = original.snapshot('s')
  const restarted = fixture(t, { entries: [['s', { seen, candidates, diagnostics }]] })
  restarted.registerSource(source)
  await restarted.submit(event('2'))
  assert.deepEqual(await restarted.collect({ sessionId: 's', visible: [] }), [])
  await restarted.submit(event('3'))
  assert.equal((await restarted.collect({ sessionId: 's', visible: [], committedIds: messages.map(item => item.id) })).length, 1)
  await restarted.submit(event('fork-1', 'x.ts', 'fork'))
  assert.deepEqual(await restarted.collect({ sessionId: 'fork', visible: messages }), [])
})

test('analyzers share a base input and stale disposers preserve replacements', async t => {
  const module = new URL('./fixtures/reminder-analysis.js', import.meta.url).href
  const observed = []
  const runtime = fixture(t, { execute: async input => {
    if (input.analysis) { observed.push(Object.keys(input.analysis.event.facts)); return { ready: true } }
    return { ok: true }
  } })
  const dispose = runtime.registerAnalyzer({ ref: 'one', revision: 1, module })
  await dispose()
  runtime.registerAnalyzer({ ref: 'one', revision: 2, module })
  await dispose()
  runtime.registerAnalyzer({ ref: 'two', revision: 1, module })
  runtime.registerSource(source)
  await runtime.submit(event('1'))
  assert.deepEqual(observed, [[], []])
})

test('session scope and global rule capacity apply across sources', async t => {
  let accepted = true
  const runtime = fixture(t, { config: { maxRules: 1 } })
  runtime.registerSource(source, { acceptSession: () => accepted })
  assert.throws(() => runtime.registerSource({ ...source, sourceId: 'other' }), { code: 'reminder-capacity-exceeded' })
  await runtime.submit(event('1'))
  accepted = false
  assert.deepEqual(runtime.catalog('s'), [])
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
})

test('default catalog accepts thousands of rules exceeding the execution byte budget', async t => {
  const runtime = fixture(t)
  const rules = Array.from({ length: 2000 }, (_, id) => ({ ...rule, id: String(id), text: 'x'.repeat(1024) }))
  runtime.registerSource({ ...source, rules })
  assert.equal(runtime.capacitySnapshot().registeredRules, 2000)
  assert.equal(runtime.capacitySnapshot().maxRules, 0)
  assert.equal(runtime.catalog('s')[0].rules.length, 2000)
})

test('capacity changes persist before publication, retain existing rules and recover unlimited registration', async t => {
  let stored, fail = true
  const runtime = fixture(t, { saveCapacity: async value => { if (fail) throw new Error('disk'); stored = structuredClone(value) } })
  const two = { ...source, rules: [rule, { ...rule, id: 'second' }] }
  const handle = runtime.registerSource(two)
  await assert.rejects(runtime.setCapacity({ revision: 0, maxRules: 1 }), /disk/)
  assert.equal(runtime.capacitySnapshot().maxRules, 0)
  fail = false
  await runtime.setCapacity({ revision: 0, maxRules: 1 })
  assert.equal(runtime.capacitySnapshot().registeredRules, 2)
  handle.replace({ ...two, revision: 2 })
  assert.throws(() => runtime.registerSource({ ...source, sourceId: 'other' }), { code: 'reminder-capacity-exceeded' })
  assert.deepEqual(runtime.capacitySnapshot().rejections.map(({ sourceRules, totalRules, limit }) => ({ sourceRules, totalRules, limit })),
    [{ sourceRules: 1, totalRules: 3, limit: 1 }])
  await assert.rejects(runtime.setCapacity({ revision: 0, maxRules: 0 }), { status: 409 })
  const restored = fixture(t, { capacity: stored })
  assert.equal(restored.capacitySnapshot().maxRules, 1)
  assert.equal(restored.capacitySnapshot().revision, 1)
  await runtime.setCapacity({ revision: 1, maxRules: 0 })
  runtime.registerSource({ ...source, sourceId: 'other' })
  assert.equal(runtime.capacitySnapshot().registeredRules, 3)
  assert.deepEqual(runtime.capacitySnapshot().rejections, [])
})

test('concurrent capacity writes use one acknowledged global revision', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const runtime = fixture(t, { saveCapacity: () => gate })
  const first = runtime.setCapacity({ revision: 0, maxRules: 500 })
  const second = runtime.setCapacity({ revision: 0, maxRules: 10 })
  const conflict = assert.rejects(second, { status: 409 })
  assert.equal(runtime.capacitySnapshot().maxRules, 0)
  release()
  await first; await conflict
  assert.equal(runtime.capacitySnapshot().maxRules, 500)
})

test('whole round deadline includes queued time and does not give every rule a fresh round', async t => {
  const runtime = fixture(t, { config: { ruleTimeoutMs: 100, roundTimeoutMs: 50, maxConcurrent: 1 },
    execute: async (_input, signal) => { await delay(1000, null, { signal }); return { ok: true } } })
  runtime.registerSource(source)
  await Promise.all([runtime.submit(event('1')), runtime.submit(event('2', 'x.ts', 'other'))])
  assert.equal(runtime.snapshot('s').candidates.length, 0)
  assert.equal(runtime.snapshot('other').candidates.length, 0)
})

test('production deadlines execute short async judges on hot workers and retain timeout phase', async t => {
  const matcher = createBoundedMatcher({ maxPending: 4, maxIdle: 4 })
  const saved = new Map()
  const runtime = createReminderRuntime({ dispatches: true,
    execute: (input, signal, timing) => matcher.detect(input, signal, timing),
    save: async (id, state) => saved.set(id, structuredClone(state)) })
  t.after(async () => { await runtime.close(); await matcher.close() })
  await matcher.warmup()
  const initial = matcher.getStats().workersStarted
  const module = new URL('./fixtures/reminder-analysis.js', import.meta.url).href
  runtime.registerDetector({ ref: 'short', revision: 1, module, exportName: 'judge' })
  runtime.registerDetector({ ref: 'loop', revision: 1, module, exportName: 'loop' })
  runtime.registerSource({ ...source, rules: [
    { ...rule, id: 'loop', priority: 10, judge: { ref: 'loop', revision: 1, timeoutMs: 50 } },
    { ...rule, judge: { ref: 'short', revision: 1, timeoutMs: 50 } }] })
  await runtime.submit(event('production'))
  const state = runtime.snapshot('s')
  assert.deepEqual(state.candidates.map(item => item.ruleId), ['no-any'])
  const failure = saved.get('s').diagnostics.find(item => item.ruleId === 'loop')
  assert.equal(failure.status, 'timed-out')
  assert.equal(failure.diagnostic.phase, 'processing')
  assert.equal(failure.diagnostic.timeoutMs, 50)
  assert.ok(matcher.getStats().workersStarted <= initial + 1)
})
