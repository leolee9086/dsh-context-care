import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createDenialTickets } from '../lib/reminder-runtime/denial.js'
import { createReminderRuntime, type RuntimeOptions } from '../lib/reminder-runtime/runtime.js'
import { executeReminderMatch } from '../lib/reminder-runtime/matcher.js'

const verdict = { sourceId: 's', ruleId: 'r', reason: '不得删除文件' }
const tickets = (now = () => 1000) => createDenialTickets(50, now)
type Runtime = ReturnType<typeof createReminderRuntime>
type Handle = ReturnType<Runtime['registerSource']>
type Outcome = { kind: 'allow' } | { kind: 'deny'; reason: string }

/** A live reminder runtime whose matching is the shipped implementation, not a stub. */
function runtime(t: TestContext, options: Partial<RuntimeOptions> = {}) {
  const instance = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: async input => 'reminder' in input ? executeReminderMatch(input.reminder) : { ok: true }, ...options })
  t.after(() => instance.close())
  return instance
}

const denyRule = (reason: string, tool = 'blocked') => ({ format: 'reminder/v4', id: 'blocked', on: 'tool.before-execute',
  text: '这次调用被规则拦下', when: { tool }, effect: { kind: 'deny-tool', reason, deliver: { model: { once: 'surface' } } } })
const remindRule = { format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'NOTICE', when: { tool: 'probe' },
  effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }

/** One tool call through the real pre-execute then guard sequence. */
let calls = 0
async function callWith(instance: Runtime, name: string, id = `call-${++calls}`, args: unknown = {}): Promise<Outcome> {
  const key = {}
  await instance.prepareToolExecution({ key, sessionId: 's', name, arguments: args, callId: id, rootCallId: id })
  const outcome = instance.decideToolExecution(key)
  instance.settleToolExecution(key)
  return outcome
}
const call = (instance: Runtime, name: string) => callWith(instance, name)

/** The reason a call ended with, so a failure names the exact branch. */
function reason(outcome: Outcome) { return outcome.kind === 'deny' ? outcome.reason : 'allow' }

// ---------------------------------------------------------------------------
// The ticket contract: a verdict is issued once, and an unfinished round denies.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The invariant this file exists to pin: every tool call ends with a verdict.
// A preparation that returns without recording one is the bug class that locked
// every tool in a session, so each exit below names the outcome it must produce.
// ---------------------------------------------------------------------------

interface Exit {
  name: string
  expected: string
  options?: Partial<RuntimeOptions>
  scope?: unknown
  rules?: unknown[]
  drive?: (instance: Runtime, handle: Handle) => Promise<Outcome>
}

const exits: Exit[] = [
  { name: '本会话没有前置规则时放行', rules: [remindRule], expected: 'allow' },
  { name: '会话连任何规则都没有时放行', rules: [], expected: 'allow' },
  { name: '前置规则存在但工具名不同时放行', rules: [denyRule('不得删除文件')], expected: 'allow' },
  { name: '工具名相同但参数条件不满足时放行', rules: [{ format: 'reminder/v4', id: 'blocked', on: 'tool.before-execute',
    text: '只能读 D 盘', when: { tool: 'blocked', arguments: { path: { regex: '^D:' } } },
    effect: { kind: 'deny-tool', reason: '只能读 D 盘', deliver: { model: { once: 'surface' } } } }],
    drive: instance => callWith(instance, 'blocked', undefined, {}) , expected: 'allow' },
  { name: '规则范围不含本会话时放行', rules: [denyRule('不得删除文件')], scope: { sessionIds: ['other'] }, expected: 'allow' },
  { name: '规则被开关关闭时放行，不把停用当成拒绝', rules: [denyRule('不得删除文件')],
    options: { eligible: () => false }, drive: instance => call(instance, 'blocked'), expected: 'allow' },
  { name: '命中拒绝规则时用规则自己的理由', rules: [denyRule('不得删除文件')],
    drive: instance => call(instance, 'blocked'), expected: '不得删除文件' },
  { name: '评估期间来源被替换时拒绝并要求重评', rules: [denyRule('不得删除文件')],
    drive: async (instance, handle) => {
      // The round reads the old rule set; a verdict from it must not authorize under the new one.
      const key = {}
      const pending = instance.prepareToolExecution({ key, sessionId: 's', name: 'blocked', arguments: {},
        callId: 'call-race', rootCallId: 'call-race' })
      handle.replace({ sourceId: 'policy', plugin: 'test', revision: 2, rules: [denyRule('新的理由')] })
      await pending
      const outcome = instance.decideToolExecution(key)
      instance.settleToolExecution(key)
      return outcome
    }, expected: '提醒策略已变更，本次调用需重新评估' },
  { name: '同一个调用ID被重复评估时拒绝，不去猜旧结论', rules: [denyRule('不得删除文件')],
    drive: async instance => { await callWith(instance, 'blocked', 'call-twice'); return callWith(instance, 'blocked', 'call-twice') },
    expected: '提醒策略未能完成全部规则的评估' },
  { name: '一次拒绝不污染后一次调用', rules: [denyRule('不得删除文件')],
    drive: async instance => { assert.equal(reason(await call(instance, 'blocked')), '不得删除文件'); return call(instance, 'read') },
    expected: 'allow' },
  { name: '一次放行不授权后一次命中', rules: [denyRule('不得删除文件')],
    drive: async instance => { assert.equal(reason(await call(instance, 'read')), 'allow'); return call(instance, 'blocked') },
    expected: '不得删除文件' },
  { name: '服务关闭后迟到的一次调用拒绝', rules: [denyRule('不得删除文件')],
    drive: async instance => { assert.equal(reason(await call(instance, 'read')), 'allow'); await instance.close(); return call(instance, 'read') },
    expected: '提醒策略服务已停止，本次调用未执行' },
]

for (const exit of exits) {
  test(`工具调用的每条出口都有结论：${exit.name}`, async t => {
    const instance = runtime(t, exit.options)
    const handle = instance.registerSource({ sourceId: 'policy', plugin: 'test', revision: 1,
      ...(exit.scope === undefined ? {} : { scope: exit.scope }), rules: exit.rules ?? [denyRule('不得删除文件')] })
    const outcome = await (exit.drive ?? (instance => call(instance, 'read')))(instance, handle)
    assert.equal(reason(outcome), exit.expected)
  })
}
