import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRuleAnswer } from '../lib/reminder-runtime/evaluation.js'
import { codeForFailure } from '../lib/reminder-runtime/denial.js'

// Actual non-cooperating execution, thread exit, round exhaustion, and suffix
// continuation are exercised in reminder-execution-real.test.ts. A never-settling
// fake execute Promise cannot establish any of those worker guarantees.
// Here the inputs are protocol data; no execution or persistence service is mocked.
test('one invalid item does not alter a separately parsed valid result', () => {
  const broken = parseRuleAnswer({ key: 'broken', ms: 1, match: { not: 'a result' } })
  const good = parseRuleAnswer({ key: 'good', ms: 2, match: { ok: true } })
  assert.ok(broken.error instanceof Error)
  assert.equal(broken.error.message, 'reminder-result-invalid')
  assert.equal(broken.match, undefined)
  assert.equal(good.error, undefined)
  assert.equal(good.match?.ok, true)
})

test('untrusted item shapes fail validation before becoming rule answers', () => {
  const invalid: unknown[] = [null, [], {}, 1, 'not an item',
    { key: 'missing-match', ms: 1 },
    { key: 'negative-time', ms: -1, match: { ok: true } }]
  for (const value of invalid) {
    const answer = parseRuleAnswer(value)
    assert.ok(answer.error instanceof Error)
    assert.equal(answer.error.message, 'reminder-result-invalid')
    assert.equal(answer.match, undefined)
  }
})

test('a worker-reported item failure retains its original diagnostic data', () => {
  const error = { name: 'Error', message: 'judge-failed' }
  const answer = parseRuleAnswer({ key: 'broken', ms: 3, error })
  assert.deepEqual(answer.error, error)
  assert.equal(answer.match, undefined)
})

test('startup, rule timeout, and round timeout remain separate failure categories', () => {
  assert.equal(codeForFailure('matcher-startup-timeout'), 'matcher-startup')
  assert.equal(codeForFailure('matcher-worker-exited:1'), 'matcher-startup')
  assert.equal(codeForFailure('matcher-work-timeout'), 'rule-timeout')
  assert.equal(codeForFailure('reminder-rule-timeout'), 'rule-timeout')
  assert.equal(codeForFailure('reminder-round-timeout'), 'round-timeout')
  assert.equal(codeForFailure('boom'), 'rule-failed')
})
