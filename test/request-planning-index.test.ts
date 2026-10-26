import test from 'node:test'
import assert from 'node:assert/strict'
import { orderRequestRemovals } from '../lib/request-block-index.js'
import { indexFirstRules } from '../lib/request-rule-index.js'

test('removal ordering matches the original numeric locale comparator and retains source identities', t => {
  const paths = ['0', '1', '2', '10', '12', '2.0', '2.1', '2.10', '2.10.0', '$result', '01', '1', '0.12.2', '0.12.10']
  const blocks = Array.from({ length: 4 }, (_, messageIndex) => paths.map((path, index) => ({
    id: `${messageIndex}:${index}`, view: 'model', messageIndex: messageIndex - 1, path,
  }))).flat()
  const filters = new Set(blocks.filter((_, index) => index % 5 !== 0).map(block => block.id))
  const before = [...blocks]
  const expected = blocks.filter(block => filters.has(block.id)).sort((a, b) => b.messageIndex - a.messageIndex
    || b.path.localeCompare(a.path, undefined, { numeric: true }))
  const legacy = t.mock.method(String.prototype, 'localeCompare')
  const collators = t.mock.method(Intl, 'Collator')
  const actual = orderRequestRemovals(blocks, filters)
  assert.deepEqual(actual.map(block => block.id), expected.map(block => block.id))
  assert.equal(collators.mock.callCount(), 1, 'same sort reuses its numeric collator')
  assert.equal(legacy.mock.callCount(), 0, 'no per-comparison locale options setup')
  assert.deepEqual(blocks, before); actual.forEach((block, index) => assert.equal(block, expected[index]))
  assert.deepEqual(orderRequestRemovals(blocks, new Set()), [])
  assert.deepEqual(orderRequestRemovals(blocks, new Set([blocks[0].id])), [blocks[0]])
  assert.equal(collators.mock.callCount(), 1, 'zero or one selected item needs no collator')
  orderRequestRemovals(blocks, filters); assert.equal(collators.mock.callCount(), 2, 'another sort has its own current-default-locale collator')
})

test('cascade rule index preserves first identity match and exact source boundaries with one input pass', () => {
  let reads = 0
  const rules = Array.from({ length: 1000 }, (_, index) => ({
    get sourceId() { reads++; return `source:${index % 10}` }, get id() { reads++; return `rule:${index}` }, actions: [index],
  }))
  const indexed = indexFirstRules(rules)
  assert.equal(reads, 2000)
  for (let repeat = 0; repeat < 10; repeat++) for (let index = 0; index < rules.length; index++) {
    assert.equal(indexed.get(JSON.stringify([`source:${index % 10}`, `rule:${index}`])), rules[index])
  }
  assert.equal(reads, 2000, '10,000 evidence lookups never rescan rule objects')
  const first = { sourceId: 'a:b', id: 'c', actions: ['FIRST'] }, duplicate = { ...first, actions: ['LATER'] }
  const other = { sourceId: 'a', id: 'b:c', actions: ['OTHER'] }
  const exact = indexFirstRules([first, duplicate, other])
  assert.equal(exact.get(JSON.stringify(['a:b', 'c'])), first)
  assert.equal(exact.get(JSON.stringify(['a', 'b:c'])), other)
  assert.equal(exact.get(JSON.stringify(['missing', 'c'])), undefined)
  assert.equal(indexFirstRules([duplicate]).get(JSON.stringify(['a:b', 'c'])), duplicate, 'a later pass indexes its actual rules')
})
