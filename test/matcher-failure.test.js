import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createBoundedMatcher, MatcherFailure } from '../src/bounded-matcher.js'
import { normalizeRuleV2 } from '@leolee9086/dsh-rule-engine'

const rule = pattern => normalizeRuleV2({ schemaVersion: 2, sourceId: 'failure-test', id: 'regex', revision: 1,
  on: ['output.complete'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
  match: { kind: 'regex', pattern }, actions: [{ id: 'notify', kind: 'notify', stage: 'output.complete', enabledDefault: true, template: 'match' }] })
const input = pattern => ({ stage: 'output.complete', rules: [rule(pattern)],
  blocks: [{ id: 'b', sessionId: 's', role: 'assistant', view: 'original', type: 'text', text: 'a'.repeat(1000) + '!' }] })

test('matching starts from a parent with process-only flags and an inline module entry', async () => {
  // These flags belong to the parent process and Node rejects them in Worker.execArgv.
  const source = `
    import assert from 'node:assert/strict'
    import { createBoundedMatcher } from ${JSON.stringify(new URL('../src/bounded-matcher.js', import.meta.url).href)}
    const matcher = createBoundedMatcher()
    try { assert.equal((await matcher.detect(${JSON.stringify(input('!$'))})).length, 1) }
    finally { await matcher.close() }
  `
  await promisify(execFile)(process.execPath, ['--stack-trace-limit=10', '--input-type=module', '--eval', source], { timeout: 10000 })
})

test('an empty or unrelated stage performs no worker work, even with oversized history', async t => {
  const matcher = createBoundedMatcher({ maxBytes: 1 })
  t.after(() => matcher.close())
  assert.deepEqual(await matcher.detect({ stage: 'tool.before-execute', rules: [], blocks: [{ text: 'a'.repeat(5000000) }] }), [])
  assert.deepEqual(await matcher.detect({ ...input('a'), stage: 'tool.before-execute' }), [])
  assert.equal(matcher.getStats().workersStarted, 0)
})

test('a real pathological regex times out with identity and timing, terminates, then independent matching works', async t => {
  const matcher = createBoundedMatcher({ timeoutMs: 150 })
  t.after(() => matcher.close())
  await assert.rejects(matcher.detect(input('(a+)+$')), error => {
    assert.ok(error instanceof MatcherFailure)
    assert.equal(error.message, 'matcher-work-timeout')
    assert.equal(error.code, 'CONTEXT_CARE_MATCH_FAILED')
    assert.equal(error.diagnostic.stage, 'output.complete')
    assert.deepEqual(error.diagnostic.rules, [{ sourceId: 'failure-test', ruleId: 'regex', revision: 1 }])
    assert.equal(error.diagnostic.blockCount, 1)
    assert.ok(error.diagnostic.inputBytes > 1000)
    assert.ok(error.diagnostic.elapsedMs > 0)
    assert.ok(!JSON.stringify(error.diagnostic).includes('a'.repeat(100)))
    return true
  })
  assert.equal(matcher.getStats().active, 0)
  assert.equal(matcher.getStats().idle, 0)
  assert.equal(matcher.getStats().failed, 1)
  assert.equal((await matcher.detect(input('!$'))).length, 1)
  assert.equal(matcher.getStats().workersStarted, 2)
})

test('real concurrent overload reports admission failure without cancelling admitted workers', async t => {
  const matcher = createBoundedMatcher({ timeoutMs: 200, maxPending: 2 })
  t.after(() => matcher.close())
  // Attach rejection handlers immediately; both admitted workers really execute unbounded regexes.
  const first = matcher.detect(input('(a+)+$')).catch(error => error)
  const second = matcher.detect(input('(a+)+$')).catch(error => error)
  await assert.rejects(matcher.detect(input('!$')), error => {
    assert.equal(error.message, 'matcher-capacity-exceeded')
    assert.equal(error.diagnostic.phase, 'admission')
    assert.equal(error.diagnostic.activeOperations, 2)
    return true
  })
  const errors = await Promise.all([first, second])
  assert.ok(errors.every(error => error.message === 'matcher-work-timeout'))
  assert.equal(matcher.getStats().active, 0)
  assert.equal((await matcher.detect(input('!$'))).length, 1)
})

test('a warmed pool preserves four hot workers and replenishes a terminated CPU worker', async t => {
  const matcher = createBoundedMatcher({ maxPending: 4, maxIdle: 4 })
  t.after(() => matcher.close())
  await matcher.warmup()
  assert.equal(matcher.getStats().idle, 4)
  const initial = matcher.getStats().workersStarted
  let dispatches = 0
  for (let i = 0; i < 8; i++) assert.equal((await matcher.detect(input('!$'), undefined,
    { onDispatch: () => dispatches++, workTimeoutMs: 50 })).length, 1)
  assert.equal(dispatches, 8)
  assert.equal(matcher.getStats().workersStarted, initial)
  await assert.rejects(matcher.detect(input('(a+)+$'), undefined, { workTimeoutMs: 50 }), error => {
    assert.match(error.message, /work-timeout/)
    assert.equal(error.diagnostic.phase, 'processing')
    return true
  })
  const until = Date.now() + 10000
  while (matcher.getStats().idle !== 4 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(matcher.getStats().idle, 4)
  assert.equal(matcher.getStats().workersStarted, initial + 1)
  assert.equal((await matcher.detect(input('!$'))).length, 1)
})

test('cancellation while starting preserves startup diagnostic and closes all preparation work', async t => {
  const matcher = createBoundedMatcher()
  t.after(() => matcher.close())
  const controller = new AbortController()
  const pending = matcher.detect(input('!$'), controller.signal)
  controller.abort(new Error('reminder-round-timeout'))
  await assert.rejects(pending, error => {
    assert.equal(error.diagnostic.phase, 'startup')
    assert.equal(error.diagnostic.roundTripMs, null)
    return true
  })
  await matcher.close()
  assert.equal(matcher.getStats().active, 0)
  assert.equal(matcher.getStats().idle, 0)
})

test('four real tasks can take over preparation without losing admission slots or creating extra workers', async t => {
  const matcher = createBoundedMatcher({ maxPending: 4, maxIdle: 4 })
  t.after(() => matcher.close())
  const preparation = matcher.warmup()
  await Promise.resolve()
  assert.equal(matcher.getStats().preparing, 4)
  assert.equal(matcher.getStats().active, 0)
  const work = Array.from({ length: 4 }, () => matcher.detect(input('!$')))
  const results = await Promise.all(work)
  await preparation
  assert.ok(results.every(result => result.length === 1))
  assert.equal(matcher.getStats().workersStarted, 4)
  assert.equal(matcher.getStats().idle, 4)
})

test('close drains workers still in preparation', async () => {
  const matcher = createBoundedMatcher({ maxPending: 4, maxIdle: 4 })
  const preparation = matcher.warmup().catch(error => error)
  await Promise.resolve()
  await matcher.close()
  assert.match((await preparation).message, /closed/)
  assert.equal(matcher.getStats().preparing, 0)
  assert.equal(matcher.getStats().idle, 0)
  assert.equal(matcher.getStats().active, 0)
})
