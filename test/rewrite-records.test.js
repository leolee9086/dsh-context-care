import test from 'node:test'
import assert from 'node:assert/strict'
import { createRewriteRecords } from '../src/rewrite-records.js'
import { createCareChanges } from '../lib/care-changes.js'

const drain = async () => { for (let step = 0; step < 12; step++) await Promise.resolve() }
const observedChanges = () => {
  const host = createCareChanges()
  return { changed: host.changed, subscribe(id, listener) { return host.subscribe(change => {
    if (change.sessionId === id || change.sessionId === undefined) listener(change.topics)
  }) } }
}

test('rewrite failures stay observable and retry only on real changes or explicit refresh', async () => {
  let calls = 0; let failed = true
  const reported = []; const changes = observedChanges()
  const records = createRewriteRecords({ fetcher: async () => {
    calls++
    return failed ? { ok: false, status: 404 } : { ok: true, json: async () => ({ records: [{ sessionId: 's', hash: 'h' }] }) }
  }, changes, report: error => reported.push(error) })
  records.watch('s'); await drain()
  assert.equal(records.health.getSnapshot().get('s').status, 'error')
  assert.match(records.health.getSnapshot().get('s').error, /rewrite-journal: HTTP 404/)
  assert.equal(reported.length, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1, 'idle time does not schedule another request')
  changes.changed('other', ['rewrites']); changes.changed('s', ['controls']); await drain()
  assert.equal(calls, 1)
  changes.changed('s', ['rewrites']); await drain()
  assert.equal(calls, 2)
  assert.equal(reported.length, 1, 'repeated failure stays visible without repeated console messages')
  failed = false; records.refresh('s'); await drain()
  assert.equal(records.health.getSnapshot().get('s').status, 'ready')
  assert.deepEqual(records.records.getSnapshot().get('s:h'), { sessionId: 's', hash: 'h' })
  records.dispose()
})

test('changes during an outstanding read schedule exactly one follow-up and unload aborts it', async () => {
  const requests = []; const changes = observedChanges()
  const records = createRewriteRecords({ changes, fetcher: (_url, options) => new Promise(resolve => requests.push({ options, resolve })), report() {} })
  records.watch('s')
  changes.changed('s', ['rewrites']); await drain()
  assert.equal(requests.length, 1)
  requests[0].resolve({ ok: true, json: async () => ({ records: 'invalid' }) }); await drain()
  assert.equal(requests.length, 2, 'a change while loading is not lost')
  assert.match(records.health.getSnapshot().get('s').error, /invalid records response/)
  records.dispose()
  assert.equal(requests[1].options.signal.aborted, true)
  changes.changed('s', ['rewrites']); await drain()
  assert.equal(requests.length, 2)
})

test('session watches share requests, release only the final owner and ignore late responses', async () => {
  const pending = []
  const records = createRewriteRecords({ fetcher: (url, options) => new Promise(resolve => pending.push({ url, signal: options.signal, resolve })), report() {} })
  assert.equal(pending.length, 0)
  const first = records.watch('session/one'); const second = records.watch('session/one'); const other = records.watch('two')
  assert.equal(pending.length, 2)
  assert.match(pending[0].url, /sessionId=session%2Fone/)
  first(); first(); assert.equal(pending[0].signal.aborted, false)
  second(); assert.equal(pending[0].signal.aborted, true)
  pending[0].resolve({ ok: true, json: async () => ({ records: [{ sessionId: 'session/one', hash: 'late' }] }) })
  pending[1].resolve({ ok: true, json: async () => ({ records: [{ sessionId: 'two', hash: 'kept' }] }) })
  await drain()
  assert.equal(records.records.getSnapshot().has('session/one:late'), false)
  assert.equal(records.health.getSnapshot().has('session/one'), false)
  assert.equal(records.records.getSnapshot().has('two:kept'), true)
  other(); assert.equal(records.records.getSnapshot().size, 0)
  records.dispose()
})

test('a response containing another session is rejected before any records are published', async () => {
  const records = createRewriteRecords({ fetcher: async () => ({ ok: true, json: async () => ({ records: [
    { sessionId: 's', hash: 'valid' }, { sessionId: 'other', hash: 'private' }] }) }), report() {} })
  records.watch('s'); await drain()
  assert.equal(records.records.getSnapshot().size, 0)
  assert.match(records.health.getSnapshot().get('s').error, /cross-session/)
  records.dispose()
})
