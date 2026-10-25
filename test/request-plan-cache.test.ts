import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestPlanCache } from '../lib/request-plan-cache.js'
import { createSessionCache } from '../lib/session-cache.js'
import { planRequestV2 } from '../src/request-plan.js'
import { requestImpact } from '../src/request-impact.js'

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
