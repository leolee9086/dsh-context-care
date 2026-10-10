import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createDisplayRecords } from '../src/display-records.js'

const block = { id: 'copy', role: 'assistant', type: 'text', text: 'Safe copy' }
test('on-demand detail reader uses real HTTP, rejects malformed results, and exposes a real disconnected server', async t => {
  let body; let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(body))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const records = createDisplayRecords({ fetcher: (path, options) => fetch(new URL(path, base), options) })
  t.after(() => { records.dispose(); server.closeAllConnections(); server.close() })
  assert.equal(requests, 0, 'Creating the reader makes no request or timer')
  const key = 's:0:3'
  for (const malformed of [null, { projections: [{}] }, { projections: [{ seq: 4, before: [], after: [block] }] },
    { projections: [{ seq: 3, before: [], after: [block, block] }] }, { projections: [{ seq: 3, before: [], after: [{ ...block, seq: 2 }] }] },
    { projections: [{ seq: 3, before: [], after: [{ ...block, text: { invalid: true } }] }] }]) {
    body = malformed
    await records.read('s', 3, { refresh: true })
    assert.equal(records.source.getSnapshot().get(key).status, 'error')
    assert.match(records.source.getSnapshot().get(key).error, /Invalid display response/)
  }
  body = { projections: [{ seq: 3, before: [], after: [block], records: { private: true } }], status: 'spoofed' }
  await records.read('s', 3, { refresh: true })
  const snapshot = records.source.getSnapshot().get(key)
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.projections[0].after[0].text, 'Safe copy')
  assert.equal(snapshot.projections[0].records, undefined)
  const count = requests
  await records.read('s', 3)
  assert.equal(requests, count, 'Reopening cached details does not read again')
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await records.read('s', 3, { refresh: true })
  const failure = records.source.getSnapshot().get(key)
  assert.equal(failure.status, 'error')
  assert.match(failure.error, /fetch failed/)
  assert.match(failure.route, /sessionId=s&seq=3/)
  assert.equal(requests, count, 'A disconnected read cannot reach the server')
})
