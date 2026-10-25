import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestModelProjection } from '../lib/request-model-projection.js'
import { createSessionCache } from '../lib/session-cache.js'
import { modelRequestBlocks, projectRequestMessage } from '../src/request-blocks.js'


const shared = () => ({ byId: new Map() })
const input = () => ({ system: 'SYSTEM', messages: Array.from({ length: 1000 }, (_, index) => ({ role: 'user',
  content: [{ type: 'text', text: `BODY ${index} ` + 'x'.repeat(2048) }] })) })

test('model body cache reuses deep payloads while request ids, indexes and origins remain fresh', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const projection = createRequestModelProjection(cache, projectRequestMessage); t.after(() => projection.close())
  const request = input(), origins = shared()
  const first = modelRequestBlocks('session', request, 'one', origins, 'turn-one', projection)
  for (let index = 0; index < 10; index++) {
    const next = modelRequestBlocks('session', request, `next-${index}`, origins, 'turn-next', projection)
    assert.equal(next[1].raw, first[1].raw); assert.notEqual(next[1].id, first[1].id)
    assert.equal(next[1].turnId, 'turn-next')
  }
  assert.equal(cache.report().find(row => row.name === 'request-model-projection')?.work, 1001)
  assert.throws(() => { first[1].raw.text = 'Forbidden edit' }, TypeError)
  request.messages[0].content[0].text = 'Original remains writable'
  assert.match(first[1].raw.text, /^BODY 0 /, 'owned cache data never freezes or aliases the request')
  projection.changed(request.messages[0])
  const refreshed = modelRequestBlocks('session', request, 'changed', origins, 'turn', projection)
  assert.equal(refreshed[1].text, 'Original remains writable'); assert.equal(refreshed[2].raw, first[2].raw)
  const reordered = modelRequestBlocks('session', { ...request, messages: [...request.messages].reverse() }, 'reordered', origins, 'turn', projection)
  assert.equal(reordered[1].raw, first.at(-1)?.raw); assert.equal(reordered[1].messageIndex, 0)
  assert.equal(reordered[1].messageId, 'request:reordered:0')
  const origin = { event: { seq: 42 }, turnId: 'native-turn' }
  const native = modelRequestBlocks('other', request, 'native', { byId: { get() { return origin } }, system: origin }, 'fallback', projection)
  assert.equal(native[1].id, 'other#42#0'); assert.equal(native[1].turnId, 'native-turn')
  assert.equal(native[0].seq, 42); assert.equal(native[1].raw, refreshed[1].raw)
  projection.close(); assert.ok(!cache.report().some(row => row.name === 'request-model-projection'))
  assert.throws(() => projection.read(request.messages[0]), /projection-closed/)
  assert.throws(() => projection.system('again', request.messages[0]), /projection-closed/)
  assert.throws(() => projection.changed(request.messages[0]), /projection-closed/)
  assert.throws(() => projection.cloned([], []), /projection-closed/)
})

test('cached nested tools retain signatures parsed arguments and writable native source data', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const projection = createRequestModelProjection(cache, projectRequestMessage); t.after(() => projection.close())
  const message = { role: 'tool', toolCallId: 'outer', isError: true, source: { replayState: { token: 'state' } }, content: [
    { type: 'tool-result', callId: 'inner', content: [
      { type: 'reasoning', text: 'signed', signature: 'sig' },
      { type: 'tool-call', id: 'call', name: 'inspect', arguments: '{"x":1}' },
      { type: 'tool-call', id: 'bad', name: 'inspect', arguments: '{invalid' },
    ] },
  ] }
  const request = { messages: [message] }, first = modelRequestBlocks('s', request, 'a', shared(), 'turn', projection)
  const second = modelRequestBlocks('s', request, 'b', shared(), 'turn', projection)
  assert.equal(first[0].path, '$result'); assert.equal(first[0].callId, 'outer'); assert.equal(first[0].raw.isError, true)
  assert.equal(first[1].path, '0'); assert.equal(first[2].path, '0.0'); assert.equal(first[2].signed, true)
  assert.deepEqual(first[3].arguments, { x: 1 }); assert.equal(typeof first[4].argumentsError, 'string')
  assert.equal(second[0].raw, first[0].raw); assert.equal(second[2].source, first[2].source)
  assert.throws(() => { first[2].source.replayState.token = 'changed' }, TypeError)
  message.source.replayState.token = 'native writable'
  assert.equal(first[2].source.replayState.token, 'state'); assert.equal(message.source.replayState.token, 'native writable')
})

test('failed message projection is not published and retries cannot resurrect a closed cache', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  let fail = true, attempts = 0
  const projection = createRequestModelProjection(cache, (message: { text: string }) => {
    attempts++; if (fail) throw new Error('projection-failed'); return [{ text: message.text }]
  })
  const message = { text: 'original' }
  assert.throws(() => projection.read(message), /projection-failed/)
  fail = false; const first = projection.read(message)
  assert.equal(attempts, 2); assert.equal(projection.read(message), first)
  assert.equal(cache.report().find(row => row.name === 'request-model-projection')?.work, 1)
  projection.close(); assert.throws(() => projection.read(message), /projection-closed/)
  assert.ok(!cache.report().some(row => row.name === 'request-model-projection'))
})

test('model projection clone lineage reuses untouched messages and detaches payload edits from old cuts', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const projection = createRequestModelProjection(cache, projectRequestMessage); t.after(() => projection.close())
  const request = input(), before = modelRequestBlocks('s', request, 'first', shared(), 'turn', projection)
  const copy = structuredClone(request)
  projection.cloned(request.messages, copy.messages)
  assert.equal(projection.read(copy.messages[99])[0].raw, before[100].raw)
  projection.changed(copy.messages[99]); copy.messages[99].content[0].text = 'CHANGED'
  const next = modelRequestBlocks('s', copy, 'copy', shared(), 'turn', projection)
  assert.equal(next[100].text, 'CHANGED'); assert.notEqual(next[100].raw, before[100].raw)
  assert.equal(next[101].raw, before[101].raw); assert.match(before[100].text, /^BODY 99 /)
  const second = structuredClone(copy); projection.cloned(copy.messages, second.messages)
  assert.equal(projection.read(second.messages[99])[0].raw, next[100].raw)
  copy.system = 'NEW SYSTEM'
  assert.equal(modelRequestBlocks('s', copy, 'system', shared(), 'turn', projection)[0].text, 'NEW SYSTEM')
  assert.equal(before[0].text, 'SYSTEM')
  assert.equal(cache.report().find(row => row.name === 'request-model-projection')?.work, 1003)
  assert.throws(() => projection.cloned(request.messages, []), /clone-length-mismatch/)
})
