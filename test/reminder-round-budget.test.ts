import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { executeReminderMatch } from '../lib/reminder-runtime/matcher.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000 })
after(async () => { await matcher.close() })
const port = (input: Parameters<typeof matcher.detect>[0], signal: AbortSignal, timing: Parameters<typeof matcher.detect>[2]) =>
  matcher.detect(input, signal, timing)
// 先把线程热起来：首次启动线程要上百毫秒，而这里故意把轮次预算设得很短，
// 不预热的话测的就是「启动慢」而不是「存储阻塞不该影响判定」。
await matcher.warmup()
/** 灾难回溯：真实地卡住 worker，比伪造一个 throw 更接近线上会出的事。 */
const hang = { format: 'reminder/v4', id: 'hang', on: 'tool.before-execute', text: 't',
  when: { tool: 'blocked', arguments: { command: { regex: '(a+)+$' } } },
  effect: { kind: 'deny-tool', dangerous: true, reason: '不该命中', deliver: { model: { once: 'surface' } } } }
const trap = 'a'.repeat(40)

/** 同步阻塞事件循环，模拟与匹配无关的慢操作（存储写入、别的主线程任务）。 */
function blockLoop(ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) { /* busy */ }
}

/** 规则匹配 tool 名，但参数条件永远不命中，所以期望结果是放行。 */
const guard = { format: 'reminder/v4', id: 'guard', on: 'tool.before-execute', text: 't',
  when: { tool: 'blocked', arguments: { command: { regex: 'never-matches-this' } } },
  effect: { kind: 'deny-tool', dangerous: true, reason: '不该命中', deliver: { model: { once: 'surface' } } } }

test('规则未命中、匹配瞬时完成，仅因无关的存储开销阻塞事件循环就被判成「未完成」', async (t) => {
  const instance = createReminderRuntime({
    config: { ruleTimeoutMs: 2000, roundTimeoutMs: 40 },
    save: () => { blockLoop(120); return Promise.resolve() },
    execute: port,
  })
  t.after(() => instance.close())
  instance.registerSource({ sourceId: 'budget-storage', plugin: 'p', revision: 1, rules: [guard] })

  const started = Date.now()
  const key = {}
  await instance.prepareToolExecution({ key, sessionId: 'budget-storage-session', name: 'blocked', arguments: { command: 'aaa' }, callId: 'budget-storage-1', rootCallId: 'budget-storage-1' })
  const outcome = instance.decideToolExecution(key)
  instance.settleToolExecution(key)
  const elapsed = Date.now() - started

  const label = outcome.kind === 'allow' ? 'allow' : outcome.reason
  // 匹配本身是微秒级；被拒绝只可能来自与匹配无关的墙钟开销。
  assert.equal(label, 'allow', `轮次实际耗时 ${elapsed}ms，判定：${label}`)
})

test('求值迟迟不返回时仍然拒绝，且不会无限等待', async (t) => {
  const instance = createReminderRuntime({
    config: { ruleTimeoutMs: 50, roundTimeoutMs: 2000 },
    // 求值真的卡住了（灾难回溯），不是伪造一个 throw：结论来自真实的超时路径。
    execute: port,
  })
  t.after(() => instance.close())
  instance.registerSource({ sourceId: 'budget-hang', plugin: 'p', revision: 1, rules: [hang] })

  const started = Date.now()
  const key = {}
  await instance.prepareToolExecution({ key, sessionId: 'budget-hang-session', name: 'blocked', arguments: { command: trap }, callId: 'budget-hang-1', rootCallId: 'budget-hang-1' })
  const outcome = instance.decideToolExecution(key)
  instance.settleToolExecution(key)
  const elapsed = Date.now() - started

  assert.equal(outcome.kind, 'deny', `卡死时必须拒绝，实际 ${outcome.kind}`)
  assert.ok(elapsed < 5000, `不应无限等待：${elapsed}ms`)
})

test('执行前的纯提醒规则不得阻塞工具调用', async (t) => {
  const notice = { format: 'reminder/v4', id: 'notice-before', on: 'tool.before-execute', text: 't',
    when: { tool: 'blocked' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }
  const instance = createReminderRuntime({
    config: { ruleTimeoutMs: 50, roundTimeoutMs: 2000 },
    // 即便求值真的卡死，纯提醒也不该拒绝任何调用。
    execute: port,
  })
  t.after(() => instance.close())
  instance.registerSource({ sourceId: 'budget-remind', plugin: 'p', revision: 1, rules: [notice] })

  const key = {}
  await instance.prepareToolExecution({ key, sessionId: 'budget-remind-session', name: 'blocked', arguments: {}, callId: 'budget-remind-1', rootCallId: 'budget-remind-1' })
  const outcome = instance.decideToolExecution(key)
  instance.settleToolExecution(key)

  assert.equal(outcome.kind, 'allow', '纯提醒规则不得拒绝工具调用')
})