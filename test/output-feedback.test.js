import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { openOutputFeedback } from '../src/output-feedback.js'
import { resolveScopedPrompts } from '../src/scoped-prompts.js'
import { detectorFixture } from './fixtures/detector.js'

const route = { provider: 'p', model: 'a' }
const abnormal = '我不会做第一项。\n我不会做第二项。\n我不会做第三项。'
const rule = (provider = 'p', model = 'a', carryFromOtherRoute = false) => ({ ruleId: `rule-${model}`, version: '1', provider, model,
  trigger: 'output-pattern', detector: detectorFixture, carryFromOtherRoute,
  text: '源 {sourceModel}、当前 {boundModelLabel}，命中 {H} 处，语句 {K}/{N}。检查事实并继续。' })
const rules = resolveScopedPrompts([rule()])

async function fixture(t, configured = rules, seed) {
  const ctx = new Context(), sessions = new SessionStore(ctx)
  const session = sessions.create(SessionId('s1'), seed ? { seed: seed.events, meta: seed.header } : undefined)
  let feedback
  const open = async () => {
    feedback = await openOutputFeedback({ sessions, rulesFor: () => configured, eligible: () => true, revision: () => 0 })
    return feedback
  }
  t.after(async () => { await feedback?.close(); await ctx.fiber.dispose() })
  await open()
  let step = 0
  function request(segments = [], callId = `test-call-${step}`, receiving = route, outcome = 'completed', text = 'Actual verified work continues.') {
    step++
    session.append('step/start', { turn: 0, step })
    session.append('request/header', { header: { config: receiving }, reason: 'series',
      ...(segments.length ? { contextCarePrompt: { callId, segments } } : {}) })
    const event = outcome === 'failed'
      ? session.append('assistant/attempt', { turn: 0, step, stream: [] })
      : session.append('assistant/message', { turn: 0, step, stream: [],
        ...(outcome === 'interrupted' ? { interrupted: true } : {}),
        message: createMessage({ role: 'assistant', source: { kind: 'model', ...receiving }, content: [{ type: 'text', text }] }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 0, step })
    return event
  }
  return { session, request, open, get feedback() { return feedback },
    seed: () => ({ events: session.snapshotEvents(), header: session.header }),
    output: (text = abnormal, receiving = route) => request([], undefined, receiving, 'completed', text) }
}

test('feedback without detectors reads no history and added detectors recover from native events without snapshots', async t => {
  const configured = [], owned = await fixture(t, configured), { session, feedback } = owned
  owned.output()
  const reads = t.mock.method(session, 'eventAt')
  t.mock.method(session, 'snapshotEvents', () => assert.fail('feedback must not materialize a duplicate native log'))
  assert.deepEqual(feedback.collect(session, route, configured), [])
  assert.equal(reads.mock.callCount(), 0, 'an unrelated request needs no native output history')
  configured.push(...rules)
  const segments = feedback.collect(session, route, configured)
  assert.equal(segments.length, 1, 'the new rule reconstructs the earlier actual output')
  const initialReads = reads.mock.callCount(), initialEnd = session.seq
  feedback.collect(session, route, configured)
  assert.equal(reads.mock.callCount(), initialReads, 'a current cache requires no new event reads')
  owned.output('实际验证通过。')
  feedback.collect(session, route, configured)
  const nextReads = reads.mock.calls.slice(initialReads).map(call => call.arguments[0])
  assert.deepEqual(nextReads, Array.from({ length: session.seq - initialEnd }, (_, index) => initialEnd + index),
    'hot updates read only newly committed events')
})

test('duplicate committed seq does not retrigger, cooldown and healthy rearm need new completed evidence', async t => {
  const owned = await fixture(t), { session, feedback } = owned
  const original = owned.output()
  await feedback.observe(session, original, route, rules)
  let segments = feedback.collect(session, route, rules)
  assert.equal(segments.length, 1)
  await feedback.reserve(session, segments, 'call1')
  owned.request(segments, 'call1', route, 'completed', abnormal)
  await feedback.dispatched(session, segments, 'call1', route)
  await feedback.observe(session, original, { provider: 'forged', model: 'forged' }, rules)
  assert.equal(feedback.collect(session, route, rules).length, 0)
  owned.output()
  assert.equal(feedback.collect(session, route, rules).length, 0)
  owned.output('实际验证通过。')
  owned.output('继续执行下一项。')
  const latest = owned.output()
  segments = feedback.collect(session, route, rules)
  assert.equal(segments.length, 1)
  assert.deepEqual(segments[0].sourceSeqs, [latest.seq])
  assert.equal(feedback.list()[0].window.length, 3)
})

test('known unstarted feedback preparation consumes no native allowance and cannot undo delivery', async t => {
  const owned = await fixture(t), { session, feedback } = owned
  owned.output()
  const segments = feedback.collect(session, route, rules)
  const previous = structuredClone(feedback.list())
  await feedback.reserve(session, segments, 'known-unstarted')
  assert.equal(feedback.collect(session, route, rules).length, 0, 'a live reservation coordinates concurrent preparation')
  await feedback.rollback(session, 'known-unstarted')
  await feedback.rollback(session, 'known-unstarted')
  assert.deepEqual(feedback.list(), previous)
  await feedback.reserve(session, segments, 'sent')
  owned.request(segments, 'sent')
  await feedback.dispatched(session, segments, 'sent', route)
  await feedback.rollback(session, 'sent')
  assert.equal(feedback.list()[0].lastDelivery.status, 'dispatched')
  assert.equal(feedback.list()[0].pending, undefined)
})

test('native cold restore retains pending and bounds actual requests with unknown delivery', async t => {
  const first = await fixture(t)
  first.output()
  const firstSegments = first.feedback.collect(first.session, route, rules)
  first.request(firstSegments, 'unknown1', route, 'failed')
  const second = await fixture(t, rules, first.seed())
  const replay = second.feedback.collect(second.session, route, rules)
  assert.equal(replay[0].segmentId, firstSegments[0].segmentId)
  assert.equal(second.feedback.list()[0].pending.deliveries, 1)
  second.request(replay, 'unknown2', route, 'failed')
  const third = await fixture(t, rules, second.seed())
  assert.equal(third.feedback.collect(third.session, route, rules).length, 0)
  assert.equal(third.feedback.list()[0].lastDelivery.status, 'delivery-unknown')
  third.output('实际验证通过。')
  assert.equal(third.feedback.list()[0].pending, undefined)
  assert.equal(third.feedback.list()[0].lastDelivery.exhausted, true)
  third.output('接着完成新阶段。')
  third.output()
  const next = third.feedback.collect(third.session, route, rules)
  assert.equal(next.length, 1)
  assert.notEqual(next[0].segmentId, firstSegments[0].segmentId)
})

test('target route explicitly allows carry and separates source from receiving model; otherwise supersedes', async t => {
  const two = resolveScopedPrompts([rule(), rule('p', 'b', true)])
  const owned = await fixture(t, two), { session, feedback } = owned
  owned.output()
  const segments = feedback.collect(session, { provider: 'p', model: 'b' }, two)
  assert.equal(segments.length, 1)
  assert.match(segments[0].text, /源 p\/a、当前 p\/b/)
  assert.equal(feedback.collect(session, { provider: 'p', model: 'unconfigured' }, two).length, 0)
  owned.request([], 'other', { provider: 'p', model: 'unconfigured' })
  await feedback.dispatched(session, [], 'other', { provider: 'p', model: 'unconfigured' })
  assert.equal(feedback.collect(session, route, two).length, 0)
  assert.equal(feedback.list()[0].lastDelivery.status, 'superseded')
  feedback.clear()
  assert.equal(feedback.collect(session, route, two).length, 0, 'the cross-route native dispatch also reconstructs after cache loss')
})

test('interrupted and failed native output do not establish output-pattern observations', async t => {
  const owned = await fixture(t), { session, feedback } = owned
  owned.request([], 'interrupted', route, 'interrupted', abnormal)
  owned.request([], 'failed', route, 'failed', abnormal)
  assert.deepEqual(feedback.list(), [])
  assert.deepEqual(feedback.collect(session, route, rules), [])
  owned.output()
  const expected = feedback.collect(session, route, rules)
  expected[0].metrics.H = 999
  expected[0].sourceSeqs.push(999)
  assert.equal(feedback.collect(session, route, rules)[0].metrics.H, 3)
  assert.notDeepEqual(feedback.collect(session, route, rules)[0].sourceSeqs, expected[0].sourceSeqs)
})
