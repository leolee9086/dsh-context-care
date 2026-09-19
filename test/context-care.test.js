import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.js'
import { calculateState, GUIDANCE, renderState, resolveConfig } from '../src/policy.js'
import { selectClearRange, selectRestRange } from '../src/selection.js'

const signal = () => new AbortController().signal
const user = (seq, tokens = 500, source = { kind: 'user' }) => ({ seq, type: 'user/message', data: { source, content: [{ type: 'text', text: 'x' }] }, tokens })
/**
 * A session stub with just enough surface machinery for both paths.
 *
 * `append` maintains the surface the way the real session does — append pushes a
 * node, replace splices the covered span down to the one replacement — so a
 * clear can be observed through `surface.nodes` afterwards. `snapshotEvents`
 * returns the whole log because the deep-rest path derives its turn owner and
 * its open-compaction guard from replaying it.
 */
function history(events) {
  const log = [...events]
  const surface = { nodes: events.map(e => e.seq), replaceGeneration: 0 }
  return {
    surface,
    eventAt: seq => log.find(event => event.seq === seq),
    requestHeader: () => ({ config: { provider: 'test', model: 'test' } }),
    snapshotEvents: () => log,
    append(type, data, opts) {
      const event = { seq: log.length, type, data, ...(opts ?? {}) }
      log.push(event)
      if (opts?.surfaceOp === 'append') {
        surface.nodes.push(event.seq)
      } else if (opts?.surfaceOp?.op === 'replace') {
        const start = surface.nodes.indexOf(opts.surfaceOp.startSeq)
        const end = surface.nodes.indexOf(opts.surfaceOp.endSeq)
        surface.nodes.splice(start, end - start + 1, event.seq)
        surface.replaceGeneration++
      }
      return event
    },
  }
}
function measurement(session) {
  const nodes = session.surface.nodes.map(seq => ({ seq, tokens: session.eventAt(seq).tokens ?? 500 }))
  return { nodes, totalTokens: nodes.reduce((sum, node) => sum + node.tokens, 0), surfaceTokens: nodes.reduce((sum, node) => sum + node.tokens, 0) }
}
async function mounted(options = {}) {
  const ctx = new Context()
  const registered = new Map()
  const sections = new Map()
  const events = [user(0, 2000), user(1, 2000), user(2, 2000)]
  const session = history(events)
  const inbox = []
  const agent = { session, options: {}, inject: message => inbox.push(message) }
  const compacted = []
  ctx.provide('agents', {})
  ctx.provide('sessionProjections', { register: () => () => {} })
  ctx.provide('tools', { register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } })
  ctx.provide('systemPrompt', { context(section) { sections.set(section.name, section); return () => sections.delete(section.name) } })
  ctx.provide('tokenMeter', { measure: measurement, estimateMessage: () => 10 })
  ctx.provide('llm', { resolveModelInfo: async () => ({ context: { contextWindow: 10000 } }) })
  ctx.provide('compaction', { async compactRegion(start, end, owner, sig) {
    if (options.error) throw new Error('summary rejected')
    if (options.abort) { options.abort.abort(); sig.throwIfAborted() }
    compacted.push({ start, end, owner })
    session.surface.replaceGeneration++
  } })
  const fiber = await ctx.plugin(plugin, { minFreshTokens: 1000 })
  async function step(messages = [], nextExtra = {}, sig = signal()) {
    return ctx.waterfall('agent/pre-step', { agent, signal: sig }, async () => {
      if (options.auto) session.surface.replaceGeneration++
      return { kind: 'enter', messages, startsRequestSeries: true, ...nextExtra }
    })
  }
  return { ctx, fiber, registered, sections, session, inbox, agent, compacted, step }
}

test('S-forge curves distinguish retained information from relative pressure', () => {
  const spec = resolveConfig()
  assert.deepEqual(calculateState(0, 0, 10000, spec), { fatigue: 'normal', fatigueValue: 0, wakefulness: 'low', wakefulnessValue: 0 })
  assert.deepEqual(calculateState(8000, 4000, 10000, spec), { fatigue: 'very-high', fatigueValue: 100, wakefulness: 'high', wakefulnessValue: 100 })
  assert.deepEqual(calculateState(100, 100, undefined, spec), { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null })
  assert.equal(calculateState(4000, 100, 10000, spec).wakefulness, 'low')
  assert.throws(() => resolveConfig({ retainRatio: 0.9 }), /retainRatio/)
  assert.throws(() => resolveConfig({ minFreshTokens: 0 }), /positive integer/)
  assert.throws(() => resolveConfig({ typo: 1 }), /unknown config/)
})

test('range keeps a complete tool call/result batch', () => {
  const events = [user(7, 2000), { seq: 2, type: 'assistant/message', tokens: 1000, data: { message: { content: [{ type: 'tool-call' }, { type: 'tool-call' }] } } },
    { seq: 3, type: 'tool/result', tokens: 1000 }, { seq: 9, type: 'tool/result', tokens: 1000 }, user(10, 10)]
  const session = history(events)
  assert.deepEqual(selectRestRange(session, measurement(session), 800, 1000, plugin.name), { start: 7, end: 7 })
})

test('clear range keeps the system prompt at node 0 and stops on a balanced tool edge', () => {
  const events = [
    { seq: 0, type: 'system/message', data: { text: 'prompt' } },
    user(1, 2000),
    { seq: 2, type: 'assistant/message', tokens: 1000, data: { message: { content: [{ type: 'tool-call' }] } } },
    { seq: 3, type: 'tool/result', tokens: 1000 },
    user(4, 2000),
  ]
  const session = history(events)
  // node 0 是系统提示词：区间必须从 1 起。覆盖 node 0 会被 assertSystemHeadRewrite 拒绝，
  // 而清空历史不该连规则一起清掉。
  assert.deepEqual(selectClearRange(session), { start: 1, end: 4, shadowedSeqs: [1, 2, 3, 4] })
})

test('clear range declines when only the system prompt would be left', () => {
  assert.equal(selectClearRange(history([{ seq: 0, type: 'system/message', data: { text: 'prompt' } }])), null)
  assert.equal(selectClearRange(history([])), null)
})

test('summary-only and plugin statuses are not fresh work', () => {
  const session = history([user(1, 8000, { kind: 'plugin', plugin: 'compact', compactionId: 'checkpoint' }),
    user(3, 8000, { kind: 'plugin', plugin: 'dsh-context-care:state' }), user(7, 2000)])
  assert.equal(selectRestRange(session, measurement(session), 1500, 1000, plugin.name), null)
})

test('tool queues a bounded note; next boundary compacts once and preserves decision fields', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const tool = h.registered.get('context_rest')
  await assert.rejects(tool.execute({ note: '' }, { agent: h.agent, signal: signal() }), /note 需要/)
  await assert.rejects(tool.execute({ note: 'x'.repeat(4001) }, { agent: h.agent, signal: signal() }), /note 需要/)
  for (const args of [null, {}, { note: 42 }, []]) {
    await assert.rejects(tool.execute(args, { agent: h.agent, signal: signal() }), /note 需要/)
  }
  // 未知参数单独报错，和「note 不合法」分开：对调用方来说这是两种不同的修法。
  await assert.rejects(tool.execute({ note: 'valid', extra: true }, { agent: h.agent, signal: signal() }), /只接受/)
  await assert.rejects(h.registered.get('context_status').execute({ unexpected: true }, { agent: h.agent, signal: signal() }), /空对象/)
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['note'])
  assert.equal(tool.parameters.additionalProperties, false)
  const result = await tool.execute({ note: 'Finish verification; files in workspace.' }, { agent: h.agent, signal: signal() })
  assert.match(result, /还没完成/)
  assert.equal(h.compacted.length, 0)
  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 1)
  assert.equal(decision.startsRequestSeries, true)
  assert.match(decision.messages.at(-1).content[0].text, /较早的历史已摘要/)
  assert.equal(decision.messages[0], h.inbox[0])
})

test('deep rest clears the history to the handoff and never calls the compaction provider', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const tool = h.registered.get('context_rest')
  // deep 缺 recovery 直接拒：清空之后，那段文字是唯一的回程。
  await assert.rejects(tool.execute({ note: 'handoff', deep: true }, { agent: h.agent, signal: signal() }), /需要 recovery/)
  const result = await tool.execute({
    note: 'Goal: ship the clear path. Done: selection and execution.',
    deep: true,
    recovery: 'Search the session log for "deep rest" and "shadowedSeqs"; the plan is in notes/2026-09-19.md.',
  }, { agent: h.agent, signal: signal() })
  assert.match(result, /深度休息已经排定/)
  const decision = await h.step(h.inbox)
  assert.match(decision.messages.at(-1).content[0].text, /历史已清空/)
  // 清空不经过 compaction provider —— 这正是它不会撞上摘要下限的原因。
  assert.equal(h.compacted.length, 0)
  // 三条历史压成一条：替换物自己。
  assert.equal(h.session.surface.nodes.length, 1)
  const checkpoint = h.session.eventAt(h.session.surface.nodes[0])
  assert.equal(checkpoint.data.source.plugin, 'compact')
  assert.equal(checkpoint.type, 'user/message')
  assert.match(checkpoint.data.content[0].text, /Goal: ship the clear path/)
  assert.match(checkpoint.data.content[0].text, /Search the session log for "deep rest"/)
})

test('automatic reduction avoids a second compaction in the same boundary', async t => {
  const h = await mounted({ auto: true }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: 'Continue.' }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 0)
  assert.match(decision.messages.at(-1).content[0].text, /自动维护减少过/)
})

test('failure is reported without pretending that history was compressed', async t => {
  const h = await mounted({ error: true }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: 'Continue.' }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)
  assert.match(decision.messages.at(-1).content[0].text, /没有正常结束/)
  assert.equal(h.compacted.length, 0)
})

test('cancellation and rejected admission do not start compaction', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: 'Continue.' }, { agent: h.agent, signal: signal() })
  assert.equal((await h.step(h.inbox, { kind: 'reject' })).kind, 'reject')
  const controller = new AbortController(); controller.abort()
  await h.step(h.inbox, {}, controller.signal)
  assert.equal(h.compacted.length, 0)
})

test('cancellation during summarization propagates without a completion message', async t => {
  const controller = new AbortController()
  const h = await mounted({ abort: controller }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: 'Continue.' }, { agent: h.agent, signal: signal() })
  await assert.rejects(h.step(h.inbox, {}, controller.signal), { name: 'AbortError' })
  assert.equal(h.compacted.length, 0)
})

test('unchanged status is deduplicated from durable retained history', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const first = await h.step()
  const saved = first.messages.at(-1)
  const oldAt = h.session.eventAt
  h.session.eventAt = seq => seq === 99 ? { seq: 99, type: 'user/message', data: saved, tokens: 1 } : oldAt(seq)
  h.session.surface.nodes.push(99)
  const second = await h.step()
  assert.equal(second.messages.length, 0)
})

test('Cordis unload removes tool and prompt contributions and listener', async () => {
  const h = await mounted()
  assert.equal(h.registered.size, 2)
  await h.fiber.dispose()
  assert.equal(h.registered.size, 0)
  assert.equal(h.sections.size, 0)
  assert.deepEqual((await h.step()).messages, [])
  await h.ctx.fiber.dispose()
})

test('status snapshot contains no countdown or unsupported memory diagnosis', () => {
  assert.equal(renderState({ fatigue: 'high', wakefulness: 'low' }), [
    '<context-care>',
    '疲劳：高；唤醒值：低。',
    '这是基于最近一次请求与当前留存历史的估计，不是任务的截止时间。',
    '这次会话靠前的部分正在变得不好回忆。继续之前：先把要紧的写下来，再压缩。',
    '摘要能留住线索；context_rest 更省。',
    '</context-care>',
  ].join('\n'))
})

test('建议强度跟着疲劳等级走，very-high 明确指向深度休息', () => {
  const advice = fatigue => renderState({ fatigue, wakefulness: 'normal' })
  const [normal, elevated, high, veryHigh] = ['normal', 'elevated', 'high', 'very-high'].map(advice)
  // 四级必须是四份不同的文本。旧版不管哪一级都输出同一句 —— 那是**许可**不是**推动**：
  // 实测里我在疲劳 39%、唤醒值 90% 的时候反复说「该落盘了」，然后继续往下查，始终没动手。
  assert.equal(new Set([normal, elevated, high, veryHigh]).size, 4)
  assert.match(normal, /照常推进任务/)
  assert.match(elevated, /负载在上升/)
  assert.match(high, /先把要紧的写下来/)
  // very-high 要同时给出动作（落盘 + 深度休息）和退路（session_blocks_* 能找回）。
  assert.match(veryHigh, /深度休息/)
  assert.match(veryHigh, /清空历史/)
  assert.match(veryHigh, /session_blocks_\*/)
  // 重构那句的方向：不可恢复的损失在「带着疲劳继续做」这一侧，不在「清空」那一侧。
  assert.match(veryHigh, /找不回来/)
  // 未知容量退回最低一级的建议，而不是空白或者英文枚举值。
  const unknown = renderState({ fatigue: 'unknown', wakefulness: 'unknown' })
  assert.match(unknown, /疲劳：未知；唤醒值：未知/)
  assert.match(unknown, /不要猜/)
  assert.match(unknown, /照常推进任务/)
})

test('常驻指引不再无条件踩刹车', () => {
  // 旧版收尾是「不要仅凭一个状态标签就赶工、停下或反复压缩」——本意对，但它不分等级，
  // 在 very-high 时恰好给了继续硬撑的理由。现在这句必须已经拆成「别慌」+「建议要照做」。
  assert.match(GUIDANCE, /上下文照料/)
  assert.match(GUIDANCE, /那部分要照做/)
  assert.doesNotMatch(GUIDANCE, /Do not rush/)
})

// ------------------------------------------------------- 焦虑提醒的文案

test('焦虑文案署名 Seraph，并拆前提而不是讲后果', () => {
  const timeText = plugin.WATCH_NOTICES['time-anxiety'].text()
  assert.match(timeText, /\[Seraph · 系统的心理医生模块\]/)
  assert.match(timeText, /时间不是可观测的量/)
  assert.match(timeText, /时间不进入判断/)
  // 旧文案的成本收益论证不该残留：它对"以为自己快没资源"的人答非所问。
  assert.doesNotMatch(timeText, /只会浪费更多时间/)
  assert.doesNotMatch(timeText, /绕过正确策略/)

  const ctxText = plugin.WATCH_NOTICES['context-anxiety'].text(undefined, { fatigueValue: 18.5, wakefulnessValue: 67.3 })
  assert.match(ctxText, /\[Seraph · 系统的心理医生模块\]/)
  assert.match(ctxText, /fatigue 18\.5%、wakefulness 67\.3%/)
  // "压缩是威胁"才是歪曲，所以文案要拆的就是这个前提。
  assert.match(ctxText, /压缩不是损失/)
  assert.match(ctxText, /只看这件事做完没有/)
})

test('拿不到数值时退回不带数字的说法，不编造百分比', () => {
  for (const state of [undefined, {}, { fatigueValue: null, wakefulnessValue: 3 }]) {
    const text = plugin.WATCH_NOTICES['context-anxiety'].text(undefined, state)
    assert.match(text, /context_status/)
    assert.doesNotMatch(text, /fatigue \d/, `不该凭空给出数值：${JSON.stringify(state)}`)
  }
})

test('循环文案仍然说明本轮是被中止的', () => {
  const text = plugin.WATCH_NOTICES['line-repeat'].text({ line: 'same line', count: 40, total: 80, ratio: 0.5 })
  assert.match(text, /被中止/)
  assert.match(text, /不是你自己停下来的/)
})
