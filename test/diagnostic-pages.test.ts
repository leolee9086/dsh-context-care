import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnosticIndex, createDiagnosticRelations } from '../lib/diagnostic-pages.js'

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

test('diagnostic relations update order when existing immutable records reorder', () => {
  const first = {}, second = {}
  const relations = createDiagnosticRelations(() => ['shared'])
  relations.update([first, second]); assert.deepEqual(relations.get('shared'), [first, second])
  assert.deepEqual([...relations.update([second, first])], ['shared'])
  assert.deepEqual(relations.get('shared'), [second, first])
})
