import test from 'node:test'
import assert from 'node:assert/strict'
import { createControlRecords } from '../src/control-records.js'
import { careStreamFixture, turn } from './fixtures/care-stream.js'
const response = (id, revision = 0) => ({ ok: true, json: async () => ({ sessionId: id, revision, sources: [] }) })
const query = { sessionId: 'one', topic: 'controls' }

async function initial(transport, revision = 0) {
  await turn()
  transport.push(query, { sessionId: 'one', revision, sources: [] }); await turn()
}

test('saving retains acknowledged preferences and failures stay visible across pushed snapshots until successful retry', async () => {
  const transport = careStreamFixture()
  let finish; let failure = true; let mutations = 0
  const records = createControlRecords({ changes: transport.changes, fetcher: async (_url, options) => {
    mutations++; assert.equal(options.method, 'PATCH', 'the store never performs a GET')
    return new Promise(resolve => { finish = () => resolve(failure
      ? { ok: false, status: 409, headers: new Headers(), json: async () => ({ error: 'revision-conflict' }) } : response('one', 1)) })
  } })
  const unwatch = records.watch('one')
  try {
    await initial(transport)
    const saving = records.change('one', { sourceId: 's', ruleId: 'r', paused: true })
    assert.equal(records.source.getSnapshot().get('one').revision, 0)
    assert.equal(records.source.getSnapshot().get('one').saving, true)
    finish(); await saving
    assert.equal(records.source.getSnapshot().get('one').status, 'error')
    assert.match(records.source.getSnapshot().get('one').error, /409/)
    transport.push(query, { sessionId: 'one', revision: 0, sources: [] }); await turn()
    assert.equal(records.source.getSnapshot().get('one').status, 'ready')
    assert.match(records.source.getSnapshot().get('one').error, /409/)
    failure = false
    const retry = records.change('one', { sourceId: 's', ruleId: 'r', paused: true })
    // A commit from another client can advance the stream before this ACK arrives.
    transport.push(query, { sessionId: 'one', revision: 2, sources: [] }); await turn()
    assert.equal(records.source.getSnapshot().get('one').saving, true)
    finish(); await retry
    assert.equal(records.source.getSnapshot().get('one').revision, 2)
    assert.equal(records.source.getSnapshot().get('one').saved, true)
    assert.equal(records.source.getSnapshot().get('one').error, undefined)
    assert.equal(mutations, 2); assert.equal(transport.opened.length, 1)
  } finally { unwatch(); records.dispose(); transport.changes.dispose() }
})

test('malformed nested rule snapshots remain visible errors before reaching the view', async () => {
  const transport = careStreamFixture()
  const records = createControlRecords({ changes: transport.changes, fetcher: assert.fail })
  const unwatch = records.watch('one')
  try {
    await turn()
    transport.push(query, { sessionId: 'one', revision: 0, sources: [{ sourceId: 'bad', plugin: 'bad',
      registration: 'entry', executor: 'bad', rules: [{ id: 'r', paused: false }] }] }); await turn()
    const value = records.source.getSnapshot().get('one')
    assert.equal(value.status, 'error'); assert.match(value.error, /actions/); assert.equal(value.sources, undefined)
  } finally { unwatch(); records.dispose(); transport.changes.dispose() }
})

test('a departed session cannot publish its delayed save into a new watch of the same session', async () => {
  const transport = careStreamFixture(); let finish
  const records = createControlRecords({ changes: transport.changes, fetcher: async (_url, options) => {
    assert.equal(options.method, 'PATCH')
    return new Promise(resolve => { finish = () => resolve(response('one', 1)) })
  } })
  const unwatch = records.watch('one'); await initial(transport)
  const saving = records.change('one', { sourceId: 's', ruleId: 'r', paused: true })
  unwatch()
  const nextUnwatch = records.watch('one')
  try {
    await initial(transport)
    finish(); await saving
    assert.equal(records.source.getSnapshot().get('one').revision, 0)
    assert.equal(records.source.getSnapshot().get('one').saved, undefined)
  } finally { nextUnwatch(); records.dispose(); transport.changes.dispose() }
})
