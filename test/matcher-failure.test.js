import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoundedMatcher, MatcherFailure } from '../src/bounded-matcher.js'
import { normalizeRuleV2 } from '@leolee9086/dsh-rule-engine'

const rule = pattern => normalizeRuleV2({ schemaVersion: 2, sourceId: 'failure-test', id: 'regex', revision: 1,
  on: ['output.complete'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
  match: { kind: 'regex', pattern }, actions: [{ id: 'notify', kind: 'notify', stage: 'output.complete', enabledDefault: true, template: 'match' }] })
const input = pattern => ({ stage: 'output.complete', rules: [rule(pattern)],
  blocks: [{ id: 'b', sessionId: 's', role: 'assistant', view: 'original', type: 'text', text: 'a'.repeat(1000) + '!' }] })

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
