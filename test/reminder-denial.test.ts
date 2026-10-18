import test from 'node:test'
import assert from 'node:assert/strict'
import { createDenialTickets } from '../lib/reminder-runtime/denial.js'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { executeReminderMatch } from '../lib/reminder-runtime/matcher.js'

const verdict = { sourceId: 's', ruleId: 'r', reason: '不得删除文件' }
const tickets = (now = () => 1000) => createDenialTickets(50, now)

/** A live reminder runtime whose matching is the shipped implementation, not a stub. */
function runtime(t: { after: (fn: () => unknown) => unknown }) {
  const instance = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: async input => 'reminder' in input ? executeReminderMatch(input.reminder) : { ok: true } })
  t.after(() => instance.close())
  return instance
}

const denyRule = (reason: string, tool = 'blocked') => ({ format: 'reminder/v4', id: 'blocked', on: 'tool.before-execute',
  text: '这次调用被规则拦下', when: { tool }, effect: { kind: 'deny-tool', reason, deliver: { model: { once: 'surface' } } } })

/** One tool call through the real pre-execute then guard sequence. */
let calls = 0
async function call(instance: ReturnType<typeof createReminderRuntime>, name: string) {
  // Every registry execution has its own call id, and admission de-duplicates on it.
  const id = `call-${++calls}`
  const key = {}
  await instance.prepareToolExecution({ key, sessionId: 's', name, arguments: {},
    callId: id, rootCallId: id })
  const outcome = instance.decideToolExecution(key)
  instance.settleToolExecution(key)
  return outcome
}

/** The only surviving reason string, so a failure names the exact branch. */
function reason(outcome: { kind: 'allow' } | { kind: 'deny'; reason: string }) {
  return outcome.kind === 'deny' ? outcome.reason : 'allow'
}

test('只有评估完成且未命中的票据才授权执行', () => {
  const api = tickets()
  const clean = {}, denied = {}, unfinished = {}
  const generation = api.current()
  api.record(clean, undefined, true, generation)
  api.record(denied, verdict, true, generation)
  // A round cut short before finishing cannot authorize: an unfinished check is not permission.
  api.record(unfinished, undefined, false, generation)
  assert.deepEqual(api.decide(clean, 1000), { kind: 'allow' })
  assert.deepEqual(api.decide(denied, 1000), { kind: 'deny', reason: '不得删除文件' })
  assert.equal(api.decide(unfinished, 1000).kind, 'deny')
})

test('缺少或过期票据都拒绝，不因为没记录就放行', () => {
  const api = tickets()
  assert.equal(api.decide({}, 1000).kind, 'deny')
  const stale = {}
  api.record(stale, undefined, true, api.current())
  // TTL is 50ms; a guard reached after that cannot rely on the evaluation.
  assert.equal(api.decide(stale, 1050).kind, 'deny')
  assert.deepEqual(api.decide(stale, 1049), { kind: 'allow' })
})

test('票据按执行令牌区分，调用ID重用不会继承他人结论', () => {
  const api = tickets()
  const first = {}
  api.record(first, undefined, true, api.current())
  // The second call has its own token and was never evaluated.
  assert.equal(api.decide({}, 1000).kind, 'deny')
  assert.deepEqual(api.decide(first, 1000), { kind: 'allow' })
})

test('政策变更只作废旧票据，之后仍然签发并生效', () => {
  const api = tickets()
  const before = {}
  api.record(before, undefined, true, api.current())
  api.invalidate()
  // The verdict was reached under the previous rule set, so it cannot authorize this call.
  assert.deepEqual(api.decide(before, 1000), { kind: 'deny', reason: '提醒策略已变更，本次调用需重新评估' })
  // Retirement is not a shutdown: the next round is recorded and honoured.
  const after = {}
  api.record(after, undefined, true, api.current())
  assert.deepEqual(api.decide(after, 1000), { kind: 'allow' })
  assert.equal(api.decide({}, 1000).kind, 'deny')
})

test('已结算的票据不再生效，停用后一律拒绝', () => {
  const api = tickets()
  const settled = {}
  api.record(settled, undefined, true, api.current())
  api.settle(settled)
  assert.equal(api.decide(settled, 1000).kind, 'deny')
  const closing = tickets()
  const live = {}
  closing.record(live, undefined, true, closing.current())
  closing.dispose()
  assert.deepEqual(closing.decide(live, 1000), { kind: 'deny', reason: '提醒策略服务已停止，本次调用未执行' })
  const late = {}
  closing.record(late, undefined, true, closing.current())
  assert.equal(closing.decide(late, 1000).kind, 'deny')
})

test('没有前置规则时工具调用照常放行，不把空策略当成缺票据', async t => {
  const instance = runtime(t)
  instance.registerSource({ sourceId: 'remind-only', plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'NOTICE', when: { tool: 'probe' },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })
  assert.deepEqual(await call(instance, 'read'), { kind: 'allow' })
})

test('来源刷新后工具调用仍然可用，拒绝规则照旧生效', async t => {
  const instance = runtime(t)
  const handle = instance.registerSource({ sourceId: 'deny-source', plugin: 'test', revision: 1, rules: [denyRule('不得删除文件')] })
  assert.deepEqual(await call(instance, 'blocked'), { kind: 'deny', reason: '不得删除文件' })
  assert.deepEqual(await call(instance, 'read'), { kind: 'allow' })
  // A periodic source refresh is ordinary operation. It used to disable the whole
  // policy permanently, which denied every later tool call in the session.
  handle.replace({ sourceId: 'deny-source', plugin: 'test', revision: 2, rules: [denyRule('仍然不得删除文件')] })
  assert.deepEqual(await call(instance, 'blocked'), { kind: 'deny', reason: '仍然不得删除文件' })
  assert.deepEqual(await call(instance, 'read'), { kind: 'allow' })
  // Withdrawing the rule leaves nothing to decide, and the call still runs.
  await handle.dispose()
  assert.deepEqual(await call(instance, 'blocked'), { kind: 'allow' })
})

test('服务关闭后迟到的一次调用被拒绝', async t => {
  const instance = runtime(t)
  instance.registerSource({ sourceId: 'deny-source', plugin: 'test', revision: 1, rules: [denyRule('不得删除文件')] })
  assert.deepEqual(await call(instance, 'read'), { kind: 'allow' })
  await instance.close()
  assert.equal(reason(await call(instance, 'read')), '提醒策略服务已停止，本次调用未执行')
})
