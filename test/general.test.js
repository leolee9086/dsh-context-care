// 通用入口(src/host.js)的行为:一次挂载、对所有会话生效,
// 并且与"preset 里还挂着 /agent 的旧会话"共存而不重复工作。
import test from 'node:test'
import assert from 'node:assert/strict'
import * as general from '../src/host.js'
import { installContextCare } from '../src/index.js'

const signal = () => new AbortController().signal
/**
 * 交接笔记的默认区间是 1000~10000 字（宜细不宜粗）。
 * 这里凑够下限，好让下面的用例专注于它们真正要验的东西 ——
 * 排队、边界、保留哪些字段 —— 而不是长度规则本身。
 * 长度规则另有专门的用例。
 */
const longNote = text => text.padEnd(1200, '…')
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

/**
 * 最小假 ctx:只实现本插件触到的接口。
 * `shadowed` 模拟该 agent 的作用域里已有另一份实现(preset 挂的 /agent),
 * 此时 tools.get 返回一个不同的定义。
 */
function harness({ shadowed = false, hasProvider = true } = {}) {
  const tools = new Map()
  const sections = new Map()
  const listeners = []
  const compacted = []
  const foreign = { name: 'context_rest', description: 'agent-scoped instance' }
  const session = history([user(0, 2000), user(1, 2000), user(2, 2000)])
  const inbox = []
  const agent = { session, inject: message => inbox.push(message) }
  const provider = { async compactRegion(start, end, owner) { compacted.push({ start, end, owner }) } }
  // 插件现在会 provide 一个通知通道,假 ctx 也得跟上。
  const provided = new Map()

  const ctx = {
    tokenMeter: { measure: measurement, estimateMessage: () => 10 },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 10000 } }) },
    sessionProjections: { register: () => () => {} },
    systemPrompt: {
      context(section) { sections.set(section.name, section); return () => sections.delete(section.name) },
    },
    tools: {
      register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) },
      get(name) { return shadowed && name === 'context_rest' ? foreign : tools.get(name) },
    },
    logger: { warn: () => {}, info: () => {} },
    provide(name, service) { provided.set(name, service); return () => provided.delete(name) },
    effect(callback) { return callback() },
    on(event, handler) { listeners.push({ event, handler }); return () => {} },
    get(service) {
      if (service === 'agentPresets') {
        return { serviceFor: (_agent, name) => (name === 'compaction' && hasProvider ? provider : undefined) }
      }
      return undefined
    },
  }

  async function step(messages = [], nextExtra = {}) {
    const { handler } = listeners.find(entry => entry.event === 'agent/pre-step')
    return handler({ agent, signal: signal() }, async () => ({ kind: 'enter', messages, startsRequestSeries: true, ...nextExtra }))
  }

  return { ctx, tools, sections, compacted, session, inbox, agent, provider, step }
}

test('根入口:工具与系统提示挂在全局,compaction 按 agent 现取', async () => {
  const h = harness()
  general.apply(h.ctx, {})

  assert.deepEqual([...h.tools.keys()].sort(), ['context_rest', 'context_status'])
  assert.deepEqual([...h.sections.keys()], ['dsh-context-care'])

  await h.tools.get('context_rest').execute({ note: longNote('继续验证。') }, { agent: h.agent, signal: signal() })
  assert.equal(h.compacted.length, 0)

  const decision = await h.step(h.inbox)
  assert.equal(h.compacted.length, 1)
  assert.equal(h.compacted[0].owner, h.agent)
  assert.match(decision.messages.at(-1).content[0].text, /较早的历史已摘要/)
})

test('agent 作用域里已有别的实现时,根实现退让,不重复通知也不重复压缩', async () => {
  const h = harness({ shadowed: true })
  general.apply(h.ctx, {})

  await h.tools.get('context_rest').execute({ note: longNote('继续验证。') }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)

  assert.equal(h.compacted.length, 0, '根实现不该压缩')
  assert.deepEqual(decision.messages, h.inbox, '根实现不该追加状态消息')
})

test('解析不到 compaction provider 时如实报告,不抛异常', async () => {
  const h = harness({ hasProvider: false })
  general.apply(h.ctx, {})

  await h.tools.get('context_rest').execute({ note: longNote('继续验证。') }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)

  assert.equal(h.compacted.length, 0)
  assert.match(decision.messages.at(-1).content[0].text, /没有可用的压缩提供方/)
})

test('安装函数仍接受直接传入的 compaction 服务(旧的 /agent 与 activate 路径)', async () => {
  const h = harness({ hasProvider: false })
  installContextCare(h.ctx, {}, h.provider)

  await h.tools.get('context_rest').execute({ note: longNote('继续验证。') }, { agent: h.agent, signal: signal() })
  const decision = await h.step(h.inbox)

  assert.equal(h.compacted.length, 1)
  assert.match(decision.messages.at(-1).content[0].text, /较早的历史已摘要/)
})
