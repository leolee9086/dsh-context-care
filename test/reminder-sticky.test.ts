import type { MessageView, ClaimBookValue } from '@leolee9086/dsh-rule-engine'
import { createBoundedMatcher, EventRule as ReminderRule } from '@leolee9086/dsh-rule-engine'
import test, { after } from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'

import { createReminderRuntime } from './reminder-runtime-fixture.ts'



// 真实的执行端口：匹配由 worker 线程池完成。规则条件与事件本来就互相匹配，
// 不需要替身来伪造"命中"。
const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000 })
after(async () => { await matcher.close() })
const port = (input: Parameters<typeof matcher.detect>[0], signal: AbortSignal, timing: Parameters<typeof matcher.detect>[2]) =>
  matcher.detect(input, signal, timing)

const config = { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }
const stickyRule = (sticky: { lifetime: number; cooldown: number; clock?: 'main-request' | 'human-turn' }) =>
  eventRule('tool.succeeded', { id: 'sticky', event: { tool: 'probe' } }, { template: 'STICKY_NOTICE', delivery: { model: { once: 'none', sticky } } })
const probe = (id: string) => ({ sessionId: 's', callId: id, rootCallId: id, name: 'probe', arguments: {} })
const human = (id: string): MessageView => ({ id, role: 'user',
  content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
const texts = (messages: MessageView[]) => messages.map(message =>
  (message.content ?? []).map(block => block.text ?? '').join(''))
/** Everything already in context is committed; that is how a delivery gets acknowledged. */
const ids = (visible: MessageView[]) => visible.flatMap(message => message.id === undefined ? [] : [message.id])

/** Drive request boundaries, acknowledging each delivery on the next one. */
async function rounds(runtime: ReturnType<typeof createReminderRuntime>, count: number,
  options: { humanId?: string; initial?: MessageView[] } = {}) {
  const delivered: string[][] = []
  let visible: MessageView[] = [...(options.initial ?? [])]
  for (let round = 0; round < count; round++) {
    const messages = await runtime.collect({ sessionId: 's', visible, committedIds: ids(visible) })
    delivered.push(texts(messages))
    // Keep one human message at most, so the turn identity is stable across rounds.
    visible = [...visible.filter(message => message.source?.kind !== 'user'),
      ...(options.humanId === undefined ? [] : [human(options.humanId)]), ...messages]
  }
  return delivered
}

test('empty collection skips history and persistence unless a local enabled sticky can recover', async t => {
  let enabled = false
  const runtime = createReminderRuntime({ config, execute: port, eligible: () => enabled,
    readDeliveries: async () => { throw new Error('unexpected-history-read') },
    save: () => { throw new Error('unexpected-empty-write') } })
  t.after(() => runtime.close())
  const collect = () => runtime.collect({ sessionId: 's', visible: [] })
  assert.deepEqual(await collect(), [])
  runtime.registerSource({ sourceId: 'ordinary', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'ordinary', event: { tool: 'probe' } })] })
  assert.deepEqual(await collect(), [])
  const source = { sourceId: 'scoped', plugin: 'test', revision: 1, scope: { sessionIds: ['other'] },
    rules: [stickyRule({ lifetime: 2, cooldown: 0 })] }
  const handle = runtime.registerSource(source)
  enabled = true
  assert.deepEqual(await collect(), [])
  handle.replace({ ...source, scope: { sessionIds: ['s'] } })
  enabled = false
  assert.deepEqual(await collect(), [])
  enabled = true
  await assert.rejects(collect(), /unexpected-history-read/, 'an eligible sticky still restores its native history')
})

test('sticky 首次投递后按寿命继续，然后冷却，再需新事件', async t => {
  const runtime = createReminderRuntime({ config, execute: port })
  t.after(() => runtime.close())
  runtime.registerSource({ sourceId: 'sticky-source', plugin: 'test', revision: 1,
    rules: [stickyRule({ lifetime: 3, cooldown: 2 })] })
  await runtime.submit(probe('hit'))
  // First delivery, two active ticks, then two silent ticks; the activation is spent.
  const delivered = await rounds(runtime, 6)
  assert.deepEqual(delivered, [['STICKY_NOTICE'], ['STICKY_NOTICE'], ['STICKY_NOTICE'], [], [], []])
  assert.deepEqual(runtime.snapshot('s').stickies, [])
  // A new matching event opens a new activation.
  await runtime.submit(probe('hit-again'))
  assert.deepEqual((await rounds(runtime, 1))[0], ['STICKY_NOTICE'])
})

test('none 模式的新激活通过最终交付筛选，但同批消息仍去重', async t => {
  const runtime = createReminderRuntime({ config, execute: port })
  t.after(() => runtime.close())
  runtime.registerSource({ sourceId: 'sticky-source', plugin: 'test', revision: 1,
    rules: [stickyRule({ lifetime: 1, cooldown: 0 })] })
  await runtime.submit(probe('first'))
  const first = await runtime.collect({ sessionId: 's', visible: [] })
  assert.equal((await runtime.filterMessages('s', [], first)).length, 1)
  await runtime.collect({ sessionId: 's', visible: first, committedIds: ids(first) })
  assert.equal(runtime.snapshot('s').stickies.length, 0)
  await runtime.submit(probe('new-activation'))
  const next = await runtime.collect({ sessionId: 's', visible: first, committedIds: ids(first) })
  assert.equal(next.length, 1)
  assert.deepEqual(await runtime.filterMessages('s', first, [...next, ...next]), next)
  // Until the new handoff commits, another matching event still cannot redeliver it.
  await runtime.submit(probe('unconfirmed-repeat'))
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: first, committedIds: ids(first) }), [])
})

test('激活期间的重复命中被吸收，不重投也不延长寿命', async t => {
  const runtime = createReminderRuntime({ config, execute: port })
  t.after(() => runtime.close())
  runtime.registerSource({ sourceId: 'sticky-source', plugin: 'test', revision: 1,
    rules: [stickyRule({ lifetime: 2, cooldown: 0 })] })
  await runtime.submit(probe('hit'))
  const first = await runtime.collect({ sessionId: 's', visible: [] })
  assert.deepEqual(texts(first), ['STICKY_NOTICE'])
  // A second hit arrives while the activation is still live.
  await runtime.submit(probe('repeat'))
  const delivered = await rounds(runtime, 3, { initial: first })
  // lifetime 2 means exactly one further delivery; the repeat added none.
  assert.deepEqual(delivered, [['STICKY_NOTICE'], [], []])
  assert.deepEqual(runtime.snapshot('s').stickies, [])
})

test('human-turn 时钟只在新的真人输入时推进', async t => {
  const runtime = createReminderRuntime({ config, execute: port })
  t.after(() => runtime.close())
  runtime.registerSource({ sourceId: 'sticky-source', plugin: 'test', revision: 1,
    rules: [stickyRule({ lifetime: 2, cooldown: 0, clock: 'human-turn' })] })
  await runtime.submit(probe('hit'))
  const first = await runtime.collect({ sessionId: 's', visible: [human('human-1')] })
  assert.deepEqual(texts(first), ['STICKY_NOTICE'])
  let visible: MessageView[] = [human('human-1'), ...first]
  // The same human message does not advance the clock, so no tick is delivered.
  assert.deepEqual(await rounds(runtime, 2, { humanId: 'human-1', initial: visible }), [[], []])
  // A new human message advances it exactly once.
  visible = [human('human-2'), ...first]
  assert.deepEqual(await rounds(runtime, 1, { humanId: 'human-2', initial: visible }), [['STICKY_NOTICE']])
})

test('sticky 激活只在开启时占用一次共享额度', async t => {
  let book: ClaimBookValue = { buckets: [] }
  const runtime = createReminderRuntime({ config, execute: port,
    updateClaims: async change => { book = change(book); return book } })
  t.after(() => runtime.close())
  runtime.registerSource({ sourceId: 'sticky-quota', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'sticky', event: { tool: 'probe' } }, { template: 'STICKY_NOTICE', delivery: { model: { once: 'none',
      sticky: { lifetime: 3, cooldown: 0 }, shared: { reset: 'lifetime', lifetime: 'cap', limit: 1 } } } })] })
  await runtime.submit(probe('hit'))
  const delivered = await rounds(runtime, 3)
  assert.deepEqual(delivered, [['STICKY_NOTICE'], ['STICKY_NOTICE'], ['STICKY_NOTICE']])
  // The activation charged its lifetime quota once; later ticks reused the open slot.
  assert.equal(book.buckets.reduce((count, bucket) => count + bucket.claims.length, 0), 1)
})

test('sticky 与 surface 去重互斥，none 必须与 sticky 同时出现', () => {
  const base = (model: NonNullable<import('@leolee9086/dsh-rule-engine').ActionDeclaration['delivery']>['model']) => eventRule('tool.succeeded', { id: 'r', event: { tool: 'probe' } }, { delivery: { model } })
  assert.equal(ReminderRule.safeParse(base({ once: 'surface', sticky: { lifetime: 2, cooldown: 1 } })).success, false)
  assert.equal(ReminderRule.safeParse(base({ once: 'none' })).success, false)
  assert.equal(ReminderRule.safeParse(base({ once: 'none', sticky: { lifetime: 2, cooldown: 1 } })).success, true)
})
