import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnosticIndex, createDiagnosticRelations, createDiagnosticRecordFeed } from '../lib/diagnostic-pages.js'

test('diagnostic metadata preserves newest-first ordering, selected seq and bounded pages', () => {
  const index = createDiagnosticIndex<string>()
  for (let value = 0; value < 10000; value++) index.set({ id: `event:${value}`, order: value, seq: value, materialize: () => String(value) })
  assert.equal(index.size, 10000)
  assert.deepEqual(index.slice(0, 2).map(entry => entry.id), ['event:9999', 'event:9998'])
  assert.deepEqual(index.slice(9999, 10009).map(entry => entry.id), ['event:0'])
  assert.deepEqual(index.slice(10001, 10003), [])
  assert.equal(index.position(4), 9995)
  index.set({ id: 'z', order: 4, seq: 4, materialize: () => 'z' })
  assert.equal(index.slice(index.position(4)!, index.position(4)! + 1)[0].id, 'z')
  index.set({ id: 'z', order: 20000, seq: 6, materialize: () => 'changed' })
  assert.equal(index.position(6), 0); assert.equal(index.position(4), 9996)
  index.delete('z'); index.delete('missing')
  assert.equal(index.size, 10000); assert.equal(index.position(4), 9995)
})

test('diagnostic relations retain stable buckets and account for removal and late ownership', () => {
  let owner = 'child'
  const first = { id: 'a' }, second = { id: 'b' }, unrelated = { id: 'c' }
  const relations = createDiagnosticRelations((record: typeof first) => record === unrelated ? ['unrelated'] : [owner])
  assert.deepEqual([...relations.update([first, second, unrelated])], ['child', 'unrelated'])
  const stable = relations.get('unrelated')
  assert.deepEqual(relations.get('child'), [first, second])
  assert.equal(relations.update([first, second, unrelated]).size, 0)
  assert.equal(relations.get('unrelated'), stable)
  owner = 'parent'
  assert.deepEqual(new Set(relations.update([first, second, unrelated], true)), new Set(['child', 'parent']))
  assert.deepEqual(relations.get('child'), []); assert.deepEqual(relations.get('parent'), [first, second])
  assert.equal(relations.get('unrelated'), stable)
  relations.update([second, unrelated]); assert.deepEqual(relations.get('parent'), [second])
})

test('diagnostic record feeds coalesce pending edits and keep independent readers and old snapshots', () => {
  const feed = createDiagnosticRecordFeed<{ id: string; at: number }>((a, b) => a.at - b.at)
  const first = { id: 'a', at: 1 }, next = { id: 'a', at: 2 }, final = { id: 'a', at: 3 }, temporary = { id: 'temporary', at: 4 }
  feed.set('a', first)
  const fast = {}, slow = {}, old = feed.snapshot()
  assert.equal(feed.consume(fast).added, old); assert.equal(feed.consume(slow).added, old)
  feed.set('a', next); feed.set('a', final); feed.set('temporary', temporary); feed.delete('temporary')
  assert.deepEqual(feed.consume(fast), { added: [final], removed: [first] })
  assert.deepEqual(feed.consume(slow), { added: [final], removed: [first] })
  assert.deepEqual(old, [first]); assert.deepEqual(feed.snapshot(), [final])
  const snapshot = feed.snapshot(); feed.set('a', final); feed.delete('absent')
  assert.equal(feed.snapshot(), snapshot); assert.deepEqual(feed.consume(fast), { added: [], removed: [] })
  feed.delete('a'); feed.set('a', final)
  assert.deepEqual(feed.consume(slow), { added: [], removed: [] }, 'an unseen remove/reinsert of the same revision cancels out')
})

test('diagnostic record sorting failures preserve initial and incremental reader changes', () => {
  let fail = true
  const feed = createDiagnosticRecordFeed<{ value: number }>((a, b) => { if (fail) throw new Error('sort-unavailable'); return a.value - b.value })
  const first = { value: 1 }, second = { value: 2 }, next = { value: 3 }, last = { value: 4 }, reader = {}
  feed.set('one', first); feed.set('two', second)
  assert.throws(() => feed.consume(reader), /sort-unavailable/)
  fail = false; assert.deepEqual(feed.consume(reader).added, [first, second])
  feed.set('one', next); feed.set('two', last); fail = true
  assert.throws(() => feed.consume(reader), /sort-unavailable/)
  fail = false; assert.deepEqual(feed.consume(reader), { added: [next, last], removed: [first, second] })
})

test('diagnostic relation delta updates inspect only changed keys and preserve unrelated buckets', () => {
  const values = Array.from({ length: 1000 }, (_, at) => ({ id: String(at), at }))
  let parsed = 0
  const relations = createDiagnosticRelations((row: typeof values[number]) => { parsed++; return [row.id] }, (a, b) => a.at - b.at)
  relations.update({ added: values, removed: [] }); assert.equal(parsed, 1000)
  const stable = relations.get('1'), next = { id: '999', at: 1001 }
  relations.update({ added: [next], removed: [values[999]] })
  assert.equal(parsed, 1001); assert.equal(relations.get('1'), stable)
  assert.deepEqual(relations.get('999'), [next])
  relations.update({ added: [], removed: [] }); assert.equal(parsed, 1001)
})

test('diagnostic relations update order when existing immutable records reorder', () => {
  const first = {}, second = {}
  const relations = createDiagnosticRelations(() => ['shared'])
  relations.update([first, second]); assert.deepEqual(relations.get('shared'), [first, second])
  assert.deepEqual([...relations.update([second, first])], ['shared'])
  assert.deepEqual(relations.get('shared'), [second, first])
})
