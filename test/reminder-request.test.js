import { REMINDER_DOMAIN, createBoundedMatcher } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'
import { createReminderRuntime } from './reminder-runtime-fixture.ts'

const rule = eventRule('request.before', { id: 'night', event: { timeWindow: { start: '23:00', end: '06:00', timeZone: 'local' }, humanActivity: { withinSeconds: 300 } } },
  { template: '没有紧急任务时，温和建议伙伴早点睡。', delivery: { model: { once: 'window' } } })
const source = { sourceId: 'notes', plugin: 'test', revision: 1, rules: [rule] }
const date = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const message = (id = 'human', kind = 'user') => ({ id, role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind } })
const arrival = (at, input = message(), seq = 0) => ({ type: 'agent/inbox/spliced', seq, time: at, data: { inserted: [input] } })
function fixture(t, options = {}) {
  let clock = date(14, 23)
  const saved = new Map(options.entries ?? [])
  const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 2000 })
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: (input, signal) => matcher.detect(input, signal), wallNow: () => clock,
    save: async (id, value) => { REMINDER_DOMAIN.tables.sessions.valueSchema.parse(value); saved.set(id, structuredClone(value)) }, ...options })
  const handle = runtime.registerSource(source)
  t.after(async () => { await runtime.close(); await matcher.close() })
  const prepare = (events = [arrival(clock)], sessionId = 's') => runtime.prepareRequest({ sessionId, events, accepted: [message()] })
  const collect = (extra = {}) => runtime.collect({ sessionId: 's', visible: [], ...extra })
  return { runtime, handle, saved, prepare, collect, time: value => { clock = value } }
}

test('pure conversation triggers at 23:00; midnight belongs to the previous evening; next night can remind with old surface retained', async t => {
  const f = fixture(t)
  f.time(date(14, 22, 59)); await f.prepare(); assert.deepEqual(await f.collect(), [])
  f.time(date(14, 23)); await f.prepare(); const first = await f.collect(); assert.equal(first.length, 1)
  assert.equal(first[0].content[0].text, rule.actions[0].template)
  f.time(date(15, 0)); await f.prepare(); assert.deepEqual(await f.collect({ committedIds: [first[0].id] }), [])
  f.time(date(15, 6)); await f.prepare(); assert.deepEqual(await f.collect(), [])
  f.time(date(15, 23)); await f.prepare(); const second = await f.collect({ visible: first }); assert.equal(second.length, 1)
  assert.notEqual(first[0].source.reminder.key, second[0].source.reminder.key)
})

test('only recent original human arrivals establish presence; unknown, automatic, delayed, future and inherited inputs do not', async t => {
  const f = fixture(t), now = date(14, 23)
  for (const events of [[], [arrival(now, message('notice', 'plugin:notice'))],
    [arrival(now - 300001)], [arrival(now + 1)],
    [arrival(now - 600000), { type: 'user/message', seq: 1, time: now, data: message() }],
    [arrival(now), { type: 'session/end-seed', seq: 1, time: now, data: { inherited: true } }]]) {
    await f.prepare(events); assert.deepEqual(await f.collect(), [])
  }
  // An ordinary restore marker leaves recent human evidence intact.
  await f.prepare([arrival(now - 300000), { type: 'session/end-seed', seq: 1, time: now, data: {} }])
  assert.equal((await f.collect()).length, 1)
})

test('durable claims survive restart, source text changes, compaction and candidate eviction', async t => {
  const f = fixture(t, { config: { maxCandidates: 1, ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  await f.prepare(); const first = await f.collect()
  await f.collect({ committedIds: [first[0].id] })
  f.handle.replace({ ...source, revision: 2, rules: [{ ...rule, actions: rule.actions.map(action => ({ ...action, template: '更新正文' })) }] })
  await f.prepare(); assert.deepEqual(await f.collect(), [])
  assert.ok(!f.saved.get('s').candidates.some(item => item.messageId === first[0].id))
  const restart = fixture(t, { entries: [...f.saved] })
  await restart.prepare(); assert.deepEqual(await restart.collect(), [])
})

test('known rollback permits retry; unknown handoff after restart remains claimed', async t => {
  const f = fixture(t)
  await f.prepare(); const first = await f.collect()
  const restart = fixture(t, { entries: [...f.saved] })
  await restart.prepare(); assert.deepEqual(await restart.collect(), [])
  await f.runtime.rollback('s', first)
  assert.equal((await f.collect()).length, 1)
})

test('snooze persists before first delivery, survives restart, and expires at the window end', async t => {
  const f = fixture(t)
  assert.equal((await f.runtime.snooze({ sessionId: 's' })).length, 1)
  await f.prepare(); assert.deepEqual(await f.collect(), [])
  const restart = fixture(t, { entries: [...f.saved] })
  await restart.prepare(); assert.deepEqual(await restart.collect(), [])
  restart.time(date(15, 23)); await restart.prepare(); assert.equal((await restart.collect()).length, 1)
})

test('snooze after reservation filters handoff; rollback cannot erase the explicit snooze', async t => {
  const f = fixture(t)
  await f.prepare(); const messages = await f.collect()
  await f.runtime.snooze({ sessionId: 's', sourceId: 'notes', ruleId: 'night' })
  assert.deepEqual(await f.runtime.filterMessages('s', [], messages), [])
  await f.runtime.rollback('s', messages)
  await f.prepare(); assert.deepEqual(await f.collect(), [])
})

test('candidate eligibility is rechecked at delivery when presence or the time window expires', async t => {
  const f = fixture(t)
  await f.prepare(); f.time(date(14, 23, 6)); assert.deepEqual(await f.collect(), [])
  await f.prepare(); assert.equal((await f.collect()).length, 1)
  f.time(date(15, 5, 59)); await f.prepare([], 'another')
  // A second identity has no previous delivery claim.
  await f.prepare([arrival(date(15, 5, 59))], 'another')
  f.time(date(15, 6)); assert.deepEqual(await f.collect({ sessionId: 'another' }), [])
})

// Failed claim/snooze writes and durable recovery are exercised with native
// storage failures in reminder-request-real.test.ts via test:integration:source.

test('concurrent collections reserve once; rollback of an acknowledged delivery cannot free its window', async t => {
  const f = fixture(t)
  await Promise.all([f.prepare(), f.prepare()])
  const batches = await Promise.all([f.collect(), f.collect()])
  const delivered = batches.flat(); assert.equal(delivered.length, 1)
  assert.equal(delivered[0].source.contextCareTrace.evidence.clock.at, date(14, 23))
  assert.equal(delivered[0].source.contextCareTrace.evidence.humanActivity.evidence, 'human-message')
  await f.collect({ committedIds: [delivered[0].id] })
  await f.runtime.rollback('s', delivered)
  await f.prepare(); assert.deepEqual(await f.collect(), [])
});

test('daytime windows, source replacement, condition trees and session scope use the same scheduler', async t => {
  const f = fixture(t)
  f.handle.replace({ ...source, revision: 2, rules: [{ ...rule, event: { ...rule.event, timeWindow: { start: '08:00', end: '09:00' } },
    match: { kind: 'compare', field: 'context.messages.0.text', op: 'eq', value: '继续' } }] })
  f.time(date(14, 7, 59)); await f.prepare(); assert.deepEqual(await f.collect(), [])
  f.time(date(14, 8)); await f.prepare(); assert.equal((await f.collect()).length, 1)
  await f.prepare([arrival(date(14, 8))], 'other'); assert.equal((await f.collect({ sessionId: 'other' })).length, 1)
  f.time(date(14, 9)); await f.prepare([arrival(date(14, 9))], 'third'); assert.deepEqual(await f.collect({ sessionId: 'third' }), [])
});

test('unified declarations require valid local windows for window delivery', async t => {
  const f = fixture(t)
  const validate = input => f.runtime.validateRule(input)
  assert.deepEqual(validate(rule).on, ['request.before'])
  for (const input of [ { ...rule, format: 'reminder/v3' },
    { ...rule, event: {} }, { ...rule, event: { timeWindow: { start: '24:00', end: '06:00' } } },
    { ...rule, event: { timeWindow: { start: '23:00', end: '23:00' } } },
    { ...rule, event: { ...rule.event, tool: 'read' } } ]) assert.throws(() => validate(input))
  await assert.rejects(f.runtime.snooze({ sessionId: 's', ruleId: 'night' }), /together/)
})
