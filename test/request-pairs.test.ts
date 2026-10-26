import test from 'node:test'
import assert from 'node:assert/strict'
import { indexRequestPairs, createRequestPairProjection, type RequestPairPayload } from '../lib/request-pairs.js'
import { createRequestPlanCache } from '../lib/request-plan-cache.js'
import { createSessionCache } from '../lib/session-cache.js'
import { planRequestV2 } from '../src/request-plan.js'
import { requestImpact } from '../src/request-impact.js'

function legacy(request: RequestPairPayload) {
  const calls = new Set(request.messages.flatMap(message => message.content.filter(value => (value as { type?: unknown }).type === 'tool-call').map(value => (value as { id?: unknown }).id)))
  const results = new Set(request.messages.filter(message => message.role === 'tool').map(message => message.toolCallId))
  return { calls, results }
}

test('pair projection matches legacy Set order and identity including duplicate missing nested and sparse data', () => {
  const objectId = {}, numericId = 9
  const request = { messages: [
    { role: 'assistant', content: [{ type: 'tool-call', id: 'same' }, { type: 'tool-call' }, { type: 'tool-call', id: objectId }, { type: 'text', children: [{ type: 'tool-call', id: 'nested' }] }] },
    { role: 'tool', toolCallId: 'same', content: [{ type: 'tool-call', id: numericId }, { type: 'tool-call', id: 'same' }] },
    { role: 'tool', content: [] },
    { role: 'user', toolCallId: 'ignored', content: Array(2) },
    { role: 'tool', toolCallId: objectId, content: [] },
  ] }
  assert.deepEqual(indexRequestPairs(request), legacy(request))
  assert.deepEqual([...indexRequestPairs(request).calls], ['same', undefined, objectId, numericId])
  assert.deepEqual([...indexRequestPairs(request).results], ['same', undefined, objectId])
  // Keep malformed explicit payloads failing rather than silently skipping them.
  assert.throws(() => indexRequestPairs({ messages: [{ content: [null] }] }), TypeError)
  for (let seed = 0; seed < 300; seed++) {
    const sample = { messages: Array.from({ length: seed % 17 }, (_, i) => ({ role: ['tool', 'assistant', 'user'][(seed + i) % 3], toolCallId: (seed * i) % 13,
      content: Array.from({ length: (seed + i) % 11 }, (_, j) => ({ type: (i + j) % 3 ? 'text' : 'tool-call', id: (seed + i * j) % 13 })) })) }
    assert.deepEqual(indexRequestPairs(sample), legacy(sample))
  }
})

test('operation pairs reuse exact immutable identity without touching bodies and release on close', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache)
  let blocks = 0, roles = 0, contentReads = 0
  const request = { messages: Array.from({ length: 1000 }, (_, index) => ({
    get role() { roles++; return index % 2 ? 'tool' : 'assistant' }, toolCallId: `call-${index - 1}`,
    get content() { contentReads++; return [{ get type() { blocks++; return 'tool-call' }, id: `call-${index}`, get text() { throw new Error('body-must-not-be-read') } }] },
  })) }
  const first = analysis.pairIndex(request)
  assert.equal(blocks, 1000); assert.equal(roles, 1000); assert.equal(contentReads, 1000)
  for (let repeat = 0; repeat < 500; repeat++) assert.equal(analysis.pairIndex(request), first)
  assert.equal(blocks, 1000); assert.equal(roles, 1000); assert.equal(contentReads, 1000)
  assert.equal(cache.report().find(row => row.name === 'request-plan-pairs')?.work, 1000)
  assert.notEqual(analysis.pairIndex({ messages: request.messages }), first); assert.equal(blocks, 1000, 'new envelope still reuses unchanged immutable message metadata')
  analysis.close(); assert.ok(!cache.report().some(row => row.name === 'request-plan-pairs'))
  assert.throws(() => analysis.pairIndex(request), /request-plan-cache-closed/)
  const fresh = createRequestPlanCache(requestImpact, cache); t.after(() => fresh.close())
  assert.notEqual(fresh.pairIndex(request), first); assert.equal(blocks, 2000)
  assert.equal(first.calls.size, 1000, 'old immutable pair cut stays stable')
})

test('pair clone links stay lazy and changed messages detach while primitive history metadata is reused', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const projection = createRequestPairProjection(cache); t.after(() => projection.close())
  const before = [{ role: 'assistant', content: [{ type: 'tool-call', id: 'old' }] }, { role: 'tool', toolCallId: 'old', content: [{ type: 'text' }] }]
  const after = structuredClone(before)
  projection.cloned(before, after)
  assert.equal(cache.report().find(row => row.name === 'request-plan-pair-messages')?.work, 0, 'linking alone never parses pair metadata')
  const original = projection.read({ messages: before })
  assert.equal(cache.report().find(row => row.name === 'request-plan-pair-messages')?.work, 2)
  assert.deepEqual(projection.read({ messages: after }), original)
  assert.equal(cache.report().find(row => row.name === 'request-plan-pair-messages')?.work, 2)
  const changed = after[0], call = changed.content[0]
  assert.ok('id' in call)
  projection.changed(changed); call.id = 'new'
  const edited = projection.read({ messages: after })
  assert.deepEqual([...edited.calls], ['new']); assert.deepEqual([...original.calls], ['old'])
  assert.equal(cache.report().find(row => row.name === 'request-plan-pair-messages')?.work, 3)
  assert.throws(() => projection.cloned(before, []), /clone-length-mismatch/)
  projection.close(); assert.ok(!cache.report().some(row => row.name === 'request-plan-pair-messages'))
  assert.throws(() => projection.read({ messages: before }), /projection-closed/)
})

test('nonprimitive pair ids are reindexed from actual cloned objects rather than borrowing original Set keys', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const projection = createRequestPairProjection(cache); t.after(() => projection.close())
  const id = {}, before = [{ role: 'assistant', content: [{ type: 'tool-call', id }] }, { role: 'tool', toolCallId: id, content: [] }]
  const original = projection.read({ messages: before }), after = structuredClone(before)
  projection.cloned(before, after)
  const cloned = projection.read({ messages: after })
  assert.equal(original.calls.has(id), true); assert.equal(cloned.calls.has(id), false)
  const actualId = after[0].content[0].id
  assert.equal(cloned.calls.has(actualId), true); assert.equal(cloned.results.has(actualId), true)
  assert.equal(cache.report().find(row => row.name === 'request-plan-pair-messages')?.work, 4)
})

test('failed pair construction is unpublished and mutable requests are fresh in a new operation', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache)
  let broken = true
  const request = { messages: [{ role: 'assistant', content: [{ get type() { if (broken) throw new Error('pair-read-failed'); return 'tool-call' }, id: 'old' }] }] }
  assert.throws(() => analysis.pairIndex(request), /pair-read-failed/)
  broken = false; const first = analysis.pairIndex(request); assert.deepEqual([...first.calls], ['old'])
  assert.equal(cache.report().find(row => row.name === 'request-plan-pairs')?.work, 1)
  analysis.close(); request.messages[0].content[0].id = 'new'
  const fresh = createRequestPlanCache(requestImpact, cache); t.after(() => fresh.close())
  assert.deepEqual([...fresh.pairIndex(request).calls], ['new']); assert.deepEqual([...first.calls], ['old'])
})

test('cleanup keeps the original paired predicate for empty result bodies with and without operation analysis', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const request = { messages: [{ role: 'assistant', content: [{ type: 'tool-call', id: 'paired' }] }, { role: 'tool', toolCallId: 'paired', content: [] }] }
  const analysis = createRequestPlanCache(requestImpact, cache); t.after(() => analysis.close())
  const options = { request, blocks: [], rules: [], events: [], snapshot: {}, templates: {}, decision: () => ({ enabled: true }) }
  assert.throws(() => planRequestV2(options), /tool-call-result-pair-broken/)
  assert.throws(() => planRequestV2({ ...options, analysis }), /tool-call-result-pair-broken/)
  assert.equal(request.messages.length, 2); assert.equal(request.messages[1].content.length, 0)
  // A pre-existing unpaired call is allowed by the existing predicate.
  const unpaired = { messages: [request.messages[0], { role: 'user', content: [] }] }
  const result = planRequestV2({ ...options, request: unpaired, analysis })
  assert.equal(result.request.messages.length, 1); assert.notEqual(result.request, unpaired)
})
