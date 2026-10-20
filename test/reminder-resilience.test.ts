import test from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'

const source = (id: string) => ({ sourceId: id, plugin: 'test', revision: 1, rules: [{
  format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'NOTICE',
  when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })
const event = (callId: string) => ({ type: 'tool.succeeded', sessionId: 's', callId, rootCallId: callId,
  name: 'probe', arguments: {} })

/**
 * 外部执行端口不保证会返回。
 *
 * 每条规则各自持有结算口，而整轮的收尾是 `await Promise.all(settles)`——
 * 只要端口那边一直不回来，这个 await 就没有出口：evaluate 不返回，
 * run.done 不完成，这个会话之后的 submit/collect 全部等在 settle(sessionId) 上。
 * 轮次计时器到点只会 abort controller，abort 并不会让 settles 变成已决。
 *
 * 提醒链路不能因为一个不听话的端口就永久停摆。
 */
test('执行端口永不返回时，整轮仍然按时收敛，不会挂死', async t => {
  const runtime = createReminderRuntime({
    config: { ruleTimeoutMs: 1000, roundTimeoutMs: 200 },
    // 一块永远不会 resolve 的石头：这才是"端口不返回"的真实形状。
    execute: () => new Promise(() => {}),
  })
  t.after(() => runtime.close())
  runtime.registerSource(source('hang-port'))

  const started = Date.now()
  await runtime.submit(event('c1'))
  const elapsed = Date.now() - started

  assert.ok(elapsed < 2000, '整轮必须有出口，实际耗时 ' + elapsed + 'ms')
  // 端口没给答案，这一轮就不算完成；诊断要留下这个事实。
  const diagnostics = runtime.snapshot('s').diagnostics
  assert.ok(diagnostics.length > 0, '没拿到答案也要留下诊断')
})

/**
 * 执行端口返回了「不是结果」的东西时，只有那一条失败，其余规则照常。
 * 这条守的是逐条隔离：一条坏结果不该把同批的其它规则一起判废。
 */
test('一条结果坏掉不影响同批其它规则的答案', async t => {
  const runtime = createReminderRuntime({
    config: { ruleTimeoutMs: 1000, roundTimeoutMs: 1000 },
    execute: async input => {
      const batch = (input as { reminderBatch?: { rules: { key: string }[] } }).reminderBatch
      if (batch === undefined) return { ok: true }
      return { items: batch.rules.map((rule, index) => index === 0
        ? { key: rule.key, ms: 0, match: { not: 'a result' } }   // 坏结果：没有 ok 字段
        : { key: rule.key, ms: 0, match: { ok: true } }), stopped: false, elapsedMs: 0 }
    },
  })
  t.after(() => runtime.close())
  runtime.registerSource({ sourceId: 'mixed', plugin: 'test', revision: 1, rules: [
    { format: 'reminder/v4', id: 'broken', on: 'tool.succeeded', text: 'BROKEN', priority: 20,
      when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } },
    { format: 'reminder/v4', id: 'good', on: 'tool.succeeded', text: 'GOOD', priority: 10,
      when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } },
  ] })

  await runtime.submit(event('c1'))
  const candidates = runtime.snapshot('s').candidates.map(item => item.ruleId)
  assert.deepEqual(candidates, ['good'], '坏掉的那条不算命中，好的那条照常成为候选')
})

/**
 * 匹配线程起不来时，拒绝理由必须说「线程没能启动」。
 *
 * 把它归进「规则评估超时」会把排查方向带偏：一个是模块/依赖装坏了，
 * 一个是规则写得太重。两者的修法完全不同。
 */
/**
 * 启动失败与规则超时是两件事，拒绝理由必须分开。
 *
 * 端到端复现「线程起不来」只能靠极短的 startupMs 去撞真实线程启动，
 * 在并发环境下不稳定；所以这里直接锁住分类本身，端到端由 dispatches 那条路径覆盖。
 */
test('启动失败与规则超时分成两档，理由不混用', async () => {
  const { codeForFailure } = await import('../lib/reminder-runtime/denial.js')
  assert.equal(codeForFailure('matcher-startup-timeout'), 'matcher-startup')
  assert.equal(codeForFailure('matcher-worker-exited:1'), 'matcher-startup')
  assert.equal(codeForFailure('matcher-work-timeout'), 'rule-timeout')
  assert.equal(codeForFailure('reminder-rule-timeout'), 'rule-timeout')
  assert.equal(codeForFailure('boom'), 'rule-failed')
})
