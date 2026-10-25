import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuleControls } from '../src/rule-controls.js'

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
