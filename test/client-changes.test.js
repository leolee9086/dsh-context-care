import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientChanges } from '../lib/client-changes.js'
import { createActionRecords } from '../src/action-records.js'
const turn = () => new Promise(resolve => setImmediate(resolve))

// Real ReadableStream and Response bodies exercise transport fragmentation and
// cancellation without constructing a substitute Harness Context or service.
function streamTransport() {
  const opened = []
  const fetcher = async (url, { signal }) => {
    let streamController
    const body = new ReadableStream({ start(controller) { streamController = controller } })
    signal.addEventListener('abort', () => { try { streamController.error(signal.reason) } catch {} }, { once: true })
    const encoder = new TextEncoder()
    opened.push({ url, signal, send: text => streamController.enqueue(encoder.encode(text)), end: () => streamController.close() })
    return new Response(body)
  }
  return { fetcher, opened }
}

test('one stream serves retained observers, routes fragmented changes, and resets by connection generation', async () => {
  const transport = streamTransport(); const errors = []
  const changes = createClientChanges({ fetcher: transport.fetcher, report: error => errors.push(error) })
  const one = []; const two = []
  const releaseOne = changes.subscribe('one', topics => one.push(topics))
  const releaseAgain = changes.subscribe('one', topics => two.push(topics))
  const releaseOther = changes.subscribe('other', () => assert.fail('cross-session notification'))
  await turn()
  assert.equal(transport.opened.length, 1)
  assert.deepEqual(new URL(transport.opened[0].url, 'http://localhost').searchParams.getAll('sessionId'), ['one', 'other'])
  const first = transport.opened[0]
  first.send('{"sessionId":"one","top'); await turn(); assert.equal(one.length, 0)
  first.send('ics":["actions"]}\n'); await turn()
  assert.deepEqual(one, [['actions']]); assert.deepEqual(two, one)
  releaseOne(); assert.equal(first.signal.aborted, false)
  changes.reset(); await turn()
  assert.equal(first.signal.aborted, true); assert.equal(transport.opened.length, 2)
  transport.opened[1].send('{"sessionId":"one","topics":["controls"]}\n'); await turn()
  assert.deepEqual(one, [['actions']]); assert.deepEqual(two, [['actions'], ['controls']])
  releaseAgain(); releaseAgain(); releaseOther(); changes.dispose()
  assert.ok(transport.opened.every(stream => stream.signal.aborted)); assert.deepEqual(errors, [])
})

test('idle records issue no repeated reads and one incoming change updates the retained page', async () => {
  const transport = streamTransport()
  const changes = createClientChanges({ fetcher: transport.fetcher, report: assert.fail })
  let calls = 0
  const records = createActionRecords({ changes, fetcher: async () => {
    calls++; return new Response(JSON.stringify({ actions: [{ id: String(calls) }], nextOffset: null }))
  } })
  const stop = records.watch('one'); await turn()
  assert.equal(calls, 1)
  await turn(); assert.equal(calls, 1)
  transport.opened[0].send('{"sessionId":"one","topics":["actions"]}\n'); await turn()
  assert.equal(calls, 2); assert.equal(records.source.getSnapshot().get('one:0').actions[0].id, '2')
  stop(); assert.equal(transport.opened[0].signal.aborted, true)
  records.dispose(); changes.dispose()
})

test('a failed stream reports the error and waits for a real reset without timer retry', async () => {
  const transport = streamTransport(); const errors = []
  const changes = createClientChanges({ fetcher: transport.fetcher, report: error => errors.push(error) })
  const stop = changes.subscribe('one', () => {})
  await turn()
  transport.opened[0].end(); await turn(); await turn()
  assert.equal(errors.length, 1); assert.equal(transport.opened.length, 1)
  changes.retry(); await turn(); assert.equal(transport.opened.length, 2)
  changes.retry(); await turn(); assert.equal(transport.opened.length, 2, 'manual reads preserve a healthy stream')
  stop(); changes.dispose()
})
