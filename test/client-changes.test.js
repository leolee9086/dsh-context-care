import test from 'node:test'
import assert from 'node:assert/strict'
import { createActionRecords } from '../src/action-records.js'
import { createRewriteRecords } from '../src/rewrite-records.js'
import { careStreamFixture, turn } from './fixtures/care-stream.js'

const actionsQuery = { sessionId: 'one', topic: 'actions' }
const rewritesQuery = { sessionId: 'one', topic: 'rewrites' }

test('one stream delivers fragmented snapshots to shared observers and resets only by generation', async () => {
  const transport = careStreamFixture()
  const one = []; const two = []
  const stopOne = transport.changes.subscribe(actionsQuery, update => one.push(update))
  const stopAgain = transport.changes.subscribe(actionsQuery, update => two.push(update))
  const stopOther = transport.changes.subscribe({ sessionId: 'other', topic: 'actions' }, () => assert.fail('cross-session notification'))
  await turn()
  assert.equal(transport.opened.length, 1)
  assert.equal(transport.opened[0].subscriptions.length, 2)
  const stream = transport.opened[0]
  const text = JSON.stringify(stream.frame(actionsQuery, { actions: [{ id: 'first' }] })) + '\n'
  stream.send(text.slice(0, 20)); await turn(); assert.equal(one.length, 0)
  stream.send(text.slice(20)); await turn()
  assert.equal(one[0].value.actions[0].id, 'first'); assert.deepEqual(two, one)
  stopOne(); assert.equal(stream.signal.aborted, false)
  transport.changes.reset(); await turn()
  assert.equal(stream.signal.aborted, true); assert.equal(transport.opened.length, 2)
  transport.push(actionsQuery, { actions: [{ id: 'after-reset' }] }); await turn()
  assert.equal(two.at(-1).value.actions[0].id, 'after-reset')
  stopAgain(); stopAgain(); stopOther(); transport.changes.dispose()
  assert.ok(transport.opened.every(item => item.signal.aborted)); assert.deepEqual(transport.errors, [])
})

test('continuous pushed pages and rewrite deltas issue no follow-up HTTP reads', async () => {
  const transport = careStreamFixture()
  const actions = createActionRecords({ changes: transport.changes })
  const rewrites = createRewriteRecords({ changes: transport.changes, report: assert.fail })
  const stop = actions.watch('one'); const stopRewrites = rewrites.watch('one')
  await turn()
  assert.equal(transport.opened.length, 1)
  transport.push(actionsQuery, { actions: [], nextOffset: null })
  transport.push(rewritesQuery, { records: [{ sessionId: 'one', hash: 'old' }] })
  await turn()
  for (let step = 0; step < 40; step++) {
    transport.push(actionsQuery, { actions: [{ id: String(step) }], nextOffset: null })
    transport.push(rewritesQuery, { records: [{ sessionId: 'one', hash: 'latest', at: step }], removed: step ? [] : ['old'] }, 'delta')
    await turn()
  }
  assert.equal(transport.opened.length, 1, 'data changes never reopen the stream or request a view URL')
  assert.equal(actions.source.getSnapshot().get('one:0').actions[0].id, '39')
  assert.equal(rewrites.records.getSnapshot().get('one:latest').at, 39)
  assert.equal(rewrites.records.getSnapshot().has('one:old'), false)
  const replay = []
  const release = transport.changes.subscribe(rewritesQuery, update => replay.push(update))
  assert.equal(replay[0].type, 'snapshot')
  assert.deepEqual(replay[0].value.records, [{ sessionId: 'one', hash: 'latest', at: 39 }])
  release(); stop(); stopRewrites(); actions.dispose(); rewrites.dispose(); transport.changes.dispose()
})

test('a closed stream leaves visible view errors and waits for explicit retry without timer requests', async () => {
  const transport = careStreamFixture()
  const records = createActionRecords({ changes: transport.changes })
  const stop = records.watch('one'); await turn()
  transport.push(actionsQuery, { actions: [{ id: 'kept' }] }); await turn()
  transport.opened[0].end(); await turn(); await turn()
  assert.equal(transport.errors.length, 1); assert.equal(transport.opened.length, 1)
  assert.equal(records.source.getSnapshot().get('one:0').status, 'error')
  assert.equal(records.source.getSnapshot().get('one:0').actions[0].id, 'kept')
  await turn(); assert.equal(transport.opened.length, 1)
  records.refresh(); await turn(); assert.equal(transport.opened.length, 2)
  transport.push(actionsQuery, { actions: [{ id: 'recovered' }] }); await turn()
  assert.equal(records.source.getSnapshot().get('one:0').status, 'ready')
  stop(); records.dispose(); transport.changes.dispose()
})

test('view errors preserve original diagnostics without dropping other subscriptions', async () => {
  const transport = careStreamFixture(); const received = []
  const stop = transport.changes.subscribe(actionsQuery, update => received.push(update))
  const other = transport.changes.subscribe(rewritesQuery, update => received.push(update))
  await turn()
  transport.push(actionsQuery, { name: 'TypeError', message: 'original-read-failure' }, 'error')
  transport.push(rewritesQuery, { records: [] }); await turn()
  assert.equal(received[0].error.message, 'original-read-failure')
  assert.equal(received[1].type, 'snapshot')
  assert.equal(transport.opened.length, 1)
  stop(); other(); transport.changes.dispose()
})

test('a revision gap or wrong session rejects the stream instead of applying an untrusted update', async t => {
  for (const patch of [{ revision: 2 }, { sessionId: 'another' }]) await t.test(JSON.stringify(patch), async () => {
    const transport = careStreamFixture(); const updates = []
    const stop = transport.changes.subscribe(actionsQuery, update => updates.push(update)); await turn()
    const stream = transport.opened[0]
    stream.send(JSON.stringify({ ...stream.frame(actionsQuery, { actions: [] }), ...patch }) + '\n')
    await turn()
    assert.equal(updates.length, 1); assert.equal(updates[0].type, 'error')
    assert.equal(transport.errors.length, 1)
    stop(); transport.changes.dispose()
  })
})
