import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRuleV2 } from '@leolee9086/dsh-rule-engine'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createDetectorRegistry } from '../src/detector-registry.js'

const spec = extra => ({ plugin: 'test-plugin', ref: 'test:letters', revision: 1, on: ['output.delta', 'output.complete', 'display.render'],
  paramsSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'], additionalProperties: false },
  stateSchema: { type: 'object', properties: { text: { type: 'string' }, feeds: { type: 'integer' } }, required: ['text', 'feeds'], additionalProperties: false },
  resultSchema: {}, callbacks: {
    initialize() { return { text: '', feeds: 0 } },
    feed({ state, params, delta }) {
      state.text += delta; state.feeds++
      return { state, result: { ok: state.text.includes(params.token), ranges: [], captures: {}, facts: { text: state.text, feeds: state.feeds } } }
    },
    finalize({ state }) { return { state, result: { ok: true, ranges: [], captures: {}, facts: { final: true, text: state.text, feeds: state.feeds } } } },
    reset() { return { text: '', feeds: 0 } },
  }, ...extra })
const rule = (extra = {}) => normalizeRuleV2({ schemaVersion: 2, sourceId: 'test', id: 'r', revision: 1, on: ['output.delta'],
  select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'detector', ref: 'test:letters', revision: 1, params: { token: 'ab' } },
  actions: [{ id: 'a', kind: 'notify', stage: 'output.delta', enabledDefault: true, template: 'hit' }], ...extra })
const block = (text, extra = {}) => ({ id: 'b', sessionId: 's', requestId: 'request', attemptId: 'attempt', blockKey: 0, view: 'original', role: 'assistant', type: 'text', text, ...extra })
const input = (text, rules = [rule()], extra = {}) => ({ blocks: [block(text)], stage: 'output.delta', rules, ...extra })
async function fixture(run, options, registryOptions) {
  const matcher = createBoundedMatcher(options); const registry = createDetectorRegistry(matcher, registryOptions)
  try { await run(registry, matcher) } finally { await registry.close(); await matcher.close() }
}

test('Detector streams isolate sessions, attempts, blocks and views; epoch reset excludes earlier text', async () => fixture(async registry => {
  registry.register(spec())
  const options = { sessionId: 's', scope: 's/request/attempt', epoch: 'p' }
  assert.equal((await registry.detect(input('a'), undefined, options)).length, 0)
  const found = await registry.detect(input('ab'), undefined, options)
  assert.deepEqual(found[0].facts, { text: 'ab', feeds: 2 })
  assert.equal((await registry.detect(input('b'), undefined, { ...options, scope: 's/request/attempt2' })).length, 0)
  assert.equal((await registry.detect(input('b'), undefined, { ...options, scope: 'other-session/request/attempt' })).length, 0)
  assert.equal((await registry.detect(input('b', undefined, { blocks: [block('b', { id: 'block2', blockKey: 2 })] }), undefined, options)).length, 0)
  const modelRule = rule({ select: { view: 'model', roles: ['assistant'], blockTypes: ['text'] } })
  assert.equal((await registry.detect(input('b', [modelRule], { blocks: [block('b', { view: 'model' })] }), undefined, options)).length, 0, 'The same block ID in a second view starts fresh')
  assert.equal((await registry.detect(input('b'), undefined, { ...options, epoch: 'new' })).length, 0)
  await registry.release(options.scope)
  assert.equal((await registry.detect(input('b'), undefined, options)).length, 0)
}))

test('Detector finalization and reset validate state, while display/preview reads retain no incremental state', async () => fixture(async registry => {
  registry.register(spec())
  const options = { sessionId: 's', scope: 'stream', epoch: 'p' }
  await registry.detect(input('a'), undefined, options)
  const finalized = await registry.detect(input('ab', undefined, { blocks: [block('ab', { detectorPhase: 'finalize' })] }), undefined, options)
  assert.equal(finalized[0].facts.final, true); assert.equal(finalized[0].facts.feeds, 2)
  assert.equal((await registry.detect(input('b'), undefined, options)).length, 0)
  const completeRule = rule({ on: ['display.render'], actions: [{ id: 'a', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'copy' }] })
  const request = input('ab', [completeRule], { stage: 'display.render' })
  assert.equal((await registry.detect(request, undefined, { sessionId: 's' }))[0].facts.feeds, 1)
  assert.equal((await registry.detect(request, undefined, { sessionId: 's' }))[0].facts.feeds, 1)
}))

test('Owned detector scope and revision drive availability; registration collisions and async callbacks reject', async () => fixture(async registry => {
  const dispose = registry.register(spec({ sessionId: 's' }))
  assert.equal(registry.available(rule(), 's', 'output.delta'), true)
  assert.equal(registry.available(rule(), 'other', 'output.delta'), false)
  assert.throws(() => registry.register(spec()), /conflict/)
  const foreignDispose = registry.register(spec({ sessionId: 'other' }))
  assert.equal((await registry.detect(input('ab'), undefined, { sessionId: 'missing' })).length, 0)
  assert.throws(() => registry.register(spec({ ref: 'async', callbacks: { ...spec().callbacks, feed: async () => null } })), /synchronous/)
  await dispose(); assert.equal(registry.available(rule(), 's', 'output.delta'), false)
  await foreignDispose()
}))

test('External detectors and native regex share one priority/exclusive pass with validated UTF16 evidence', async () => fixture(async registry => {
  registry.register(spec())
  const high = rule({ priority: 20, exclusiveGroup: 'g' })
  const low = rule({ id: 'native', priority: 10, exclusiveGroup: 'g', match: { kind: 'regex', pattern: 'ab' } })
  assert.deepEqual((await registry.detect(input('ab', [low, high]), undefined, { sessionId: 's' })).map(event => event.ruleId), ['r'])
  const nativeHigh = { ...low, priority: 30 }
  assert.deepEqual((await registry.detect(input('ab', [high, nativeHigh]), undefined, { sessionId: 's' })).map(event => event.ruleId), ['native'])
  assert.deepEqual((await registry.detect(input('a', [low, high]), undefined, { sessionId: 's' })).map(event => event.ruleId), [])
}))

test('Detector cancellation and disposal stop workers before returning; synchronous loops time out', async () => fixture(async registry => {
  const slow = spec({ timeoutMs: 25, callbacks: { ...spec().callbacks, feed() { while (true) {} } } })
  const dispose = registry.register(slow)
  await assert.rejects(registry.detect(input('a'), undefined, { sessionId: 's' }), /timed out|work-timeout/)
  const controller = new AbortController()
  const cancelled = registry.detect(input('a'), controller.signal, { sessionId: 's' })
  controller.abort(new Error('test-cancel'))
  await assert.rejects(cancelled, /test-cancel/)
  const pending = registry.detect(input('a'), undefined, { sessionId: 's' })
  const rejection = assert.rejects(pending, /detector-disposed/)
  await dispose(); await rejection
}))

test('Malformed params, state, evidence, promises and closure references cannot publish results', async () => fixture(async registry => {
  let dispose = registry.register(spec())
  await assert.rejects(registry.detect(input('a', [rule({ match: { kind: 'detector', ref: 'test:letters', revision: 1, params: { token: 1 } } })]), undefined, { sessionId: 's' }), /params-schema/)
  await dispose()
  for (const feed of [
    () => ({ state: { text: '', feeds: 'bad' }, result: { ok: false, ranges: [], captures: {} } }),
    ({ state }) => ({ state, result: { ok: true, ranges: [[0, 999]], captures: {} } }),
    ({ state }) => ({ state, result: { ok: true, ranges: [], captures: {}, field: 'arbitrary.path' } }),
    () => Promise.resolve(null),
    () => missingClosure,
  ]) {
    dispose = registry.register(spec({ callbacks: { ...spec().callbacks, feed } }))
    await assert.rejects(registry.detect(input('a'), undefined, { sessionId: 's' }), /state-schema|invalid detector range|block.text|plain-json|not defined/)
    await dispose()
  }
}))

test('Builtin marker/phrase/line-repeat/degradation reuse shared facts and pattern IDs', async () => fixture(async registry => {
  const builtinRule = (ref, params) => rule({ match: { kind: 'detector', ref: `context-care:${ref}`, revision: 1, params } })
  const options = { sessionId: 's', scope: 'builtin', epoch: 'p' }
  const marker = builtinRule('marker', { token: 'MARK' })
  assert.equal((await registry.detect(input('MA', [marker]), undefined, options)).length, 0)
  assert.equal((await registry.detect(input('MARK', [marker]), undefined, options))[0].facts.kind, 'marker')
  const phrase = builtinRule('phrase', { phrases: ['hello'] })
  assert.equal((await registry.detect(input('hello', [phrase]), undefined, { sessionId: 's' }))[0].facts.phrase, 'hello')
  const repeated = 'repeated line\n'.repeat(32)
  const line = builtinRule('line-repeat', { everyBytes: 1 })
  assert.equal((await registry.detect(input(repeated, [line]), undefined, { sessionId: 's' }))[0].facts.kind, 'line-repeat')
  const degradation = builtinRule('degradation', {})
  const complete = { ...degradation, on: ['output.complete'], actions: [{ ...degradation.actions[0], stage: 'output.complete' }] }
  const hit = await registry.detect(input(repeated, [complete], { stage: 'output.complete' }), undefined, { sessionId: 's' })
  assert.equal(hit[0].facts.pattern, 'line-repeat'); assert.equal(hit[0].facts.severity, 'severe')
}))

test('Detector schemas with catastrophic regex run inside the terminable worker', async () => fixture(async registry => {
  registry.register(spec({ paramsSchema: { type: 'object', properties: { token: { type: 'string', pattern: '^(a+)+$' } }, required: ['token'], additionalProperties: false } }))
  const bad = rule({ match: { kind: 'detector', ref: 'test:letters', revision: 1, params: { token: 'a'.repeat(80) + '!' } } })
  await assert.rejects(registry.detect(input('a', [bad]), undefined, { sessionId: 's' }), /matcher-work-timeout/)
}, { timeoutMs: 500 }))

test('Detector policy races, concurrent feeds and reused session scopes cannot commit state', async () => fixture(async registry => {
  registry.register(spec())
  let current = true
  const options = { sessionId: 's', scope: 'owned-stream', epoch: 'p', current: () => current }
  const pending = registry.detect(input('a'), undefined, options)
  await assert.rejects(registry.detect(input('ab'), undefined, options), /concurrent-feed/)
  current = false
  await assert.rejects(pending, /policy-changed/)
  current = true
  assert.equal((await registry.detect(input('b'), undefined, options)).length, 0)
  await assert.rejects(registry.detect(input('b'), undefined, { ...options, sessionId: 'other' }), /session-conflict/)
  await registry.releaseBlock(options.scope, 0)
  assert.equal((await registry.detect(input('a'), undefined, options)).length, 0)
  await registry.detect(input('ab'), undefined, options)
  const disposeBad = registry.register(spec({ ref: 'bad-reset', callbacks: { ...spec().callbacks, reset() { throw new Error('reset-failed') } } }))
  const badRule = rule({ id: 'bad', match: { kind: 'detector', ref: 'bad-reset', revision: 1, params: { token: 'never' } } })
  await registry.detect(input('a', [badRule]), undefined, { ...options, scope: 'bad-reset' })
  await assert.rejects(disposeBad(), /resource-close-failed/)
  await registry.release('bad-reset') // Removed even when reset failed; independent scopes still work.
  assert.equal((await registry.detect(input('abc'), undefined, options))[0].facts.text, 'abc')
}))

test('Detector budgets reject oversized state and aggregate retention across streams', async () => fixture(async registry => {
  registry.register(spec({ maxStateBytes: 64 }))
  await assert.rejects(registry.detect(input('x'.repeat(80)), undefined, { sessionId: 's', scope: 'too-big' }), /state-budget/)
  await registry.release('too-big')
  await registry.detect(input('x'.repeat(25)), undefined, { sessionId: 's', scope: 'first' })
  await assert.rejects(registry.detect(input('x'.repeat(25)), undefined, { sessionId: 's', scope: 'second' }), /stream-state-budget/)
}, undefined, { maxStateBytes: 220 }))

test('Epoch reset holds the stream lock; explicit close during reset prevents a new state ACK', async () => fixture(async registry => {
  registry.register(spec())
  const options = { sessionId: 's', scope: 'reset-race', epoch: 'old' }
  await registry.detect(input('a'), undefined, options)
  const pending = registry.detect(input('b'), undefined, { ...options, epoch: 'new' })
  await assert.rejects(registry.detect(input('b'), undefined, { ...options, epoch: 'new' }), /concurrent-feed/)
  const rejected = assert.rejects(pending, /policy-changed/)
  await registry.release(options.scope)
  await rejected
  assert.equal((await registry.detect(input('b'), undefined, { ...options, epoch: 'new' })).length, 0)
  const resetting = registry.releaseBlock(options.scope, 0)
  await assert.rejects(registry.detect(input('bc'), undefined, { ...options, epoch: 'new' }), /concurrent-feed/)
  await Promise.all([resetting, registry.release(options.scope)])
  assert.equal((await registry.detect(input('a'), undefined, { ...options, epoch: 'new' })).length, 0)
}))

test('Reused workers preserve explicit state but recreate callback globals and honor changed schemas', async () => fixture(async registry => {
  const dispose = registry.register(spec({ callbacks: { ...spec().callbacks,
    feed({ state, delta }) {
      globalThis.visits = (globalThis.visits ?? 0) + 1
      state.text += delta; state.feeds++
      return { state, result: { ok: true, ranges: [], captures: {}, facts: { visits: globalThis.visits, feeds: state.feeds } } }
    },
  } }))
  const options = { sessionId: 's', scope: 'warm-stream', epoch: 'p' }
  assert.deepEqual((await registry.detect(input('a'), undefined, options))[0].facts, { visits: 1, feeds: 1 })
  assert.deepEqual((await registry.detect(input('ab'), undefined, options))[0].facts, { visits: 1, feeds: 2 })
  assert.deepEqual((await registry.detect(input('a'), undefined, { sessionId: 'other' }))[0].facts, { visits: 1, feeds: 1 })
  await dispose()
  // Reusing the ref/revision must not accidentally reuse the old params validator.
  registry.register(spec({ paramsSchema: { type: 'object', properties: { token: { const: 'changed' } }, required: ['token'], additionalProperties: false } }))
  await assert.rejects(registry.detect(input('ab'), undefined, { sessionId: 's' }), /detector-params-schema-invalid/)
  const changed = rule({ match: { kind: 'detector', ref: 'test:letters', revision: 1, params: { token: 'changed' } } })
  assert.equal((await registry.detect(input('changed', [changed]), undefined, { sessionId: 's' })).length, 1)
}))

test('Invalid feed evidence fails before a valid finalize can hide it; method-local arrows transfer correctly', async () => fixture(async registry => {
  const dispose = registry.register(spec({ callbacks: { ...spec().callbacks,
    feed({ state }) { return { state, result: { ok: false, ranges: [[0, 999]], captures: {} } } },
  } }))
  const completeRule = rule({ on: ['output.complete'], actions: [{ id: 'a', kind: 'notify', stage: 'output.complete', enabledDefault: true, template: 'hit' }] })
  await assert.rejects(registry.detect(input('ab', [completeRule], { stage: 'output.complete' }), undefined, { sessionId: 's' }), /invalid detector range/)
  await dispose()
  registry.register(spec({ callbacks: { ...spec().callbacks,
    feed({ state, delta }) { state.text = [state.text, delta].map(value => value).join(''); state.feeds++; return { state, result: { ok: true, ranges: [], captures: {} } } },
  } }))
  assert.equal((await registry.detect(input('a'), undefined, { sessionId: 's' })).length, 1)
}))
