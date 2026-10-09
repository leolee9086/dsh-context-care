import test from 'node:test'
import assert from 'node:assert/strict'
import { openOutputFeedback } from '../src/output-feedback.js'
import { resolveScopedPrompts } from '../src/scoped-prompts.js'
import { detectorFixture } from './fixtures/detector.js'

const session = { id: 's1' }
const route = { provider: 'p', model: 'a' }
const abnormal = '我不会做第一项。\n我不会做第二项。\n我不会做第三项。'
const event = (seq, text = abnormal) => ({ seq, data: { message: { content: [{ type: 'text', text }] } } })
const rule = (provider = 'p', model = 'a', carryFromOtherRoute = false) => ({ ruleId: `rule-${model}`, version: '1', provider, model,
  trigger: 'output-pattern', detector: detectorFixture, carryFromOtherRoute,
  text: '源 {sourceModel}、当前 {boundModelLabel}，命中 {H} 处，语句 {K}/{N}。检查事实并继续。' })
const rules = resolveScopedPrompts([rule()])
function storage() {
  const records = new Map()
  return { records, open: async () => ({ table: () => ({ entries: () => records.entries(), put: async (key, value) => records.set(key, value) }), close: async () => {} }) }
}

test('duplicate committed seq does not retrigger, cooldown and healthy rearm need new completed evidence', async () => {
  const store = storage()
  const feedback = await openOutputFeedback(store)
  await feedback.observe(session, event(2), route, rules)
  let segments = feedback.collect(session, route, rules)
  assert.equal(segments.length, 1)
  await feedback.reserve(session, segments, 'call1')
  await feedback.dispatched(session, segments, 'call1', route)
  await feedback.observe(session, event(2), route, rules)
  assert.equal(feedback.collect(session, route, rules).length, 0)
  await feedback.observe(session, event(3), route, rules)
  await feedback.observe(session, event(4), route, rules)
  assert.equal(feedback.collect(session, route, rules).length, 0)
  await feedback.observe(session, event(5, '实际验证通过。'), route, rules)
  await feedback.observe(session, event(6, '继续执行下一项。'), route, rules)
  await feedback.observe(session, event(7), route, rules)
  segments = feedback.collect(session, route, rules)
  assert.equal(segments.length, 1)
  assert.deepEqual(segments[0].sourceSeqs, [7])
  assert.equal(feedback.list()[0].window.length, 3)
  await feedback.close()
})

test('known unstarted feedback handoff restores the prior allowance without undoing delivery', async () => {
  const feedback = await openOutputFeedback(storage())
  await feedback.observe(session, event(2), route, rules)
  const segments = feedback.collect(session, route, rules)
  await feedback.reserve(session, segments, 'older-unknown')
  const previous = structuredClone(feedback.list())
  await feedback.reserve(session, segments, 'known-unstarted')
  await feedback.rollback(session, 'known-unstarted')
  await feedback.rollback(session, 'known-unstarted')
  assert.deepEqual(feedback.list(), previous)
  await feedback.reserve(session, segments, 'sent')
  await feedback.dispatched(session, segments, 'sent', route)
  await feedback.rollback(session, 'sent')
  assert.equal(feedback.list()[0].lastDelivery.status, 'dispatched')
  assert.equal(feedback.list()[0].pending, undefined)
  await feedback.close()
})

test('cold restore retains pending and bounds replay of a reserved but unknown delivery', async () => {
  const store = storage()
  let feedback = await openOutputFeedback(store)
  await feedback.observe(session, event(2), route, rules)
  const first = feedback.collect(session, route, rules)
  await feedback.reserve(session, first, 'unknown1')
  await feedback.close()
  feedback = await openOutputFeedback(store)
  const replay = feedback.collect(session, route, rules)
  assert.equal(replay[0].segmentId, first[0].segmentId)
  await feedback.reserve(session, replay, 'unknown2')
  await feedback.close()
  feedback = await openOutputFeedback(store)
  assert.equal(feedback.collect(session, route, rules).length, 0)
  assert.equal(feedback.list()[0].lastDelivery.status, 'delivery-unknown')
  await feedback.observe(session, event(3, '实际验证通过。'), route, rules)
  assert.equal(feedback.list()[0].pending, undefined)
  assert.equal(feedback.list()[0].lastDelivery.exhausted, true)
  await feedback.observe(session, event(4, '接着完成新阶段。'), route, rules)
  await feedback.observe(session, event(5), route, rules)
  const next = feedback.collect(session, route, rules)
  assert.equal(next.length, 1)
  assert.notEqual(next[0].segmentId, first[0].segmentId)
  await feedback.close()
})

test('target route explicitly allows carry and separates source from receiving model; otherwise supersedes', async () => {
  const feedback = await openOutputFeedback(storage())
  const two = resolveScopedPrompts([rule(), rule('p', 'b', true)])
  await feedback.observe(session, event(2), route, two)
  const segments = feedback.collect(session, { provider: 'p', model: 'b' }, two)
  assert.equal(segments.length, 1)
  assert.match(segments[0].text, /源 p\/a、当前 p\/b/)
  assert.equal(feedback.collect(session, { provider: 'p', model: 'unconfigured' }, two).length, 0)
  await feedback.dispatched(session, [], 'other', { provider: 'p', model: 'unconfigured' })
  assert.equal(feedback.collect(session, route, two).length, 0)
  assert.equal(feedback.list()[0].lastDelivery.status, 'superseded')
  await feedback.close()
})
