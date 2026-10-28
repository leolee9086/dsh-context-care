import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuleControls } from '@leolee9086/dsh-rule-engine'

test('indexed batch decisions make no linear identity searches across recursive dependencies and nested sessions retain separate preferences', async t => {
  const pref = (sourceId, ruleId, actions = {}, paused = false) => ({ sourceId, ruleId, actions, paused, sinceSeq: 7, epoch: 1 })
  const controls = createRuleControls({ save: async () => {}, entries: [
    ['one', { revision: 1, preferences: [pref('external', 'rule', { first: false }), pref('a:b', 'c', {}, true), pref('a', 'b:c')] }],
    ['two', { revision: 1, preferences: [pref('external', 'rule')] }],
  ] }); t.after(() => controls.close())
  const off = controls.register(source()); t.after(off)
  for (const [sourceId, id] of [['a:b', 'c'], ['a', 'b:c']]) controls.register({ sourceId, plugin: 'test', registration: 'test', executor: 'test', rules: [{ id, actions: [{ id: 'same' }] }] })
  controls.withDecisions('one', select => {
    const originalFind = Array.prototype.find; let linearFinds = 0
    Array.prototype.find = function (...args) { linearFinds++; return Reflect.apply(originalFind, this, args) }
    try {
      for (let i = 0; i < 1000; i++) {
        assert.equal(select('external', 'rule', 'dependent').reason, 'dependency-disabled')
        assert.equal(select('external', 'rule', 'first').reason, 'action-disabled')
        assert.equal(select('a:b', 'c', 'same').reason, 'rule-paused')
        assert.equal(select('a', 'b:c', 'same').enabled, true)
        assert.equal(controls.sinceSeq('one', 'external', 'rule'), 7)
        assert.equal(controls.epoch('one', 'external', 'rule'), '0:1:false')
      }
      assert.equal(linearFinds, 0, 'identity/epoch lookups share one synchronous structural directory, never Array.find')
    } finally { Array.prototype.find = originalFind }
    controls.withDecisions('two', nested => assert.equal(nested('external', 'rule', 'dependent').enabled, true))
    assert.equal(select('external', 'rule', 'dependent').reason, 'dependency-disabled', 'nested session restores parent preferences')
  })
  await controls.patch('one', { revision: 1, sourceId: 'external', ruleId: 'rule', actionId: 'first', enabled: true })
  controls.withDecisions('one', select => assert.equal(select('external', 'rule', 'dependent').enabled, true))
  assert.equal(controls.decision('one', 'missing', 'rule', 'first').reason, 'source-unavailable')
})

test('same indexed identity still reads live action availability and storage close in the synchronous batch', async t => {
  const controls = createRuleControls({ save: async () => {} }); t.after(() => controls.close())
  controls.register(source())
  const current = controls.catalog('one')[0].rules[0].actions[0]
  controls.withDecisions('one', select => {
    assert.equal(select('external', 'rule', 'dependent').enabled, true)
    current.available = false; current.reason = 'live-executor-gone'
    assert.equal(select('external', 'rule', 'first').reason, 'live-executor-gone')
    assert.equal(select('external', 'rule', 'dependent').reason, 'dependency-disabled')
    current.available = true; assert.equal(select('external', 'rule', 'dependent').enabled, true)
    void controls.close()
    assert.equal(select('external', 'rule', 'dependent').reason, 'storage-unavailable')
  })
})

test('batch checks storage before missing source after failure and close and still sees synchronous source removal', async t => {
  const controls = createRuleControls({ save: async () => { throw new Error('disk-full') } }); t.after(() => controls.close())
  const remove = controls.register(source())
  await assert.rejects(controls.patch('one', { revision: 0, sourceId: 'external', ruleId: 'rule', paused: true }), /storage-unavailable/)
  controls.withDecisions('one', select => {
    assert.equal(select('missing', 'missing', 'missing').reason, 'storage-unavailable')
    remove(); assert.equal(select('external', 'rule', 'first').reason, 'storage-unavailable')
  })
  await controls.close()
  controls.withDecisions('fresh', select => assert.equal(select('missing', 'missing', 'missing').reason, 'storage-unavailable'))
})

const source = () => ({ sourceId: 'external', plugin: 'example', registration: 'test', executor: 'test',
  rules: [{ id: 'rule', actions: [{ id: 'first' }, { id: 'dependent', requires: ['first'] }] }] })

test('synchronous control decisions read a provider once per pass and retain preferences and dependencies', async t => {
  let reads = 0, available = true
  const controls = createRuleControls({ save: async () => {} }); t.after(() => controls.close())
  controls.registerProvider(id => { reads++; const value = source(); value.sessionId = 'one';
    value.rules[0].actions[0].available = available; value.rules[0].actions[0].reason = 'executor-gone'; return [value] })
  let escaped
  const run = () => controls.withDecisions('one', select => {
    escaped = select
    for (let index = 0; index < 1000; index++) assert.equal(select('external', 'rule', 'dependent').enabled, true)
    return 42
  })
  assert.equal(run(), 42); assert.equal(reads, 1)
  assert.throws(() => escaped('external', 'rule', 'first'), /batch-closed/)
  const patch = input => controls.patch('one', { revision: controls.revision('one'), sourceId: 'external', ruleId: 'rule', ...input })
  await patch({ actionId: 'first', enabled: false })
  const before = reads
  controls.withDecisions('one', select => {
    assert.equal(select('external', 'rule', 'first').reason, 'action-disabled')
    assert.equal(select('external', 'rule', 'dependent').reason, 'dependency-disabled')
    assert.equal(select('missing', 'rule', 'first').reason, 'source-unavailable')
  })
  assert.equal(reads, before + 1)
  await patch({ paused: true })
  controls.withDecisions('one', select => assert.equal(select('external', 'rule', 'dependent').reason, 'rule-paused'))
  await patch({ reset: true }); available = false
  controls.withDecisions('one', select => assert.equal(select('external', 'rule', 'first').reason, 'executor-gone'))
  controls.withDecisions('other', select => assert.equal(select('external', 'rule', 'first').reason, 'source-unavailable'))
  available = true; assert.equal(run(), 42)
})

test('control batches retain live storage and removal checks and never publish an async or failed batch', async t => {
  let fails = true
  const controls = createRuleControls({ save: async () => { if (fails) throw new Error('disk-full') } }); t.after(() => controls.close())
  const remove = controls.register(source())
  let escaped
  assert.throws(() => controls.withDecisions('one', select => { escaped = select; throw new Error('plan-failed') }), /plan-failed/)
  assert.throws(() => escaped('external', 'rule', 'first'), /batch-closed/)
  assert.throws(() => controls.withDecisions('one', select => { escaped = select; return Promise.resolve() }), /must-be-synchronous/)
  assert.throws(() => escaped('external', 'rule', 'first'), /batch-closed/)
  await assert.rejects(controls.patch('one', { revision: 0, sourceId: 'external', ruleId: 'rule', paused: true }), /storage-unavailable/)
  controls.withDecisions('one', select => assert.equal(select('external', 'rule', 'first').reason, 'storage-unavailable'))
  fails = false
  await controls.patch('one', { revision: 0, sourceId: 'external', ruleId: 'rule', reset: true })
  controls.withDecisions('one', select => assert.equal(select('external', 'rule', 'first').enabled, true))
  controls.withDecisions('one', select => {
    assert.equal(select('external', 'rule', 'first').enabled, true)
    remove()
    assert.equal(select('external', 'rule', 'first').reason, 'source-unavailable', 'synchronous removal also invalidates an in-progress batch')
  })
  controls.withDecisions('one', select => assert.equal(select('external', 'rule', 'first').reason, 'source-unavailable'))
  await controls.close()
  controls.withDecisions('one', select => assert.equal(select('external', 'rule', 'first').reason, 'storage-unavailable'))
})
