import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createDisplayRecords } from '../src/display-records.js'

const block = { id: 'copy', role: 'assistant', type: 'text', text: 'Safe copy' }

test('failed real HTTP reads retain status and route for empty, HTML and JSON responses', async t => {
  let reply
  const server = createServer((_request, response) => {
    response.writeHead(reply.status, reply.type ? { 'content-type': reply.type } : {})
    response.end(reply.body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const records = createDisplayRecords({ fetcher: (path, options) => fetch(new URL(path, base), options) })
  t.after(() => { records.dispose(); server.closeAllConnections(); server.close() })
  for (reply of [
    { status: 503, body: '' },
    { status: 403, type: 'text/html', body: '<p>Forbidden</p>' },
    { status: 503, type: 'application/json', body: JSON.stringify({ error: 'workbench-unavailable' }) },
  ]) {
    await records.read('s', 3, { refresh: true })
    const failure = records.source.getSnapshot().get('s:0:3')
    assert.equal(failure.status, 'error')
    assert.match(failure.error, new RegExp(`HTTP ${reply.status}`))
    assert.equal(failure.route, '/context-care/display?sessionId=s&seq=3')
    assert.equal(failure.phase, 'http')
    assert.equal(failure.httpStatus, reply.status)
    if (reply.type === 'application/json') assert.match(failure.error, /workbench-unavailable/)
  }
})
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
  assert.equal(failure.phase, 'fetch')
  assert.equal(failure.httpStatus, undefined)
  assert.equal(requests, count, 'A disconnected read cannot reach the server')
})

test('a real interrupted response body retains received status separately from a connection failure', async t => {
  let status = 200
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': 4096 })
    response.flushHeaders()
    response.write('{"projections":[')
    setTimeout(() => response.destroy(), 50)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const records = createDisplayRecords({ fetcher: (path, options) => fetch(new URL(path, base), options) })
  t.after(() => { records.dispose(); server.closeAllConnections(); server.close() })
  for (status of [200, 503]) {
    await records.read('s', 3, { refresh: true })
    const failure = records.source.getSnapshot().get('s:0:3')
    assert.equal(failure.status, 'error')
    assert.equal(failure.phase, 'body')
    assert.equal(failure.httpStatus, status)
    assert.match(failure.route, /sessionId=s&seq=3/)
    assert.match(failure.error, /terminated/)
  }
})

test('complete malformed JSON and mismatched message identity have distinct response diagnostics', async t => {
  let body = '{'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const records = createDisplayRecords({ fetcher: (path, options) => fetch(new URL(path, base), options) })
  t.after(() => { records.dispose(); server.closeAllConnections(); server.close() })
  await records.read('s', 3)
  assert.equal(records.source.getSnapshot().get('s:0:3').phase, 'json')
  body = JSON.stringify({ projections: [{ seq: 4, before: [], after: [] }] })
  await records.read('s', 3, { refresh: true })
  const failure = records.source.getSnapshot().get('s:0:3')
  assert.equal(failure.phase, 'validation')
  assert.equal(failure.httpStatus, 200)
  assert.match(failure.error, /Invalid display response/)
})
