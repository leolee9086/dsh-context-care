import test from 'node:test'
import assert from 'node:assert/strict'
import { after } from 'node:test'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'

const matcher = createBoundedMatcher({ timeoutMs: 5000, startupMs: 5000 })
after(async () => { await matcher.close() })
const port = (input: Parameters<typeof matcher.detect>[0], signal: AbortSignal, timing: Parameters<typeof matcher.detect>[2]) =>
  matcher.detect(input, signal, timing)
await matcher.warmup()

/**
 * 灾难回溯要一个「几乎匹配、最后一位不对」的输入：
 * 全是 a 的串会直接匹配 (a+)+$，根本不会回溯；末尾换个字符才会炸。
 */
const trap = 'a'.repeat(40) + '!'
const rule = (id: string, extra: Record<string, unknown>) => ({ format: 'reminder/v4', id, ...extra })

/**
 * 一条规则把 worker 跑死，同批的其它规则不该被它连累。
 *
 * 它们本来能算出自己的答案（未命中 / 命中），批次被打断之后要靠逐条重投补回来；
 * 而重投能不能成功，取决于轮次预算还剩多少。批量任务若拿走整轮预算，
 * 一条卡死就会把预算吃光，其余规则的重投全部立刻超时——
 * 诊断里把「我没算过」写成 timed-out，那是在谎报事实。
 */
test('批量里一条规则卡死，其余规则仍然各自拿到自己的答案', async t => {
  const runtime = createReminderRuntime({
    // 单条上限 100ms、整轮 1000ms：卡死那条只该吃掉自己那份。
    config: { ruleTimeoutMs: 100, roundTimeoutMs: 1000 },
    // 对齐生产配置：真实端口会在真正 postMessage 时才回调 onDispatch。
    // 不传这个，runtime 会退化成"投递前自己起表"，把线程冷启动也算进工作预算。
    dispatches: true,
    execute: port,
  })
  t.after(() => runtime.close())

  runtime.registerSource({ sourceId: 'isolation', plugin: 'test', revision: 1, rules: [
    rule('hang', { on: 'tool.before-execute', text: '卡死', priority: 30,
      when: { tool: 'blocked', arguments: { command: { regex: '(a+)+$' } } },
      effect: { kind: 'deny-tool', dangerous: true, reason: '不该命中', deliver: { model: { once: 'surface' } } } }),
    rule('quiet', { on: 'tool.before-execute', text: '不匹配', priority: 20,
      when: { tool: 'blocked', arguments: { command: { regex: 'never-matches-this' } } },
      effect: { kind: 'deny-tool', dangerous: true, reason: '不该命中', deliver: { model: { once: 'surface' } } } }),
    rule('notice', { on: 'tool.before-execute', text: 'NOTICE', priority: 10,
      when: { tool: 'blocked' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }),
  ] })

  const started = Date.now()
  await runtime.submit({ type: 'tool.before-execute', sessionId: 's', callId: 'c1', rootCallId: 'c1',
    name: 'blocked', arguments: { command: trap } })
  const elapsed = Date.now() - started

  const diagnostics = runtime.snapshot('s').diagnostics
  const statusOf = (ruleId: string) => diagnostics.filter(item => item.ruleId === ruleId).at(-1)?.status

  assert.equal(statusOf('hang'), 'timed-out', '卡住的那条才是超时的那条')
  assert.equal(statusOf('quiet'), 'unmatched', '没命中的规则必须拿到自己的「未命中」，不能记成超时')
  assert.equal(statusOf('notice'), 'matched', '命中的规则必须拿到自己的「命中」')
  assert.deepEqual(runtime.snapshot('s').candidates.map(item => item.ruleId), ['notice'])
  assert.ok(elapsed < 900, '一条卡死不能吃掉整轮预算：实际 ' + elapsed + 'ms')
})
