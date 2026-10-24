import test from 'node:test'
import assert from 'node:assert/strict'
import { createControlRecords } from '../src/control-records.js'
const turn = () => new Promise(resolve => setImmediate(resolve))
const response = (id, revision = 0) => ({ ok: true, json: async () => ({ sessionId: id, revision, sources: [] }) })

test('saving retains acknowledged preferences and failures stay visible across change notifications until successful retry', async () => {
  let changed
  let finish
  let failure = true
  const records = createControlRecords({ changes: { subscribe(id, listener) { assert.equal(id, 'one'); changed = listener; return () => {} } },
    fetcher: async (_url, options) => options.method === 'PATCH'
      ? new Promise(resolve => { finish = () => resolve(failure ? { ok: false, status: 409, json: async () => ({ error: 'revision-conflict' }) } : response('one', 1)) })
      : response('one') })
  const unwatch = records.watch('one')
  try {
    await turn()
    const saving = records.change('one', { sourceId: 's', ruleId: 'r', paused: true })
    assert.equal(records.source.getSnapshot().get('one').revision, 0)
    assert.equal(records.source.getSnapshot().get('one').saving, true)
    finish(); await saving
    assert.equal(records.source.getSnapshot().get('one').status, 'error')
    assert.match(records.source.getSnapshot().get('one').error, /409/)
    changed(['controls']); await turn()
    assert.equal(records.source.getSnapshot().get('one').status, 'ready')
    assert.match(records.source.getSnapshot().get('one').error, /409/)
    failure = false
    const retry = records.change('one', { sourceId: 's', ruleId: 'r', paused: true })
    finish(); await retry
    assert.equal(records.source.getSnapshot().get('one').revision, 1)
    assert.equal(records.source.getSnapshot().get('one').saved, true)
    assert.equal(records.source.getSnapshot().get('one').error, undefined)
  } finally { unwatch(); records.dispose() }
})

test('malformed nested rule responses remain visible errors before reaching the view', async () => {
  const records = createControlRecords({ fetcher: async () => ({ ok: true,
    json: async () => ({ sessionId: 'one', revision: 0, sources: [{ sourceId: 'bad', plugin: 'bad',
      registration: 'entry', executor: 'bad', rules: [{ id: 'r', paused: false }] }] }) }) })
  const unwatch = records.watch('one')
  try {
    await turn()
    const value = records.source.getSnapshot().get('one')
    assert.equal(value.status, 'error')
    assert.match(value.error, /actions/)
    assert.equal(value.sources, undefined)
  } finally { unwatch(); records.dispose() }
})

test('a departed session cannot publish its delayed save into a new watch of the same session', async () => {
  let finish
  const records = createControlRecords({ fetcher: async (_url, options) => options.method === 'PATCH'
    ? new Promise(resolve => { finish = () => resolve(response('one', 1)) }) : response('one') })
  const unwatch = records.watch('one')
  await turn()
  const saving = records.change('one', { sourceId: 's', ruleId: 'r', paused: true })
  unwatch()
  const nextUnwatch = records.watch('one')
  try {
    await turn()
    finish(); await saving
    assert.equal(records.source.getSnapshot().get('one').revision, 0)
    assert.equal(records.source.getSnapshot().get('one').saved, undefined)
  } finally { nextUnwatch(); records.dispose() }
})
