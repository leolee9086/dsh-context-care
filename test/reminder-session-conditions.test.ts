import { normalizeScope, matchesScope, createBoundedMatcher } from '@leolee9086/dsh-rule-engine'
import type { RecipientFacts, RecipientCondition, ClaimBookValue, EventRuntimeOptions as RuntimeOptions } from '@leolee9086/dsh-rule-engine'

import test, { after, type TestContext } from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'
import { createReminderRuntime, type ReminderSource } from './reminder-runtime-fixture.ts'

const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000 })
after(async () => { await matcher.close() })
const port = (input: Parameters<typeof matcher.detect>[0], signal: AbortSignal, timing: Parameters<typeof matcher.detect>[2]) =>
  matcher.detect(input, signal, timing)

const name: RecipientCondition = { kind: 'compare', field: 'session.agentPresetName', op: 'eq', value: '织' }
const model: RecipientCondition = { kind: 'compare', field: 'session.model', op: 'contains', value: 'gpt-' }
const source: ReminderSource = { sourceId: 'notes', plugin: 'siyuan', revision: 1,
  scope: { condition: name }, rules: [eventRule('tool.succeeded', { id: 'notes-first', recipient: { condition: model }, event: { tool: 'write' } }, { template: '内部笔记写入思源。' })] }
const event = (callId: string, sessionId = 's') => ({ sessionId, callId, rootCallId: callId, name: 'write' })
const facts = (): RecipientFacts => ({ agentPreset: 'zhi', agentPresetName: '织', provider: 'route', model: 'gpt-6' })
function fixture(t: TestContext, options: Partial<RuntimeOptions>) {
  const runtime = createReminderRuntime({ execute: port, ...options })
  t.after(() => runtime.close())
  return runtime
}

test('会话条件支持名称、模型、提供方及布尔组合，与原有ID范围取交集', () => {
  const scope = normalizeScope({ sessionIds: ['s'], agentPresets: ['zhi'], condition: {
    kind: 'all', conditions: [name, { kind: 'any', conditions: [model,
      { kind: 'compare', field: 'session.model', op: 'eq', value: 'deepseek-chat' }] },
    { kind: 'not', condition: { kind: 'compare', field: 'session.provider', op: 'eq', value: 'other' } }],
  } })
  assert.equal(matchesScope({ sessionId: 's', ...facts() }, scope), true)
  assert.equal(matchesScope({ sessionId: 's', ...facts(), model: 'deepseek-chat' }, scope), true)
  for (const recipient of [
    { sessionId: 'other', ...facts() }, { sessionId: 's', ...facts(), agentPreset: 'other' },
    { sessionId: 's', ...facts(), agentPresetName: '另一预设' }, { sessionId: 's', ...facts(), provider: 'other' },
    { sessionId: 's', ...facts(), model: 'GPT-6' }, { sessionId: 's', agentPreset: 'zhi', model: 'gpt-6' },
  ]) assert.equal(matchesScope(recipient, scope), false)
  assert.equal(matchesScope({ sessionId: 's' }, normalizeScope({ condition: {
    kind: 'compare', field: 'session.model', op: 'ne', value: 'gpt-6',
  } })), false)
  assert.equal(matchesScope({ sessionId: 's' }, normalizeScope({ condition: {
    kind: 'not', condition: { kind: 'compare', field: 'session.model', op: 'exists' },
  } })), true)
})

test('会话条件拒绝错拼字段、无界匹配和过大条件树', () => {
  for (const condition of [
    { ...name, field: 'session.presetName' }, { ...name, op: 'regex' }, { ...name, value: 1 },
    { kind: 'regex', field: 'session.model', pattern: '.*' }, { kind: 'any', conditions: [] },
    { kind: 'compare', field: 'session.model', op: 'exists', value: true },
    { kind: 'all', conditions: Array.from({ length: 65 }, () => name) },
  ]) assert.throws(() => normalizeScope({ condition }), /dsh-rule-engine: recipient: condition/)
  let nested: RecipientCondition = name
  for (let index = 0; index < 17; index++) nested = { kind: 'not', condition: nested }
  assert.throws(() => normalizeScope({ condition: nested }), /depth/)
})

test('来源、规则与核心资格相交；宿主名称和模型覆盖事件附带的身份', async t => {
  let current: RecipientFacts = { ...facts(), model: 'other' }, accepts = true
  const runtime = fixture(t, { resolveIdentity: async () => current })
  runtime.registerSource(source, { acceptSession: () => accepts })
  assert.equal((await runtime.catalog('s'))[0]?.rules.length, 0)
  await runtime.submit({ ...event('spoof'), ...facts() })
  assert.equal(runtime.snapshot('s').candidates.length, 0)
  current = facts()
  assert.equal((await runtime.catalog('s'))[0]?.rules.length, 1)
  await runtime.submit(event('hit'))
  const delivered = await runtime.collect({ sessionId: 's', visible: [] })
  assert.equal(delivered.length, 1)
  current = { ...facts(), agentPresetName: '改名' }
  assert.deepEqual(await runtime.catalog('s'), [])
  assert.deepEqual(await runtime.filterMessages('s', [], delivered), [])
  await runtime.rollback('s', delivered)
  current = facts(); accepts = false
  assert.deepEqual(await runtime.catalog('s'), [])
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
})

test('模型在匹配期间或候选等待期间改变，都在下一阶段重新判定', async t => {
  let current = facts(), changeDuringMatch = true
  // 身份在匹配期间改变：把改变挂到真实端口的调用上，不再伪造判定结果。
  let switched = false
  const runtime = fixture(t, { resolveIdentity: async () => current,
    execute: (input, signal, timing) => {
      if (changeDuringMatch && !switched) { switched = true; current = { ...facts(), model: 'other' } }
      return port(input, signal, timing)
    } })
  runtime.registerSource(source)
  await runtime.submit(event('switch-during-match'))
  assert.equal(runtime.snapshot('s').candidates.length, 0)
  current = facts(); changeDuringMatch = false
  await runtime.submit(event('switch-before-delivery'))
  assert.equal(runtime.snapshot('s').candidates.length, 1)
  current = { ...facts(), model: 'other' }
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
})

test('共享额度保存期间模型切换会释放名额，其它合适会话继续消费', async t => {
  const recipients = new Map([['s', facts()], ['other', facts()]])
  let book: ClaimBookValue = { buckets: [] }, switchOnClaim = true
  const runtime = fixture(t, { resolveIdentity: async id => recipients.get(id) ?? {},
    updateClaims: async change => {
      book = change(book)
      if (switchOnClaim && book.buckets.length) {
        switchOnClaim = false
        recipients.set('s', { ...facts(), model: 'other' })
      }
      return book
    } })
  runtime.registerSource({ ...source, rules: source.rules.map(rule => ({ ...rule,
    actions: rule.actions.map(action => ({ ...action, delivery: { model: { once: 'surface', shared: { reset: 'lifetime', lifetime: 'test', limit: 1 } } } })) })) })
  await Promise.all([runtime.submit(event('s-hit')), runtime.submit(event('other-hit', 'other'))])
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  assert.equal(book.buckets.length, 0)
  const messages = await runtime.collect({ sessionId: 'other', visible: [] })
  assert.equal(messages.length, 1)
  recipients.set('other', { ...facts(), model: 'other' })
  assert.deepEqual(await runtime.filterMessages('other', [], messages), [])
  await runtime.rollback('other', messages)
  assert.equal(book.buckets.length, 0)
})

test('一或多个会话共享消费只计合适接收者，额度不会按模型分裂', async t => {
  for (const limit of [1, 2]) {
    let book: ClaimBookValue = { buckets: [] }
    const runtime = fixture(t, { resolveIdentity: async id => id === 'excluded' ? { ...facts(), model: 'other' } : facts(),
      updateClaims: async change => { book = change(book); return book } })
    runtime.registerSource({ ...source, rules: source.rules.map(rule => ({ ...rule,
      actions: rule.actions.map(action => ({ ...action, delivery: { model: { once: 'surface', shared: { reset: 'lifetime', lifetime: 'test', limit } } } })) })) })
    const ids = ['a', 'b', 'c', 'excluded']
    await Promise.all(ids.map(id => runtime.submit(event(id, id))))
    const messages = await Promise.all(ids.map(sessionId => runtime.collect({ sessionId, visible: [] })))
    assert.equal(messages.reduce((count, value) => count + value.length, 0), limit)
    assert.equal(messages[3]?.length, 0)
  }
})

test('等待身份读取占用队列名额，关闭服务取消等待并释放名额', async t => {
  const runtime = fixture(t, { config: { maxConcurrent: 1, maxQueued: 1 },
    resolveIdentity: (_id, signal) => new Promise<RecipientFacts>((_resolve, reject) => {
      assert.ok(signal)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }) })
  runtime.registerSource(source)
  const first = runtime.submit(event('first')), second = runtime.submit(event('second'))
  await assert.rejects(runtime.submit(event('third')), /capacity/)
  await runtime.close()
  await Promise.all([first, second])
  assert.equal(runtime.snapshot('s').candidates.length, 0)
})
