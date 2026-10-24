import test from 'node:test'
import assert from 'node:assert/strict'
import { createRewriteRecords } from '../src/rewrite-records.js'
import { careStreamFixture, turn } from './fixtures/care-stream.js'

const query = { sessionId: 's', topic: 'rewrites' }

test('rewrite errors remain visible until an explicit refresh supplies a new snapshot', async () => {
  const transport = careStreamFixture(); const reported = []
  const records = createRewriteRecords({ changes: transport.changes, report: error => reported.push(error) })
  const stop = records.watch('s'); await turn()
  transport.push(query, { name: 'Error', message: 'original journal read failure' }, 'error'); await turn()
  assert.equal(records.health.getSnapshot().get('s').status, 'error')
  assert.match(records.health.getSnapshot().get('s').error, /original journal read failure/)
  assert.equal(reported.length, 1)
  await turn(); assert.equal(transport.opened.length, 1)
  records.refresh('s'); await turn(); assert.equal(transport.opened.length, 2)
  transport.push(query, { records: [{ sessionId: 's', hash: 'h' }] }); await turn()
  assert.equal(records.health.getSnapshot().get('s').status, 'ready')
  assert.deepEqual(records.records.getSnapshot().get('s:h'), { sessionId: 's', hash: 'h' })
  stop(); records.dispose(); transport.changes.dispose()
})

test('rewrite deltas update and remove records without replacing unrelated sessions', async () => {
  const transport = careStreamFixture()
  const records = createRewriteRecords({ changes: transport.changes, report: assert.fail })
  const stop = records.watch('s'); const stopOther = records.watch('other'); await turn()
  transport.push(query, { records: [{ sessionId: 's', hash: 'old' }] })
  transport.push({ sessionId: 'other', topic: 'rewrites' }, { records: [{ sessionId: 'other', hash: 'kept' }] }); await turn()
  transport.push(query, { records: [{ sessionId: 's', hash: 'new' }], removed: ['old'] }, 'delta'); await turn()
  assert.equal(records.records.getSnapshot().has('s:old'), false)
  assert.equal(records.records.getSnapshot().has('s:new'), true)
  assert.equal(records.records.getSnapshot().has('other:kept'), true)
  assert.equal(transport.opened.length, 1)
  stop(); stopOther(); records.dispose(); transport.changes.dispose()
})

test('session observers share a subscription and only final release removes it', async () => {
  const transport = careStreamFixture()
  const records = createRewriteRecords({ changes: transport.changes, report: assert.fail })
  const first = records.watch('session/one'); const second = records.watch('session/one'); const other = records.watch('two')
  await turn(); assert.equal(transport.opened[0].subscriptions.length, 2)
  first(); first(); await turn(); assert.equal(transport.opened.length, 1)
  second(); await turn()
  assert.equal(records.health.getSnapshot().has('session/one'), false)
  assert.deepEqual(transport.opened.at(-1).subscriptions.map(item => item.sessionId), ['two'])
  transport.push({ sessionId: 'two', topic: 'rewrites' }, { records: [{ sessionId: 'two', hash: 'kept' }] }); await turn()
  assert.equal(records.records.getSnapshot().has('two:kept'), true)
  other(); assert.equal(records.records.getSnapshot().size, 0)
  assert.ok(transport.opened.every(item => item.signal.aborted))
  records.dispose(); transport.changes.dispose()
})

test('a snapshot containing another session is rejected before publishing any records', async () => {
  const transport = careStreamFixture()
  const records = createRewriteRecords({ changes: transport.changes, report() {} })
  const stop = records.watch('s'); await turn()
  transport.push(query, { records: [{ sessionId: 's', hash: 'valid' }, { sessionId: 'other', hash: 'private' }] }); await turn()
  assert.equal(records.records.getSnapshot().size, 0)
  assert.match(records.health.getSnapshot().get('s').error, /cross-session/)
  stop(); records.dispose(); transport.changes.dispose()
})
