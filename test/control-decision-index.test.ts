import test from 'node:test'
import assert from 'node:assert/strict'
import { indexFirstControlIds, indexControlSources, createControlPreferenceIndex } from '../lib/control-decision-index.js'

test('control identity directories build only accessed sources and rules once and preserve first exact identities', () => {
  let ruleReads = 0, actionReads = 0
  const actions = Array.from({ length: 1000 }, (_, index) => ({ get id() { actionReads++; return `action:${index}` } }))
  const rules = Array.from({ length: 100 }, (_, index) => ({ get id() { ruleReads++; return `rule:${index}` }, actions }))
  let unrelated = 0
  const sources = [{ sourceId: 'a:b', rules }, { sourceId: 'a', get rules() { unrelated++; return [{ id: 'b:c', actions: [{ id: 'same' }] }] } }]
  const directory = indexControlSources(sources)
  assert.equal(ruleReads, 0); assert.equal(actionReads, 0); assert.equal(unrelated, 0)
  const first = directory.get('a:b', 'rule:99')!
  const counted = { ruleReads, actionReads }
  assert.equal(counted.ruleReads, 101); assert.equal(counted.actionReads, 1000)
  for (let repeat = 0; repeat < 10; repeat++) for (let index = 0; index < 1000; index++) {
    assert.equal(directory.get('a:b', 'rule:99'), first); assert.equal(first.actions.get(`action:${index}`), actions[index])
  }
  assert.equal(ruleReads, counted.ruleReads); assert.equal(actionReads, counted.actionReads); assert.equal(unrelated, 0)
  assert.equal(directory.get('missing', 'rule:99'), undefined); assert.equal(directory.get('a:b', 'missing'), undefined)
  assert.equal(directory.get('a', 'b:c')?.actions.get('same')?.id, 'same'); assert.equal(unrelated, 1)
  const duplicate = { id: 'first' }, later = { id: 'first' }
  assert.equal(indexFirstControlIds([duplicate, later]).get('first'), duplicate)
  directory.clear(); assert.equal(directory.get('a:b', 'rule:99'), undefined)
  const shared = { id: 'shared', actions: [{ id: 'same' }] }
  const aliases = indexControlSources([{ sourceId: 'left', rules: [shared] }, { sourceId: 'right', rules: [shared] }])
  assert.equal(aliases.get('left', 'shared')?.sourceId, 'left'); assert.equal(aliases.get('right', 'shared')?.sourceId, 'right')
  aliases.clear()
})

test('failed preference identity rebuild is unpublished and retries the exact current ACK record', () => {
  let broken = true
  const first = { sourceId: 's', ruleId: 'first' }
  const second = { sourceId: 's', get ruleId() { if (broken) throw new Error('identity-unavailable'); return 'second' } }
  const record = { preferences: [first, second] }, index = createControlPreferenceIndex(() => record)
  assert.throws(() => index.get('s', 'first'), /identity-unavailable/)
  broken = false
  assert.equal(index.get('s', 'first'), first); assert.equal(index.get('s', 'second'), second)
  index.clear()
})

test('preference index uses exact source-rule tuples first duplicates and ACK identity changes without caching decisions', () => {
  let reads = 0
  const pref = (sourceId: string, ruleId: string, paused = false) => ({ get sourceId() { reads++; return sourceId }, get ruleId() { reads++; return ruleId }, paused })
  const first = pref('a:b', 'c'), other = pref('a', 'b:c'), duplicate = pref('a:b', 'c', true)
  let record: { preferences: ReturnType<typeof pref>[] } | undefined = { preferences: [first, other, duplicate] }
  const index = createControlPreferenceIndex(() => record)
  assert.equal(index.get('a:b', 'c'), first); assert.equal(index.get('a', 'b:c'), other); assert.equal(reads, 6)
  for (let i = 0; i < 10000; i++) assert.equal(index.get('a:b', 'c'), first)
  assert.equal(reads, 6)
  const changed = pref('a:b', 'c', true); record = { preferences: [changed] }
  assert.equal(index.get('a:b', 'c'), changed); assert.equal(reads, 8); assert.equal(index.get('a', 'b:c'), undefined)
  record = undefined; assert.equal(index.get('a:b', 'c'), undefined)
  index.clear(); record = { preferences: [first] }; assert.equal(index.get('a:b', 'c'), first); assert.equal(reads, 10)
})
