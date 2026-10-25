import test from 'node:test'
import assert from 'node:assert/strict'
import { withPlanningToken } from '../lib/planning-token.js'
import { createTemplates } from '../src/templates.js'
import { createWorkbenchStore } from '../src/workbench-store.js'

test('template mutation stamps recheck original versions including same-revision remove and re-register', () => {
  const templates = createTemplates()
  const helper = { name: 'upper', revision: 1, render: value => value.toUpperCase() }
  let remove = templates.registerHelper(helper)
  const expected = JSON.stringify(templates.versions()); let reads = 0
  withPlanningToken(expected, () => [templates.tokenRevision()], () => { reads++; return JSON.stringify(templates.versions()) }, current => {
    for (let index = 0; index < 1000; index++) assert.equal(current(), true)
    const before = templates.tokenRevision()
    assert.throws(() => templates.registerHelper(helper), /conflict/)
    assert.equal(templates.tokenRevision(), before); assert.equal(current(), true); assert.equal(reads, 1)
    const old = remove; remove(); assert.equal(current(), false)
    remove = templates.registerHelper({ ...helper, render: value => helper.render(value) }); assert.equal(current(), true, 'generation is not a replacement policy token')
    old(); assert.equal(current(), true, 'stale disposer cannot remove a new registration')
    const partial = templates.registerPartial({ name: 'label', revision: 1, template: 'LABEL' })
    assert.equal(current(), false); partial(); assert.equal(current(), true)
    remove(); remove = templates.registerHelper({ ...helper, revision: 2 }); assert.equal(current(), false)
  })
  remove()
})

test('template callbacks can mutate owners synchronously and a copied renderer cannot conceal the change', () => {
  const templates = createTemplates(); let remove
  remove = templates.registerHelper({ name: 'change', revision: 1, render: () => { remove(); return 'CHANGED' } })
  const renderer = templates.fork(), expected = JSON.stringify(templates.versions())
  withPlanningToken(expected, () => [templates.tokenRevision()], () => JSON.stringify(templates.versions()), current => {
    assert.equal(current(), true)
    assert.equal(renderer.render('{{change}}', {}), 'CHANGED')
    assert.equal(current(), false)
  })
})

test('workbench mutation stamps include acknowledged automatic variables faults retries and unrelated runtime ACKs', async t => {
  let fail = false
  const templates = createTemplates()
  const store = createWorkbenchStore({ templates, save: async () => { if (fail) throw new Error('disk-full') } })
  t.after(() => store.close())
  const variable = { name: 'value', scope: 'session', type: 'number', default: 1 }
  await store.edit('one', { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'doc', revision: 1, title: 'Doc', variables: [variable] } })
  const expected = store.token('one'), revision = store.read('one').revision
  const current = () => withPlanningToken(expected, () => [store.tokenRevision()], () => store.token('one'), match => match())
  assert.equal(current(), true)
  const beforeRuntime = store.tokenRevision()
  await store.runtime('other', runtime => { runtime.state.marker = 'unrelated' })
  assert.ok(store.tokenRevision() > beforeRuntime); assert.equal(current(), true, 'runtime-only ACK is not a policy change')
  await store.automaticVariable('one', variable, 2, 'turn')
  assert.equal(store.read('one').revision, revision); assert.equal(current(), false, 'automatic variable ACK changes token without a document revision')
  await store.automaticVariable('one', variable, 1, 'turn')
  // The original token contained no explicit variable override, so setting its
  // default explicitly is still distinguishable; compare against the real token.
  assert.equal(current(), store.token('one') === expected)
  const beforeFailure = store.tokenRevision(), policy = store.token('one')
  fail = true
  await assert.rejects(store.runtime('other', () => {}), /storage-unavailable/)
  assert.ok(store.tokenRevision() > beforeFailure); assert.notEqual(store.token('one'), policy, 'existing token covers all failure keys')
  fail = false; await store.runtime('other', () => {})
  assert.equal(store.token('one'), policy, 'successful retry clears only the real failure dependency')
  const beforeClose = store.tokenRevision(), closing = store.close()
  assert.ok(store.tokenRevision() > beforeClose); assert.notEqual(store.token('one'), policy)
  await closing; assert.ok(store.tokenRevision() > beforeClose + 1)
})

test('unacknowledged writes do not invalidate tokens and scoped policy ACKs invalidate exact dependencies', async t => {
  let acknowledge
  const templates = createTemplates()
  const store = createWorkbenchStore({ templates, save: () => new Promise(resolve => { acknowledge = resolve }) })
  t.after(() => store.close())
  const declaration = { name: 'globalValue', scope: 'global', type: 'number', default: 0 }
  const edit = store.edit('one', { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'doc', revision: 1, title: 'Doc',
    variables: [declaration, { name: 'presetValue', scope: 'preset', type: 'number', default: 0 }] } })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(store.tokenRevision(), 0); acknowledge(); await edit
  const expected = store.token('one', 'preset'), stamp = store.tokenRevision()
  const pending = store.edit('one', { revision: 1, operation: 'set-variable', variable: 'globalValue', value: 2, scopeRevision: 0 })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(store.tokenRevision(), stamp); assert.equal(store.token('one', 'preset'), expected)
  acknowledge(); await pending
  assert.ok(store.tokenRevision() > stamp); assert.notEqual(store.token('one', 'preset'), expected)
  const afterGlobal = store.token('one', 'preset'), otherPreset = store.token('one', 'other-preset')
  const preset = store.edit('one', { revision: 1, operation: 'set-variable', variable: 'presetValue', value: 3, presetId: 'preset', scopeRevision: 0 })
  await Promise.resolve(); await Promise.resolve(); acknowledge(); await preset
  assert.notEqual(store.token('one', 'preset'), afterGlobal); assert.equal(store.token('one', 'other-preset'), otherPreset)
})
