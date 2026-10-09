import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.js'
import * as requests from '../src/request-host.js'
import { calculateState, GUIDANCE, renderState, resolveConfig } from '../src/policy.js'
import { selectClearRange, selectRestRange } from '../src/selection.js'
import { clearRange } from '../src/deep-rest.js'
import { detectLoop } from '../src/loop-guard.js'

const signal = () => new AbortController().signal
/** 交接笔记的默认区间是 1000~10000 字（宜细不宜粗）；这里凑够下限，见 general.test.js 里的同一说明。 */
const longNote = text => text.padEnd(1200, '…')
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
    get seq() { return log.length },
    deriveEventMessage(event) {
      if (event.type === 'user/message') return { role: 'user', ...event.data, tokens: event.tokens ?? 500 }
      return event.data.message === undefined ? null : { ...event.data.message, tokens: event.tokens ?? 500 }
    },
    deriveMessages() { return surface.nodes.map(seq => this.deriveEventMessage(this.eventAt(seq))).filter(Boolean) },
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
  const nodes = session.surface.nodes.map(seq => ({ seq, tokens: session.eventAt(seq).tokens ?? 500, heuristicTokens: session.eventAt(seq).tokens ?? 500 }))
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
  ctx.provide('agents', { get: () => agent })
  ctx.provide('sessionProjections', { register: () => () => {} })
  ctx.provide('sessions', {
    // This unit fixture mounts no session registry; real session admission and restore
    // are verified by integration.test.js with the Host's own sessions service.
    list: () => [],
    get: () => undefined,
    messageProjections: [],
    registerMessageProjection(projection) {
      this.messageProjections.push(projection)
      return () => { this.messageProjections.splice(this.messageProjections.indexOf(projection), 1) }
    },
  })
  ctx.provide('tools', { get(name) { return registered.get(name) }, register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } })
  ctx.provide('systemPrompt', { context(section) { sections.set(section.name, section); return () => sections.delete(section.name) } })
  ctx.provide('tokenMeter', {
    measure: measurement, estimateMessage: message => message.tokens ?? (message.content.length ? 10 : 0),
  })
  ctx.provide('llm', { resolveModelInfo: async () => options.modelInfo ?? ({ context: { contextWindow: 10000 } }), imageRequestPricing: () => undefined, fileRequestText: ref => ref.name })
  ctx.provide('compaction', { async compactRegion(start, end, owner, sig) {
    if (options.error) throw new Error('summary rejected')
    if (options.abort) { options.abort.abort(); sig.throwIfAborted() }
    compacted.push({ start, end, owner })
    session.surface.replaceGeneration++
  } })
  const records = new Map()
  ctx.provide('storageDomain', { async open() { return { table: () => ({ put: async (key, value) => records.set(key, value), entries: () => records.entries() }), close: async () => {} } } })
  await ctx.plugin(requests)
  const fiber = await ctx.plugin(plugin, { minFreshTokens: 1000, ...options.config })
  async function step(messages = [], nextExtra = {}, sig = signal(), owner = agent) {
    return ctx.waterfall('agent/pre-step', { agent: owner, signal: sig }, async () => {
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

test('system tokens never make a status-only prefix fresh', () => {
  const session = history([
    { seq: 0, type: 'system/message', data: { message: { role: 'system', content: [] } }, tokens: 20000 },
    user(1, 6000, { kind: 'compact-checkpoint', compactionId: 'older' }),
    user(2, 500, { kind: 'plugin', plugin: 'dsh-context-care:state' }),
    user(3, 25000),
  ])
  assert.equal(selectRestRange(session, measurement(session), 20000, 1024, 'dsh-context-care'), null)
})

test('one session arming maintenance cannot cause another session below the soft budget to compact', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const first = { ...h.agent, session: history([user(0, 9000)]) }
  const second = { ...h.agent, session: history([user(0, 3000), user(1, 2000), user(2, 2000)]) }
  await h.step([], {}, signal(), first)
  await h.step([], {}, signal(), second)
  assert.equal(h.compacted.length, 0)
})

test('deep rest rejects a larger complete handoff before opening a transaction and preserves fixed shadow prices', () => {
  const session = history([user(0, 2000), user(1, 2000)])
  const range = selectClearRange(session)
  const pricing = {
    measure: () => ({ nodes: [{ seq: 0, tokens: 10000, heuristicTokens: 2000 }, { seq: 1, tokens: 10000, heuristicTokens: 2000 }], pricingBasis: { textScale: 5 } }),
    priceMessages: () => 20000,
  }
  assert.throws(() => clearRange(session, {}, range, 'oversized', pricing), /handoff-larger-than-history/)
  assert.equal(session.snapshotEvents().length, 2)
  const committed = clearRange(session, {}, range, 'bounded handoff', { ...pricing, priceMessages: () => 10000 })
  assert.equal(committed.shadowedTokenCount, 4000)
  assert.equal(session.surface.nodes.length, 1)
})

test('deep rest refuses a selected span changed while awaiting the maintenance ACK', () => {
  const session = history([user(0, 2000), user(1, 2000)])
  const range = selectClearRange(session)
  session.append('user/message', { content: [{ type: 'text', text: 'Concurrent saved work.' }] }, { surfaceOp: 'append' })
  session.surface.nodes.splice(1, 0, session.surface.nodes.pop())
  assert.throws(() => clearRange(session, {}, range, 'handoff'), /handoff source changed/)
  assert.equal(session.snapshotEvents().filter(event => event.type.startsWith('compaction/')).length, 0)
  assert.deepEqual(session.surface.nodes, [0, 2, 1])
})

test('tool queues a bounded note; next boundary compacts once and preserves decision fields', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const tool = h.registered.get('context_rest')
  // 下限是**要求**（宜细不宜粗），不是防呆 —— 太短的笔记，下一个自己还得回去翻日志。
  await assert.rejects(tool.execute({ note: '' }, { agent: h.agent, signal: signal() }), /note 需要/)
  await assert.rejects(tool.execute({ note: 'x'.repeat(999) }, { agent: h.agent, signal: signal() }), /note 需要/)
  await assert.rejects(tool.execute({ note: 'x'.repeat(10001) }, { agent: h.agent, signal: signal() }), /note 需要/)
  for (const args of [null, {}, { note: 42 }, []]) {
    await assert.rejects(tool.execute(args, { agent: h.agent, signal: signal() }), /note 需要/)
  }
  // 未知参数单独报错，和「note 不合法」分开：对调用方来说这是两种不同的修法。
  await assert.rejects(tool.execute({ note: 'valid', extra: true }, { agent: h.agent, signal: signal() }), /只接受/)
  await assert.rejects(h.registered.get('context_status').execute({ unexpected: true }, { agent: h.agent, signal: signal() }), /空对象/)
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['note'])
  assert.equal(tool.parameters.additionalProperties, false)
  const result = await tool.execute({ note: longNote('Finish verification; files in workspace.') }, { agent: h.agent, signal: signal() })
  assert.match(result, /还没完成/)
  assert.equal(h.compacted.length, 0)
  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 1)
  assert.equal(decision.startsRequestSeries, true)
  assert.match(decision.messages.at(-1).content[0].text, /较早的历史已摘要/)
  assert.equal(decision.messages[0], h.inbox[0])
})

test('rest advertises 8000 characters, accepts the internal boundary and keeps tolerance out of model-facing text', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const tool = h.registered.get('context_rest')
  const advertised = JSON.stringify(tool.parameters)
  assert.match(advertised, /1000~8000 字符/)
  assert.doesNotMatch(advertised, /10000|宽限|tolerance/)
  for (const length of [8000, 8001, 10000]) {
    const note = '字'.repeat(length)
    await tool.execute({ note, deep: true, recovery: note }, { agent: h.agent, signal: signal() })
    assert.equal(h.inbox.at(-1).content[0].text.includes(note), true)
  }
  for (const args of [{ note: '字'.repeat(10001) }, { note: longNote('handoff'), recovery: '字'.repeat(10001) }]) {
    await assert.rejects(tool.execute(args, { agent: h.agent, signal: signal() }), error => {
      assert.match(error.message, /1000-8000/)
      assert.doesNotMatch(error.message, /10000|宽限/)
      return true
    })
  }
})

test('explicit rest reaches the provider with unknown capacity or no prior routed header', async t => {
  for (const scenario of [
    { name: 'unknown capacity', modelInfo: {}, expectedEnd: 1 },
    { name: 'unknown capacity with an explicit retained tail', modelInfo: {}, config: { retainTokens: 3000 }, expectedEnd: 0 },
    { name: 'no routed header', noHeader: true, expectedEnd: 1 },
  ]) await t.test(scenario.name, async t => {
    const h = await mounted(scenario); t.after(() => h.ctx.fiber.dispose())
    if (scenario.noHeader) h.session.requestHeader = () => undefined
    // An unknown pressure threshold does not itself schedule automatic work.
    await h.step()
    assert.equal(h.compacted.length, 0)
    const note = longNote('Continue the verified task after this requested checkpoint.')
    await h.registered.get('context_rest').execute({ note }, { agent: h.agent, signal: signal() })
    const decision = await h.step(h.inbox)
    assert.equal(h.compacted.length, 1)
    assert.deepEqual({ start: h.compacted[0].start, end: h.compacted[0].end }, { start: 0, end: scenario.expectedEnd })
    assert.ok(decision.messages.includes(h.inbox[0]))
    assert.match(decision.messages.at(-1).content[0].text, /较早的历史已摘要/)
  })
})

test('deep rest clears the history to the handoff and never calls the compaction provider', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const tool = h.registered.get('context_rest')
  // deep 缺 recovery 直接拒：清空之后，那段文字是唯一的回程。
  await assert.rejects(tool.execute({ note: longNote('handoff'), deep: true }, { agent: h.agent, signal: signal() }), /需要 recovery/)
  const result = await tool.execute({
    note: longNote('Goal: ship the clear path. Done: selection and execution.'),
    deep: true,
    recovery: longNote('Search the session log for "deep rest" and "shadowedSeqs"; the plan is in notes/2026-09-19.md.'),
  }, { agent: h.agent, signal: signal() })
  assert.match(result, /深度休息已经排定/)
  const decision = await h.step(h.inbox)
  assert.match(decision.messages.at(-1).content[0].text, /历史已用交接和找回路径替换/)
  assert.equal(decision.messages.includes(h.inbox[0]), false, 'The committed handoff must not be admitted a second time')
  // 清空不经过 compaction provider —— 这正是它不会撞上摘要下限的原因。
  assert.equal(h.compacted.length, 0)
  // 三条历史压成一条：替换物自己。
  assert.equal(h.session.surface.nodes.length, 1)
  const checkpoint = h.session.eventAt(h.session.surface.nodes[0])
  assert.equal(checkpoint.data.source.kind, 'compact-checkpoint')
  assert.equal(checkpoint.type, 'user/message')
  assert.match(checkpoint.data.content[0].text, /Goal: ship the clear path/)
  assert.match(checkpoint.data.content[0].text, /Search the session log for "deep rest"/)
})

test('automatic reduction avoids a second compaction in the same boundary', async t => {
  const h = await mounted({ auto: true }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: longNote('Continue.') }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 0)
  assert.match(decision.messages.at(-1).content[0].text, /自动维护减少过/)
})

test('delegated ordinary maintenance does not consume an explicit deep handoff', async t => {
  const h = await mounted({ auto: true }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: longNote('Goal: preserve verified results.'), deep: true,
    recovery: longNote('Read the original session sources.') }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 0)
  const checkpoint = h.session.eventAt(h.session.surface.nodes.at(-1))
  assert.equal(checkpoint.data.source.kind, 'compact-checkpoint')
  assert.match(checkpoint.data.content[0].text, /Goal: preserve verified results/)
  assert.match(decision.messages.at(-1).content[0].text, /交接和找回路径替换/)
})

test('failure is reported without pretending that history was compressed', async t => {
  const h = await mounted({ error: true }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: longNote('Continue.') }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)
  assert.match(decision.messages.at(-1).content[0].text, /没有正常结束/)
  assert.equal(h.compacted.length, 0)
})

test('cancellation and rejected admission do not start compaction', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: longNote('Continue.') }, { agent: h.agent, signal: signal() })
  assert.equal((await h.step(h.inbox, { kind: 'reject' })).kind, 'reject')
  const controller = new AbortController(); controller.abort()
  await h.step(h.inbox, {}, controller.signal)
  assert.equal(h.compacted.length, 0)
})

test('cancellation during summarization propagates without a completion message', async t => {
  const controller = new AbortController()
  const h = await mounted({ abort: controller }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: longNote('Continue.') }, { agent: h.agent, signal: signal() })
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
    '本次请求触发了高负载维护建议。继续之前：先把目标、已验证结果和未完成工作落盘，再按当前策略整理上下文。',
    '摘要能留住线索；用 context_rest 写细交接并排定维护。',
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
  assert.match(high, /已验证结果和未完成工作落盘/)
  assert.match(veryHigh, /深度休息/)
  assert.match(veryHigh, /可清空历史/)
  assert.match(veryHigh, /原始细节仍可从会话日志或检查点核对/)
  assert.match(veryHigh, /不改变你的身份、目标与判断归属/)
  for (const text of [normal, elevated, high, veryHigh]) assert.doesNotMatch(text, /回忆不可靠|不好回忆|错误会叠加|活儿找不回来/)
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

test('规划提醒保留真实期限与当前计量，并注明本插件的提醒来源', () => {
  const timeText = plugin.WATCH_NOTICES['time-anxiety'].text()
  assert.match(timeText, /\[Seraph · 上下文照料提醒\]/)
  assert.match(timeText, /明确给出的期限、当前时间和已知运行限制可以用于规划/)
  assert.match(timeText, /未提供的剩余运行额度按未知处理/)
  assert.doesNotMatch(timeText, /时间不是可观测的量|时间不进入判断|心理医生模块/)

  const ctxText = plugin.WATCH_NOTICES['context-anxiety'].text(undefined, { fatigueValue: 18.5, wakefulnessValue: 67.3 })
  assert.match(ctxText, /\[Seraph · 上下文照料提醒\]/)
  assert.match(ctxText, /fatigue 18\.5%、wakefulness 67\.3%/)
  assert.match(ctxText, /结合实际工作步骤、当前计量、交接和找回路径/)
  assert.match(ctxText, /压缩前把当前目标、已验证结果、未完成工作和关键路径记清/)
  assert.doesNotMatch(ctxText, /不需要提前做任何准备|不看已经用了多少/)
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
  assert.match(text, /原始细节仍可从会话日志或检查点核对/)
  assert.match(text, /其余内容整理成准确交接/)
  assert.doesNotMatch(text, /唯一的依据|原文一律抄进去|别转述成摘要|模型侧的退化/)
})

/** 把一段助手文本包成 detectLoop 认得的 session。 */
const assistantSession = text => history([{
  seq: 0,
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
}])

test('代码围栏不算循环：写文档时围栏天然成对出现', () => {
  // 20 个代码块 = 40 行围栏 + 20 行各不相同的内容，后面再跟 40 行正文。
  // 围栏在末尾 80 行里占 28 行（35%），改之前正好越过 15 次 / 20% 两条线 ——
  // 实测误报过一次：``` 重复 18 次、占末尾 80 行的 23%。
  const fence = '`'.repeat(3)
  const blocks = Array.from({ length: 20 }, (_, i) => [fence + 'js', `const a${i} = ${i}`, fence].join('\n'))
  const prose = Array.from({ length: 40 }, (_, i) => `正文第 ${i} 行，每行都不一样。`)
  assert.equal(detectLoop(assistantSession([...blocks, ...prose].join('\n'))), undefined)
})

test('真实循环仍然认得出：同一行反复出现', () => {
  const hit = detectLoop(assistantSession(Array.from({ length: 60 }, () => 'go.').join('\n')))
  assert.ok(hit, '同一行重复 60 次应当判为循环')
  assert.equal(hit.line, 'go.')
  assert.equal(hit.count, 60)
})

// ── 跨插件接线的端到端验证 ────────────────────────────────────────────
//
// 这两条测的是「别的插件声明的东西，真的会进这一轮的 messages 吗」。
// 它们存在的原因：那段接线曾经被删掉过（cc39d99），而当时代码注释、契约、错误文案
// 全都还在，测试却一条都没覆盖 —— 于是删了没人知道，直到有人发现被动召回不再触发。

test('提示规则接线：索引插件声明的规则命中后，进这一轮的 messages', async () => {
  const m = await mounted()
  // 真实部署里这行是索引插件做的（ctx.provide('memoryNoticeRules', NOTICE_RULES)）。
  m.ctx.provide('memoryNoticeRules', [{
    id: 'memory-remember-request', order: 10, placement: ['user'],
    when: { said: '/记一下/' },
    action: { kind: 'notify', by: 'context-care', say: '用户说了「记住」。用 session_blocks_remember 写下来。' },
    cooldownMinutes: 0, oncePerSurface: true,
  }])
  const decision = await m.step([{
    id: 'u1', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '记一下：这条要测接线' }],
  }])
  const hit = decision.messages.find(message => message.source?.kind === 'plugin:dsh-context-care:rules:memory-remember-request')
  assert.ok(hit, '规则命中却没进 messages —— 说明 noticeRules.collect 又没接线了')
  assert.match(hit.content[0].text, /记住/)
  assert.equal(hit.source.form, 'notice')
})

test('通知通道接线：别的插件注册的源会被问一遍，并进这一轮的 messages', async () => {
  const m = await mounted()
  // 真实部署里这是索引插件的被动召回源（lib/index.js 的 ctx.inject(['contextNotices'])）。
  const channel = m.ctx.get('contextNotices')
  assert.ok(channel, 'contextNotices 服务没暴露 —— 别的插件根本注册不了')
  const off = channel.register('passive-recall', () => [{
    id: 'passive-recall:b1',
    text: '<被动召回>\n你以前记过这个\n</被动召回>',
    summary: 'Passive recall (1)',
  }])
  const decision = await m.step([{
    id: 'u2', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '这段话足够长，够抽关键词了' }],
  }])
  const hit = decision.messages.find(message => String(message.source?.kind).includes('notice:passive-recall'))
  assert.ok(hit, '通道里的通知没被注入 —— 说明 noticeChannel.collect 又没接线了')
  assert.match(hit.content[0].text, /被动召回/)
  off()
})

test('规则引擎炸了不该毁掉整个请求：记 warn 后照常返回', async () => {
  const m = await mounted()
  m.ctx.provide('memoryNoticeRules', [{ id: 'broken' }])
  const decision = await m.step([{
    id: 'u3', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '记一下：规则写错了' }],
  }])
  assert.equal(decision.kind, 'enter', '规则出错时这一轮仍要照常发出去')
  assert.ok(Array.isArray(decision.messages))
})

test('事实值接线：规则能用 numbers 读到这一轮的 token 量', async () => {
  const m = await mounted()
  // 真实部署里这条会是「聊了 N 轮还没记东西」，这里用 token 量测同一根线：
  // 值必须在 context-care 的 pre-step 里算出来、并填进引擎的 ctx。
  m.ctx.provide('memoryNoticeRules', [{
    id: 'by-volume', order: 5, placement: ['user'],
    when: { numbers: { surfaceTokens: { gte: 1 } } },
    action: { kind: 'notify', by: 'context-care', say: '按积累量提醒' },
    cooldownMinutes: 0, oncePerSurface: true,
  }])
  const decision = await m.step([{
    id: 'u9', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '随便说点什么' }],
  }])
  const hit = decision.messages.find(message => message.source?.kind === 'plugin:dsh-context-care:rules:by-volume')
  assert.ok(hit, '规则用 numbers 读不到事实值 —— facts 没接上 ctx')
  assert.match(hit.content[0].text, /按积累量提醒/)
})

test('事实值接线：算不出来的指标给 null，判不命中，且不连累同一批里别的规则', async () => {
  const m = await mounted()
  // 这个测试会话里没有 turn/start 事件，turns 会是 null（"此刻不可知"），
  // 而不是 undefined —— 后者会被引擎当成漏填而抛错，把整批规则一起带走。
  m.ctx.provide('memoryNoticeRules', [
    {
      id: 'by-turns', order: 5, placement: ['user'],
      when: { numbers: { turns: { gte: 3 } } },
      action: { kind: 'notify', by: 'context-care', say: '这条不该出现' },
      cooldownMinutes: 0, oncePerSurface: true,
    },
    {
      id: 'by-volume-2', order: 6, placement: ['user'],
      when: { numbers: { surfaceTokens: { gte: 1 } } },
      action: { kind: 'notify', by: 'context-care', say: '这条该照常出现' },
      cooldownMinutes: 0, oncePerSurface: true,
    },
  ])
  const decision = await m.step([{
    id: 'u10', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '再随便说点什么' }],
  }])
  const kinds = decision.messages.map(message => message.source?.kind).filter(Boolean)
  assert.equal(kinds.includes('plugin:dsh-context-care:rules:by-turns'), false, 'turns 不可知时不该命中')
  assert.ok(kinds.includes('plugin:dsh-context-care:rules:by-volume-2'),
    'turns 不可知不该连累同一批里算得出来的规则')
})
