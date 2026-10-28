import { withPlanningToken } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

test('planning token serializes unchanged owners once per synchronous pass and rejects escaped predicates', () => {
  let reads = 0
  let escaped: (() => boolean) | undefined
  const stamp = () => [1, 'preset', undefined, false]
  const token = () => { reads++; return 'original' }
  const run = () => withPlanningToken('original', stamp, token, current => {
    escaped = current
    for (let index = 0; index < 1000; index++) assert.equal(current(), true)
    return 42
  })
  assert.equal(run(), 42); assert.equal(reads, 1)
  assert.throws(() => escaped?.(), /pass-closed/)
  assert.equal(run(), 42); assert.equal(reads, 2, 'a new pass never borrows an old match')
})

test('every changed dependency rechecks exact token and permits unrelated mutations and restored equality', () => {
  let values: readonly unknown[] = [0, 'session', 'preset', 0, 0, 0, 0, '0:0:false', 0]
  let text = 'original', reads = 0
  withPlanningToken('original', () => values, () => { reads++; return text }, current => {
    assert.equal(current(), true)
    for (let index = 0; index < values.length; index++) {
      values = values.map((value, at) => at === index ? `changed:${index}` : value)
      text = 'changed'
      assert.equal(current(), false); assert.equal(current(), false)
      values = [...values, index]; text = 'original'
      assert.equal(current(), true, 'stamps invalidate work but never replace exact equality')
      values = values.slice(0, -1)
      assert.equal(current(), true, 'the next unrelated revision must be checked too')
    }
  })
  assert.equal(reads, 28)
})

test('failed exact reads are retried and failed passes cannot retain successful predicates', () => {
  let revision = 0, fail = false, reads = 0
  let escaped: (() => boolean) | undefined
  assert.throws(() => withPlanningToken('original', () => [revision], () => {
    reads++; if (fail) throw new Error('token-read-failed'); return 'original'
  }, current => {
    escaped = current; assert.equal(current(), true)
    revision++; fail = true
    assert.throws(current, /token-read-failed/)
    fail = false; assert.equal(current(), true); assert.equal(reads, 3)
    throw new Error('planning-failed')
  }), /planning-failed/)
  assert.throws(() => escaped?.(), /pass-closed/)
})

test('planning token refuses asynchronous ownership and closes predicates even when a pass returns a promise', () => {
  let escaped: (() => boolean) | undefined
  assert.throws(() => withPlanningToken('original', () => [], () => 'original', current => {
    escaped = current; return Promise.resolve(1)
  }), /must-be-synchronous/)
  assert.throws(() => escaped?.(), /pass-closed/)
})
