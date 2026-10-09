import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuleControls, ControlPatch } from '../src/rule-controls.js'
import { createStreamWatch } from '../src/stream-watch.js'
import { createNoticeChannel } from '../src/notice-channel.js'
import { controlledGuidance, controlledState, controlledEngineRules } from '../src/control-catalog.js'
import { GUIDANCE, renderState } from '../src/policy.js'
const source = (id = 'external') => ({ sourceId: id, plugin: 'example-plugin', registration: 'plugin-entry', executor: 'dsh-context-care',
  rules: [{ id: 'shared-id', actions: [{ id: 'notice' }, { id: 'abort' }, { id: 'resume', requires: ['abort'] }] }] })
const patch = (controls, input) => controls.patch('session-one', { revision: controls.snapshot('session-one').revision, sourceId: 'external', ruleId: 'shared-id', ...input })

test('session CAS, independent actions, pause and reset survive restart without publishing unacknowledged writes', async () => {
  const entries = new Map()
  let acknowledge
  const controls = createRuleControls({ save: (id, value) => new Promise(resolve => { acknowledge = () => { entries.set(id, value); resolve() } }) })
  controls.register(source())
  const pending = patch(controls, { actionId: 'notice', enabled: false })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(controls.enabled('session-one', 'external', 'shared-id', 'notice'), true)
  acknowledge(); await pending
  assert.equal(controls.enabled('session-one', 'external', 'shared-id', 'notice'), false)
  assert.equal(controls.enabled('session-two', 'external', 'shared-id', 'notice'), true)
  const restored = createRuleControls({ entries: [...entries], save: async (id, value) => entries.set(id, value) })
  restored.register(source())
  await patch(restored, { paused: true })
  assert.equal(restored.enabled('session-one', 'external', 'shared-id', 'abort'), false)
  await patch(restored, { paused: false })
  assert.equal(restored.enabled('session-one', 'external', 'shared-id', 'notice'), false)
  await patch(restored, { actionId: 'abort', enabled: false })
  assert.equal(restored.decision('session-one', 'external', 'shared-id', 'resume').reason, 'dependency-disabled')
  await patch(restored, { reset: true })
  assert.equal(restored.enabled('session-one', 'external', 'shared-id', 'notice'), true)
  const revision = restored.snapshot('session-one').revision
  const updates = await Promise.allSettled([restored.patch('session-one', { revision, sourceId: 'external', ruleId: 'shared-id', paused: true }),
    restored.patch('session-one', { revision, sourceId: 'external', ruleId: 'shared-id', paused: false })])
  assert.equal(updates[0].status, 'fulfilled')
  assert.equal(updates[1].reason.status, 409)
})

test('failed storage cannot appear saved or execute through stale values; retry recovers explicitly', async () => {
  let fails = true
  const controls = createRuleControls({ save: async () => { if (fails) throw new Error('disk-full') } })
  controls.register(source())
  await assert.rejects(patch(controls, { actionId: 'notice', enabled: false }), error => error.code === 'storage-unavailable')
  assert.equal(controls.snapshot('session-one').revision, 0)
  assert.equal(controls.snapshot('session-one').storageError, 'storage-unavailable')
  assert.equal(controls.enabled('session-one', 'external', 'shared-id', 'abort'), false)
  fails = false
  await patch(controls, { actionId: 'notice', enabled: false })
  assert.equal(controls.enabled('session-one', 'external', 'shared-id', 'abort'), true)
  assert.equal(controls.snapshot('session-one').storageError, undefined)
})

test('namespaced registrations, unload and re-registration preserve attribution and preferences', async () => {
  const controls = createRuleControls({ save: async () => {} })
  const off = controls.register(source())
  controls.register(source('another'))
  assert.throws(() => controls.register(source()), /duplicate source/)
  await patch(controls, { actionId: 'notice', enabled: false })
  off()
  assert.equal(controls.enabled('session-one', 'external', 'shared-id', 'notice'), false)
  controls.register(source())
  off()
  assert.equal(controls.snapshot('session-one').sources.find(item => item.sourceId === 'external').plugin, 'example-plugin')
  assert.equal(controls.enabled('session-one', 'external', 'shared-id', 'notice'), false)
  assert.equal(controls.enabled('session-one', 'another', 'shared-id', 'notice'), true)
  assert.throws(() => ControlPatch.parse({ revision: 0, sourceId: 'x', ruleId: 'y', actionId: 'z' }))
})

test('dynamic streaming toggles reset evidence, disabled actions do not consume a hit, resume needs successful abort', () => {
  let enabled = false
  let epoch = 0
  const hits = []
  const trigger = { id: 'phrase', kind: 'marker', token: 'MATCH', actions: ['notice', 'abort', 'resume'] }
  const watch = createStreamWatch({ triggers: [trigger], enabled: (_agent, _trigger, action) => action === 'notice' && enabled,
    epoch: () => epoch, actions: { notice: () => hits.push('notice'), abort: () => hits.push('abort'), resume: () => hits.push('resume') } })
  const agent = { id: 'a' }
  const delta = text => watch.observe(agent, { type: 'chunk', chunk: { type: 'text-delta', text } })
  watch.observe(agent, { type: 'start' })
  delta('MATCH'); delta('MA')
  assert.deepEqual(watch.inspect().a.fired, [])
  enabled = true; epoch++
  delta('TCH')
  assert.deepEqual(hits, [])
  delta('MATCH')
  assert.deepEqual(hits, ['notice'])
})

test('notification delivery checks policy again after awaited source and keeps source namespaces separate', async () => {
  const channel = createNoticeChannel()
  let deliver
  let active = true
  channel.register('pending', () => new Promise(resolve => { deliver = resolve }), { plugin: 'third-party' })
  const pending = channel.collect({ agentId: 'a' }, { enabled: () => active })
  active = false
  deliver([{ id: 'same-id', text: 'old' }])
  assert.deepEqual(await pending, [])
  assert.equal(channel.catalog()[0].plugin, 'third-party')
  const fresh = createNoticeChannel()
  fresh.register('one', () => [{ id: 'same-id', text: 'one' }])
  fresh.register('two', () => [{ id: 'same-id', text: 'two' }])
  assert.equal((await fresh.collect({ agentId: 'a' })).length, 2)
})

test('default guidance stays exact; disabled report keeps explicit operation facts with independently selected advice', () => {
  assert.equal(controlledGuidance(() => true), GUIDANCE)
  assert.equal(controlledGuidance(() => false), '')
  const state = { fatigue: 'high', wakefulness: 'high' }
  assert.equal(controlledState(state, undefined, () => true), renderState(state))
  assert.equal(controlledState(state, undefined, () => false), '')
  assert.match(controlledState(state, '真实结果', () => false, true), /真实结果/)
  assert.doesNotMatch(controlledState(state, '真实结果', () => false, true), /写细交接/)
})

test('dependency cycles reject registration and transitive dependencies control execution', async () => {
  const controls = createRuleControls({ save: async () => {} })
  const cyclic = source()
  cyclic.rules[0].actions[0].requires = ['resume']
  cyclic.rules[0].actions[1].requires = ['notice']
  assert.throws(() => controls.register(cyclic), /cyclic/)
  const chained = source()
  chained.rules[0].actions[1].requires = ['notice']
  controls.register(chained)
  await patch(controls, { actionId: 'notice', enabled: false })
  assert.equal(controls.enabled('session-one', 'external', 'shared-id', 'resume'), false)
})

test('old user evidence does not replay after enabling, and foreign consumers retain ownership', async () => {
  const controls = createRuleControls({ save: async () => {}, boundary: () => 42 })
  controls.register({ sourceId: 'a', plugin: 'a', registration: 'entry', executor: 'dsh-context-care', rules: [
    { id: 'fresh', actions: [{ id: 'notify' }], definition: { order: 1, action: { kind: 'notify', by: 'context-care' } } },
    { id: 'foreign', actions: [{ id: 'notify' }], definition: { action: { kind: 'notify', by: 'foreign-executor' } } }] })
  await controls.patch('s', { revision: 0, sourceId: 'a', ruleId: 'fresh', actionId: 'notify', enabled: false })
  await controls.patch('s', { revision: 1, sourceId: 'a', ruleId: 'fresh', actionId: 'notify', enabled: true })
  assert.deepEqual(controlledEngineRules(controls, 's', 'notify', { userSeq: 40 }), [])
  assert.equal(controlledEngineRules(controls, 's', 'notify', { userSeq: 43 }).length, 1)
  assert.equal(controlledEngineRules(controls, 's', 'notify', {}).length, 1)
})

test('malformed engine definitions fail registration and dynamic catalog validation', () => {
  const controls = createRuleControls({ save: async () => {} })
  const invalid = { sourceId: 'bad', plugin: 'bad', registration: 'entry', executor: 'dsh-context-care',
    rules: [{ id: 'r', actions: [{ id: 'notify' }], definition: { action: { kind: 'notify', by: 'context-care' } } }] }
  assert.throws(() => controls.register(invalid), /order/)
  const off = controls.registerProvider(() => [invalid])
  assert.throws(() => controls.catalog('s'), /order/)
  off()
  invalid.rules[0].definition.order = 1
  invalid.rules[0].actions = [{ id: 'notice' }]
  assert.throws(() => controls.register(invalid), /missing control action notify/)
})

test('third-party engine definitions are qualified before execution, preserving same IDs from different plugins', () => {
  const controls = createRuleControls({ save: async () => {} })
  for (const sourceId of ['a', 'b']) controls.register({ sourceId, plugin: sourceId, registration: 'entry', executor: 'context-care',
    rules: [{ id: 'same', actions: [{ id: 'notify' }], definition: { id: 'same', order: 1, action: { kind: 'notify', by: 'context-care', say: sourceId } } }] })
  const rules = controlledEngineRules(controls, 's', 'notify')
  assert.equal(new Set(rules.map(rule => rule.id)).size, 2)
})
