import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { createSessionClaims } from '../src/reminder-runtime/session-claims.ts'
import { createReminderRuntime, type ReminderRuleInput } from '../src/reminder-runtime/runtime.ts'
import { createSessionDeliveries } from '../src/reminder-runtime/session-deliveries.ts'
import { createBoundedMatcher } from '../src/bounded-matcher.js'

interface Harness {
  open(t: TestContext): Promise<{ ctx: Context; session: Session; expirySession: Session }>
}

// Declaration and body read from SiYuan callout 20261014114116-cduofoj.
// Only the fixture clock changes; this does not claim a live SiYuan delivery.
const rule: ReminderRuleInput = {
  format: 'reminder/v4', id: 'test-window-1140-1150', on: 'request.before',
  text: '这是刚设置的 11:40–11:50 时间窗口测试提醒。收到这条提醒后，明确告诉哥哥：“我收到思源的时间窗口提醒了。”这条规则在当前会话的本次时间窗口只提醒一次。',
  when: { timeWindow: { start: '11:40', end: '11:50', timeZone: 'local' } },
  effect: { kind: 'remind', deliver: { model: { once: 'window' } } },
}
const time = (day: number, hour: number, minute: number, second = 0, millisecond = 0) =>
  new Date(2026, 9, day, hour, minute, second, millisecond).getTime()

/** Validate the copied declaration against a real Loader, Session and Worker. */
export function registerSiyuanWindowHostCases(harness: Harness): void {
  for (const clockLayout of ['event', 'flat'] as const) test(
    `historical rule snapshots restore delivery facts without current rule validation (${clockLayout} clock)`, async t => {
    const { ctx, session } = await harness.open(t)
    const at = time(25, 11, 41), sourceId = 'historical-rules'
    // 两种布局都由原生消息保存；恢复不能把旧版平铺时钟当成缺失。
    const evidence = clockLayout === 'event' ? { event: { clock: { at } } } : { clock: { at } }
    const windowKey = JSON.stringify([sourceId, 'window', 'model', '2026-10-25'])
    // 旧版原生消息的规则布局不同于当前 UserMessage 类型；保留原始数据，不升级它。
    const windowMessage = { id: 'historical-window-message', role: 'user',
      content: [{ type: 'text', text: 'Recorded window notice' }],
      source: { kind: 'plugin:dsh-context-care:reminder', summary: 'Recorded window',
        reminder: { key: windowKey, candidateId: 'historical-window',
          ...(clockLayout === 'event' ? { sessionId: String(session.id) } : {}) },
        contextCareTrace: { sourceId, ruleId: 'window', callId: 'old-window-request',
          // 现场 seq 32571、53383 的 v2 窗口记录没有 sessionId，时钟为平铺字段。
          rule: { format: clockLayout === 'flat' ? 'reminder/v2' : 'reminder/v3', id: 'window', on: 'request.before', priority: 0,
            text: 'Recorded window notice', when: { timeWindow: { start: '11:40', end: '11:50', timeZone: 'local' } },
            deliver: { model: { once: 'window', shared: { reset: 'window', limit: 1 } } } },
          evidence } } } as unknown as UserMessage
    const stickyMessage = { id: 'historical-sticky-message', role: 'user',
      content: [{ type: 'text', text: 'Recorded sticky notice' }],
      source: { kind: 'plugin:dsh-context-care:reminder', summary: 'Recorded sticky',
        reminder: { key: JSON.stringify([sourceId, 'sticky', 'model']),
          candidateId: 'historical-sticky', sessionId: String(session.id) },
        contextCareTrace: { sourceId, ruleId: 'sticky', callId: 'old-sticky-request',
          rule: { format: 'reminder/v3', id: 'sticky', on: 'request.before', priority: 0,
            text: 'Recorded sticky notice', when: {}, deliver: { model: { once: 'none',
              sticky: { clock: 'main-request', lifetime: 3, cooldown: 1 },
              shared: { reset: 'lifetime', lifetime: 'recorded-campaign', limit: 1 } } } },
          evidence } } } as unknown as UserMessage
    session.append('user/message', windowMessage, { surfaceOp: 'append' })
    session.append('user/message', stickyMessage, { surfaceOp: 'append' })
    // 冷恢复直接读取真实 Session，不能靠当前规则重新匹配这些消息。
    const deliveries = createSessionDeliveries(ctx, () => at)
    const claims = createSessionClaims(ctx, () => at)
    t.after(async () => { deliveries.close(); await claims.close() })
    const restored = await deliveries.read(String(session.id), '')
    assert.deepEqual(restored.windows, [{ key: windowKey, until: time(25, 11, 50), messageId: windowMessage.id }])
    assert.equal(restored.committedIds.has(windowMessage.id), true)
    assert.equal(restored.committedIds.has(stickyMessage.id), true)
    assert.equal(restored.stickies.length, 1)
    assert.deepEqual(restored.stickies.map(({ activationId, clock, remaining, cooldown, charged }) =>
      ({ activationId, clock, remaining, cooldown, charged })),
    [{ activationId: 'historical-sticky', clock: 'main-request', remaining: 2, cooldown: 1, charged: true }])
    const book = await claims.update(value => value)
    assert.deepEqual(book.buckets, [
      { key: JSON.stringify([sourceId, 'window', 'window', '2026-10-25']), until: time(25, 11, 50),
        claims: [{ candidateId: 'historical-window', sessionId: String(session.id), messageId: windowMessage.id, status: 'consumed' }] },
      { key: JSON.stringify([sourceId, 'sticky', 'lifetime', 'recorded-campaign']),
        claims: [{ candidateId: 'historical-sticky', sessionId: String(session.id), messageId: stickyMessage.id, status: 'consumed' }] },
    ])
    assert.deepEqual((await deliveries.read(String(session.id), '')).windows, restored.windows)
    assert.deepEqual(await claims.update(value => value), book)
  })

  test('SiYuan 11:40 window: native delivery, deduplication, expiry and next-day recovery', { timeout: 30000 }, async t => {
    const { ctx, session, expirySession } = await harness.open(t)
    let at = time(25, 11, 39, 59, 999)
    const matcher = createBoundedMatcher({ timeoutMs: 2000, maxIdle: 1 })
    const deliveries = createSessionDeliveries(ctx, () => at)
    deliveries.created(session); deliveries.created(expirySession)
    const unobserve = ctx.on('session/event', (owner, event) => deliveries.observe(owner, event))
    const createRuntime = () => {
      const runtime = createReminderRuntime({ sessionAuthoritative: true, dispatches: true, wallNow: () => at,
        config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
        execute: (input, signal, timing) => matcher.detect(input, signal, timing),
        readDeliveries: (id, humanId) => deliveries.read(id, humanId) })
      runtime.registerSource({ sourceId: 'siyuan-window-fixture', plugin: 'test', revision: 1, rules: [rule] })
      return runtime
    }
    let runtime = createRuntime()
    t.after(async () => {
      await runtime.close(); unobserve(); deliveries.close(); await matcher.close()
    })
    await matcher.warmup()
    const collect = async (owner: Session) => {
      const sessionId = String(owner.id)
      await runtime.prepareRequest({ sessionId, events: owner.snapshotEvents() })
      return runtime.collect({ sessionId, visible: owner.deriveMessages() })
    }
    assert.deepEqual(await collect(session), [], '11:39:59.999 is outside the window')
    at = time(25, 11, 40)
    const first = await collect(session)
    assert.equal(first.length, 1, '11:40:00.000 starts the window')
    assert.equal(first[0]!.content[0]!.text, rule.text)
    assert.equal(first[0]!.source.contextCareTrace.ruleId, rule.id)
    session.append('user/message', first[0]!, { surfaceOp: 'append' })
    const firstSeq = session.snapshotEvents().find(event => event.type === 'user/message' && event.data.id === first[0]!.id)?.seq
    assert.notEqual(firstSeq, undefined)
    assert.deepEqual(await collect(session), [], 'a committed native delivery suppresses a repeated request')

    // Lose the runtime candidates entirely: the recorded Session still owns dedup.
    await runtime.close(); runtime = createRuntime()
    at = time(25, 11, 49, 59, 999)
    assert.deepEqual(await collect(session), [], 'empty runtime cache cannot redeliver in the same window')
    const expiryId = String(expirySession.id)
    await runtime.prepareRequest({ sessionId: expiryId, events: expirySession.snapshotEvents() })
    assert.equal(runtime.snapshot(expiryId).candidates.length, 1, 'a fresh session matches the final millisecond')
    at = time(25, 11, 50)
    assert.deepEqual(await runtime.collect({ sessionId: expiryId, visible: expirySession.deriveMessages() }), [],
      'delivery rechecks the window after evaluation and rejects the exclusive end')
    assert.deepEqual(await collect(session), [], '11:50:00.000 is outside the window')

    at = time(26, 11, 40)
    const next = await collect(session)
    assert.equal(next.length, 1, 'the next day can deliver even with yesterday’s reminder visible')
    assert.notEqual(next[0]!.source.reminder.key, first[0]!.source.reminder.key)
    session.append('user/message', next[0]!, { surfaceOp: 'append' })
    assert.deepEqual(await collect(session), [])
    const deliveredSeqs = session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder').map(event => event.seq)
    assert.equal(deliveredSeqs.length, 2)
    assert.equal(ctx.storageDomain.get('context_care_reminders'), undefined)
    assert.equal(ctx.storageDomain.get('context_care_reminder_claims'), undefined)
    t.diagnostic(JSON.stringify({ ruleId: rule.id, sourceBlock: '20261014114116-cduofoj',
      evidence: 'isolated-real-host-with-fixture-clock', deliveredSeqs, deliveries: [1, 0, 0, 0, 1, 0] }))
  })
}
