import test from 'node:test'
import assert from 'node:assert/strict'
import { createDisplayRecords } from '../src/display-records.js'

const block = { id: 'copy', role: 'assistant', type: 'text', text: 'Safe copy' }
test('display reader refuses malformed or mismatched copies before publishing and recovers on valid data', async () => {
  let tick; let body; let signal
  const records = createDisplayRecords({ fetcher: async (_url, options) => { signal = options.signal; return { ok: true, json: async () => body } },
    setTimer: callback => { tick = callback; return 1 }, clearTimer: () => {} })
  const wait = () => new Promise(resolve => setImmediate(resolve))
  const key = 's:0:3'
  body = { projections: [{ seq: 3, before: [], after: [{ ...block, text: { malicious: true } }] }] }
  const unwatch = records.watch('s', 0, 3)
  await wait()
  assert.equal(records.source.getSnapshot().get(key).status, 'error')
  assert.match(records.source.getSnapshot().get(key).error, /Invalid display response/)
  for (const malformed of [null, { projections: [{}] }, { projections: [{ seq: 4, before: [], after: [block] }] },
    { projections: [{ seq: 3, before: [], after: [block, block] }] }, { projections: [{ seq: 3, before: [], after: [{ ...block, seq: 2 }] }] }]) {
    body = malformed; tick(); await wait()
    assert.equal(records.source.getSnapshot().get(key).status, 'error')
  }
  body = { projections: [{ seq: 3, before: [], after: [block], records: { intentionally: 'not exposed to the renderer' } }], status: 'spoofed' }
  tick(); await wait()
  const snapshot = records.source.getSnapshot().get(key)
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.projections[0].after[0].text, 'Safe copy')
  assert.equal(snapshot.projections[0].records, undefined)
  unwatch(); assert.equal(signal.aborted, true); assert.equal(records.source.getSnapshot().has(key), false)
  records.dispose()
})
