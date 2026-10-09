import test from 'node:test'
import assert from 'node:assert/strict'
import { createRewriteRecords } from '../src/rewrite-records.js'

const drain = async () => { for (let step = 0; step < 8; step++) await Promise.resolve() }

test('rewrite route failure is observable, backs off and clears after recovery', async () => {
  let tick
  let clock = 0
  let calls = 0
  let failed = true
  const reported = []
  const records = createRewriteRecords({ fetcher: async () => {
    calls++
    return failed ? { ok: false, status: 404 } : { ok: true, json: async () => ({ records: [{ sessionId: 's', hash: 'h' }] }) }
  }, setTimer: fn => { tick = fn; return 1 }, clearTimer() {}, now: () => clock, report: error => reported.push(error) })
  records.watch('s')
  await drain()
  assert.equal(records.health.getSnapshot().get('s').status, 'error')
  assert.match(records.health.getSnapshot().get('s').error, /rewrite-journal: HTTP 404/)
  assert.equal(reported.length, 1)
  clock = 2000
  tick()
  await drain()
  assert.equal(calls, 1)
  clock = 4000
  tick()
  await drain()
  assert.equal(calls, 2)
  assert.equal(reported.length, 1, 'Repeated failure remains visible without repeated console messages')
  failed = false
  clock = 12000
  tick()
  await drain()
  assert.equal(records.health.getSnapshot().get('s').status, 'ready')
  assert.deepEqual(records.records.getSnapshot().get('s:h'), { sessionId: 's', hash: 'h' })
  records.dispose()
})

test('invalid rewrite payload reports an error and disposal aborts an outstanding request', async () => {
  let tick
  let resolveRequest
  let requestSignal
  let requests = 0
  let clearCount = 0
  const records = createRewriteRecords({ fetcher: (_url, options) => {
    requests++
    requestSignal = options.signal
    return new Promise(resolve => { resolveRequest = resolve })
  }, setTimer: fn => { tick = fn; return 1 }, clearTimer() { clearCount++ }, report() {} })
  records.watch('s')
  tick()
  assert.equal(requests, 1)
  resolveRequest({ ok: true, json: async () => ({ records: 'invalid' }) })
  await drain()
  assert.match(records.health.getSnapshot().get('s').error, /invalid records response/)
  records.dispose()
  assert.equal(requestSignal.aborted, true)
  assert.equal(clearCount, 1)
  tick()
  assert.equal(requests, 1)
})

test('session watches share requests, release only the final owner and ignore late responses', async () => {
  const pending = []
  const records = createRewriteRecords({ fetcher: (url, options) => new Promise(resolve => pending.push({ url, signal: options.signal, resolve })),
    setTimer: () => 1, clearTimer() {}, report() {} })
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
    { sessionId: 's', hash: 'valid' }, { sessionId: 'other', hash: 'private' }] }) }), setTimer: () => 1, clearTimer() {}, report() {} })
  records.watch('s'); await drain()
  assert.equal(records.records.getSnapshot().size, 0)
  assert.match(records.health.getSnapshot().get('s').error, /cross-session/)
  records.dispose()
})
