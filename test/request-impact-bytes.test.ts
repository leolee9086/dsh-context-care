import { publicRequestBytes, requestImpact, createRequestPlanCache } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

import { createSessionCache } from '../lib/session-cache.js'
import { planRequestV2 } from '../src/request-plan.js'

const input = () => ({ provider: 'p', model: 'm', system: '中文🙂', tools: [{ name: 'inspect', schema: { type: 'object' } }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'COMPLETE ' + 'x'.repeat(8192) }] }] })

test('public request bytes preserve full fields order Unicode and exclusions without truncation', () => {
  const request = { messages: [], system: '中🙂', temperature: 0, maxTokens: 12, stop: ['STOP'], reasoningEffort: 'high',
    tools: [{ name: '工具' }], provider: 'p', model: 'm', signal: new AbortController().signal,
    get privateField(): never { throw new Error('private-request-field-read') } }
  const expected = '{"provider":"p","model":"m","reasoningEffort":"high","temperature":0,"maxTokens":12,"stop":["STOP"],"system":"中🙂","tools":[{"name":"工具"}],"messages":[]}'
  assert.deepEqual(publicRequestBytes(request), Buffer.from(expected, 'utf8'))
  const large = input(); assert.ok(publicRequestBytes(large).length > 8192)
})

test('one planning operation serializes each immutable baseline and candidate once with exact comparisons', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const analysis = createRequestPlanCache(requestImpact, cache); t.after(() => analysis.close())
  const baseline = input(), candidates = Array.from({ length: 20 }, (_, index) => {
    const next = structuredClone(baseline); next.messages[0].content[0].text += `候选${index}🙂`; return next
  })
  const expected = candidates.map(candidate => requestImpact(baseline, candidate))
  const stringify = t.mock.method(JSON, 'stringify')
  for (let repeat = 0; repeat < 3; repeat++) for (let index = 0; index < candidates.length; index++) {
    assert.deepEqual(analysis.impact(baseline, candidates[index]), expected[index])
  }
  const payloads = new Set([baseline.messages, ...candidates.map(candidate => candidate.messages)])
  assert.equal(stringify.mock.calls.filter(call => payloads.has(call.arguments[0]?.messages)).length, 21)
  assert.equal(cache.report().find(row => row.name === 'request-plan-bytes')?.work, 21)
  const prior = analysis.impact(baseline, candidates[0])
  assert.equal(prior.beforeBytes, publicRequestBytes(baseline).length); assert.equal(prior.firstChangedByte, prior.commonPrefixBytes)
  const options = { request: baseline, blocks: [], rules: [], events: [], templates: {}, snapshot: {}, decision: () => ({ enabled: false }), analysis }
  assert.throws(() => planRequestV2({ ...options, maxRequestBytes: prior.beforeBytes - 1 }), /request-byte-budget-exceeded/)
  assert.equal(planRequestV2({ ...options, maxRequestBytes: prior.beforeBytes }).request, baseline)
  assert.equal(cache.report().find(row => row.name === 'request-plan-bytes')?.work, 21, 'cached full bytes still enforce every budget boundary')
  analysis.close(); assert.equal(cache.report().length, 0)
  assert.throws(() => analysis.impact(baseline, candidates[0]), /cache-closed/)
  assert.throws(() => analysis.read(baseline), /cache-closed/)
  assert.throws(() => analysis.blockIndex([]), /cache-closed/); assert.equal(cache.report().length, 0)
})

test('failed serialization is unpublished and a fresh operation observes changed mutable payloads', t => {
  const cache = createSessionCache(); t.after(() => cache.close())
  const one = createRequestPlanCache(requestImpact, cache); t.after(() => one.close())
  const message = { role: 'user', content: [{ type: 'text', text: 'BEFORE' }] }
  const request: { messages: typeof message[]; tools?: unknown } = { messages: [message] }
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic; request.tools = cyclic
  assert.throws(() => one.read(request), /circular/i)
  assert.equal(cache.report().find(row => row.name === 'request-plan-bytes')?.work, 0)
  delete request.tools
  const first = one.read(request).impact; assert.equal(first, one.read(request).impact)
  one.close(); message.content[0].text = 'AFTER LONGER'
  const two = createRequestPlanCache(requestImpact, cache); t.after(() => two.close())
  const second = two.read(request).impact
  assert.notEqual(second.beforeBytes, first.beforeBytes); assert.deepEqual(second, requestImpact(request, request))
})
