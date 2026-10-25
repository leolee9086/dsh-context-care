import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestPlanCache } from '../lib/request-plan-cache.js'
import { createSessionCache } from '../lib/session-cache.js'
import { planRequestV2 } from '../src/request-plan.js'
import { requestImpact } from '../src/request-impact.js'
import { indexRequestBlocks, filteredAncestor } from '../lib/request-block-index.js'

const input = () => ({ messages: [{ id: 'input', role: 'user', content: [{ type: 'text', text: 'Keep exactly.' }] }] })
const options = { blocks: [], rules: [], events: [], templates: {}, snapshot: {}, decision: () => ({ enabled: false }) }

test('request plans reuse unchanged payloads and measure an immutable request once', t => {
  const cache = createSessionCache()
  t.after(() => cache.close())
  let measurements = 0
  const analysis = createRequestPlanCache((before: ReturnType<typeof input>, after: ReturnType<typeof input>) => {
    measurements++; return requestImpact(before, after)
  }, cache)
  t.after(() => analysis.close())
  const request = input()
  Object.freeze(request.messages[0].content[0]); Object.freeze(request.messages[0].content)
  Object.freeze(request.messages[0]); Object.freeze(request.messages); Object.freeze(request)
  for (let count = 0; count < 20; count++) {
    const planned = planRequestV2({ ...options, request, analysis })
    assert.equal(planned.request, request)
    assert.equal(planned.diff.after.messages, request.messages)
    assert.equal(planned.impact.changedSuffixBytes, 0)
    assert.equal(analysis.impact(request, planned.request), planned.impact)
  }
  assert.equal(measurements, 1)
  assert.throws(() => planRequestV2({ ...options, request, analysis, maxRequestBytes: 1 }), /request-byte-budget-exceeded/)
  assert.equal(measurements, 1, 'cached size still enforces each plan budget')
  assert.equal(cache.report().find(row => row.name === 'request-plan-analysis')?.work, 1)
  analysis.close()
  assert.equal(cache.report().some(row => row.name === 'request-plan-analysis'), false, 'operation completion releases its domain')
})

test('request block groups reuse one immutable array and release with the planning operation', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache); t.after(() => analysis.close())
  let reads = 0
  const blocks = Array.from({ length: 4000 }, (_, index) => ({ id: `block-${index}`, view: index % 2 ? 'model' : 'original',
    messageIndex: index, path: '0', get callId() { reads++; return `call-${Math.floor(index / 4)}` } }))
  const first = analysis.blockIndex(blocks)
  assert.equal(reads, 4000); assert.equal(first.model.length, 2000)
  assert.deepEqual(first.byCall.get('call-0'), blocks.slice(0, 4))
  for (let count = 0; count < 20; count++) assert.equal(analysis.blockIndex(blocks), first)
  assert.equal(reads, 4000); assert.equal(cache.report().find(row => row.name === 'request-plan-block-index')?.work, 4000)
  const second = analysis.blockIndex([...blocks])
  assert.notEqual(second, first); assert.equal(reads, 8000)
  assert.equal(second.model[0], first.model[0], 'index never clones payload bodies')
  analysis.close(); assert.ok(!cache.report().some(row => row.name === 'request-plan-block-index'))
})

test('request block ancestor lookup respects message identity, numeric components and synthetic result wrappers', () => {
  const block = { id: 'leaf', view: 'model', messageIndex: 3, path: '1.0.12' }
  const removed = new Set([JSON.stringify([3, '1']), JSON.stringify([4, '0']), JSON.stringify([3, '$result'])])
  assert.equal(filteredAncestor(block, removed), true)
  assert.equal(filteredAncestor({ ...block, messageIndex: 4 }, removed), false)
  assert.equal(filteredAncestor({ ...block, path: '10.0' }, removed), false)
  assert.equal(filteredAncestor({ ...block, path: '0.0' }, removed), false)
  const other = { ...block, id: 'other', view: 'original' }
  const index = indexRequestBlocks([other, block])
  assert.deepEqual(index.model, [block]); assert.equal(index.byId.get('leaf'), block)
})

test('request plans own modified cleanup payloads and preserve the original', t => {
  const cache = createSessionCache()
  t.after(() => cache.close())
  const request = input(); request.messages.push({ id: 'empty', role: 'user', content: [] })
  const analysis = createRequestPlanCache(requestImpact, cache)
  t.after(() => analysis.close())
  const planned = planRequestV2({ ...options, request, analysis })
  assert.notEqual(planned.request, request)
  assert.equal(planned.request.messages.length, 1); assert.equal(request.messages.length, 2)
  planned.request.messages[0].content[0].text = 'Edited owned result'
  assert.equal(request.messages[0].content[0].text, 'Keep exactly.')
})
