import test from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { executeReminderMatch } from '../lib/reminder-runtime/matcher.js'
import type { MessageView } from '../lib/reminder-runtime/request-context.js'

const config = { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }
const texts = (messages: MessageView[]) => messages.map(message =>
  (message.content ?? []).map(block => block.text ?? '').join(''))

function fixture(t: { after: (fn: () => unknown) => void }) {
  const runtime = createReminderRuntime({ config, execute: async input =>
    'reminder' in input ? executeReminderMatch(input.reminder) : { ok: true } })
  t.after(() => runtime.close())
  return runtime
}

/** A rule that fires on every logged message, so a loop would be visible immediately. */
const watcher = (id: string) => ({ format: 'reminder/v4', id, on: 'session.event', text: `提醒 ${id}`,
  when: { eventType: 'user/message' },
  effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } })

const message = (seq: number, extra: Record<string, unknown> = {}) => ({ type: 'session.event',
  sessionId: 's', callId: `user/message#${seq}`, rootCallId: `user/message#${seq}`, name: 'user/message',
  arguments: { text: 'hi' }, clock: { at: 1000 }, ...extra })

test('提醒不能因自己投递的消息再次激活自己', async t => {
  const runtime = fixture(t)
  runtime.registerSource({ sourceId: 'loop', plugin: 'test', revision: 1, rules: [watcher('n')] })
  // The causing message was produced by this very rule: self-activation is refused.
  await runtime.submit(message(1, { origin: 'reminder', causationId: 'loop:n' }))
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  // The same event caused by another rule is an ordinary cross-rule activation.
  await runtime.submit(message(2, { origin: 'reminder', causationId: 'other:n' }))
  assert.deepEqual(texts(await runtime.collect({ sessionId: 's', visible: [] })), ['提醒 n'])
})

test('跨规则循环共享次数预算，真人轮会打断链条', async t => {
  const runtime = fixture(t)
  runtime.registerSource({ sourceId: 'loop', plugin: 'test', revision: 1, rules: [watcher('n')] })
  // Each admitted activation leaves one diagnostic, so this counts activations rather
  // than deliveries: `once: surface` key de-duplication discards repeats on its own.
  const activations = () => runtime.snapshot('s').diagnostics.length
  for (let seq = 1; seq <= 8; seq++) {
    // Alternate the causing rule so the self-check never fires and only the budget can stop it.
    await runtime.submit(message(seq, { origin: 'reminder', causationId: `other-${seq}:x` }))
    assert.equal(activations(), seq, `activation ${seq} is admitted`)
  }
  await runtime.submit(message(9, { origin: 'reminder', causationId: 'other-9:x' }))
  assert.equal(activations(), 8, 'the ninth reminder-caused activation is suppressed')
  // A human turn breaks the chain, so reminder-caused activations are admitted again.
  await runtime.submit(message(10, { origin: 'human' }))
  assert.equal(activations(), 9, 'a human turn ends the chain')
})

test('防循环不放行本该被拒绝的工具调用', async t => {
  const runtime = fixture(t)
  runtime.registerSource({ sourceId: 'guard', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'deny', on: 'tool.before-execute', text: '不许',
    when: { tool: 'read' }, effect: { kind: 'deny-tool', deliver: { model: { once: 'surface' } } } }] })
  // Even a reminder-originated pre-execution event must still produce the denial.
  await runtime.submit({ type: 'tool.before-execute', sessionId: 's', callId: 'c1', rootCallId: 'c1',
    name: 'read', arguments: {}, origin: 'reminder', causationId: 'guard:deny', clock: { at: 1000 } })
  const snapshot = runtime.snapshot('s')
  assert.deepEqual(snapshot.candidates.map(candidate => candidate.ruleId), ['deny'])
})
