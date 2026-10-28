import { changeClaims, hasClaim, quotaFor, ClaimBook } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

const reserve = (id, limit = 1, key = 'shared', until) => ({ key, limit, candidateId: id,
  sessionId: `session-${id}`, messageId: `message-${id}`, ...(until === undefined ? {} : { until }) })
const change = (book, operation) => changeClaims(book, { at: 100, maxBytes: 65536, ...operation })

test('sessions compete for N reservations and retrying the same message is idempotent', () => {
  const original = { buckets: [] }
  const book = change(original, { reserve: [reserve('a', 2), reserve('b', 2), reserve('c', 2)] })
  assert.equal(book.buckets[0].claims.length, 2)
  assert.equal(hasClaim(book, 'shared', 'message-c'), false)
  assert.deepEqual(change(book, { reserve: [reserve('a', 2)] }), book)
  assert.deepEqual(original, { buckets: [] })
})

test('confirmed consumption wins over rollback; only uncommitted reservations can be released', () => {
  const book = change({ buckets: [] }, { reserve: [reserve('a', 2), reserve('b', 2)] })
  const confirmed = change(book, { consume: ['message-a'], release: ['message-a', 'message-b'] })
  assert.deepEqual(confirmed.buckets[0].claims.map(item => [item.messageId, item.status]), [['message-a', 'consumed']])
  const retried = change(confirmed, { release: ['message-a'], reserve: [reserve('c', 2), reserve('d', 2)] })
  assert.equal(hasClaim(retried, 'shared', 'message-c'), true)
  assert.equal(hasClaim(retried, 'shared', 'message-d'), false)
})

test('durable unknown handoff remains occupied after serialization and a later session cannot claim it', () => {
  const book = change({ buckets: [] }, { reserve: [reserve('a')] })
  const restored = ClaimBook.parse(JSON.parse(JSON.stringify(book)))
  assert.deepEqual(change(restored, { reserve: [reserve('b')] }), book)
})

test('expired windows free their own records while lifetime claims survive', () => {
  const book = change({ buckets: [] }, { reserve: [reserve('a', 1, 'night', 200), reserve('b', 1, 'life')] })
  const next = change(book, { at: 200, reserve: [reserve('c', 1, 'next-night', 300), reserve('late', 1, 'night', 200)] })
  assert.deepEqual(next.buckets.map(item => item.key), ['life', 'next-night'])
})

test('quota identity survives source revision changes and changes only with explicit lifetime or calendar period', () => {
  const candidate = { sourceId: 's', ruleId: 'r', revision: 1,
    rule: { actions: [{ id: 'model', delivery: { model: { shared: { reset: 'lifetime', lifetime: 'release-1', limit: 2 } } } }] } }
  assert.deepEqual(quotaFor(candidate), quotaFor({ ...candidate, revision: 99 }))
  const windowed = { ...candidate, rule: { actions: [{ id: 'model', delivery: { model: { shared: { reset: 'window', limit: 1 } } } }] } }
  assert.throws(() => quotaFor(windowed), /window-identity-missing/)
  assert.notEqual(quotaFor({ ...windowed, window: { id: 'tonight', end: 200 } }).key,
    quotaFor({ ...windowed, window: { id: 'tomorrow', end: 300 } }).key)
})

test('a complete ledger exceeding its byte budget rejects without mutating the previous state', () => {
  const book = change({ buckets: [] }, { reserve: [reserve('a')] })
  const before = structuredClone(book)
  assert.throws(() => change(book, { reserve: [reserve('b', 2)], maxBytes: 1 }), /claim-budget/)
  assert.deepEqual(book, before)
})
