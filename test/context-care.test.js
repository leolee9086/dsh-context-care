import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.js'
import { calculateState, renderState, resolveConfig } from '../src/policy.js'
import { selectRestRange } from '../src/selection.js'

const signal = () => new AbortController().signal
const user = (seq, tokens = 500, source = { kind: 'user' }) => ({ seq, type: 'user/message', data: { source, content: [{ type: 'text', text: 'x' }] }, tokens })
function history(events) {
  return {
    surface: { nodes: events.map(e => e.seq), replaceGeneration: 0 },
    eventAt: seq => events.find(event => event.seq === seq),
    requestHeader: () => ({ config: { provider: 'test', model: 'test' } }),
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

test('summary-only and plugin statuses are not fresh work', () => {
  const session = history([user(1, 8000, { kind: 'plugin', plugin: 'compact', compactionId: 'checkpoint' }),
    user(3, 8000, { kind: 'plugin', plugin: 'dsh-context-care:state' }), user(7, 2000)])
  assert.equal(selectRestRange(session, measurement(session), 1500, 1000, plugin.name), null)
})

test('tool queues a bounded note; next boundary compacts once and preserves decision fields', async t => {
  const h = await mounted(); t.after(() => h.ctx.fiber.dispose())
  const tool = h.registered.get('context_rest')
  await assert.rejects(tool.execute({ note: '' }, { agent: h.agent, signal: signal() }), /note must/)
  await assert.rejects(tool.execute({ note: 'x'.repeat(4001) }, { agent: h.agent, signal: signal() }), /note must/)
  for (const args of [null, {}, { note: 42 }, { note: 'valid', extra: true }, []]) {
    await assert.rejects(tool.execute(args, { agent: h.agent, signal: signal() }), /note must/)
  }
  await assert.rejects(h.registered.get('context_status').execute({ unexpected: true }, { agent: h.agent, signal: signal() }), /empty object/)
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['note'])
  assert.equal(tool.parameters.additionalProperties, false)
  const result = await tool.execute({ note: 'Finish verification; files in workspace.' }, { agent: h.agent, signal: signal() })
  assert.match(result, /not completed/)
  assert.equal(h.compacted.length, 0)
  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 1)
  assert.equal(decision.startsRequestSeries, true)
  assert.match(decision.messages.at(-1).content[0].text, /completed: older history summarized/)
  assert.equal(decision.messages[0], h.inbox[0])
})

test('automatic reduction avoids a second compaction in the same boundary', async t => {
  const h = await mounted({ auto: true }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: 'Continue.' }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 0)
  assert.match(decision.messages.at(-1).content[0].text, /already reduced/)
})

test('failure is reported without pretending that history was compressed', async t => {
  const h = await mounted({ error: true }); t.after(() => h.ctx.fiber.dispose())
  await h.registered.get('context_rest').execute({ note: 'Continue.' }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)
  assert.match(decision.messages.at(-1).content[0].text, /did not finish normally/)
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
  assert.equal(renderState({ fatigue: 'high', wakefulness: 'low' }), '<context-care>\nFatigue: high; wakefulness: low.\nEstimate based on the latest recorded request and currently retained history, not a task deadline.\nContinue the task; use context_rest when a checkpoint would help.\n</context-care>')
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
