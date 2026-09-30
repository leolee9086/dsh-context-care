import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/activate.js'

/**
 * provider 上报的用量与 DSH 自己数出来的留存内容分开控制。
 *
 * 这两个数在真实会话里并不相等：provider 报的是它计费的量，而 surface 的定价
 * 是 DSH 对留存内容的估计。2026-09-29 实测到前者会报出物理上不可能的值。
 */
async function activate() {
  let listener
  let disposed = false
  let cleanup
  let providerTokens = 4000
  let surfaceTokens = 1000
  let capacity = 10000
  const tools = []
  const events = []
  const agent = {
    ctx: { async plugin(definition) {
      definition.apply({
        on(_event, callback) { listener = callback },
        llm: { async resolveModelInfo() { return { context: { contextWindow: capacity } } } },
        tokenMeter: { measure: () => ({ totalTokens: providerTokens, surfaceTokens }), estimateMessage: () => 0 },
      })
      return { dispose() { disposed = true } }
    } },
    session: {
      surface: { nodes: [] },
      eventAt: seq => events[seq],
      requestHeader: () => ({ config: { provider: 'test', model: 'test' }, tools }),
    },
  }
  await apply({ agents: { get: () => agent }, tools: { get: () => ({}) }, effect(register) { cleanup = register() } }, { sessionId: 'current' })
  return {
    run: decision => listener({ agent, signal: new AbortController().signal }, async () => decision),
    retain(message) { agent.session.surface.nodes.push(events.length); events.push({ type: 'user/message', data: message }) },
    setProviderTokens(value) { providerTokens = value },
    setSurface(value) { surfaceTokens = value },
    setCapacity(value) { capacity = value },
    setTools(value) { tools.length = 0; tools.push(...value) },
    dispose: () => { cleanup(); return disposed },
  }
}

const careOf = result => result.messages[0].source.contextCare

// 复现样本：那一轮 surface 定价 41330，provider 报 209879。
// 同一份 surface 当时只有 148813 个字符（其中 85% 是 ASCII），
// token 数不可能超过字符总数 —— 那个上报值在物理上不成立。
const REPRO = { surface: 41330, providerTokens: 209879, capacity: 262144 }

test('existing-session numeric upgrade preserves outcomes, admission fields and cleanup', async () => {
  const active = await activate()
  const message = { content: [{ type: 'text', text: 'Rest outcome: failed; history retained.' }], source: { kind: 'plugin', plugin: 'dsh-context-care:state', form: 'notice', summary: 'Context state' } }
  const result = await active.run({ kind: 'enter', startsRequestSeries: true, messages: [message] })
  assert.equal(result.startsRequestSeries, true)
  assert.deepEqual(result.messages[0].content, message.content)
  assert.deepEqual(careOf(result), { fatigueValue: 4.4, wakefulnessValue: 54.8 })
  assert.equal(message.source.contextCare, undefined)
  const alreadyNumeric = await active.run(result)
  assert.equal(alreadyNumeric, result)
  assert.equal(active.dispose(), true)
})

test('provider 上报的畸高用量不进疲劳度（2026-09-29 复现）', async () => {
  const active = await activate()
  active.setSurface(REPRO.surface)
  active.setProviderTokens(REPRO.providerTokens)
  active.setCapacity(REPRO.capacity)
  const result = await active.run({ kind: 'enter', messages: [] })
  const text = result.messages[0].content[0].text
  // 分子是留存内容（41330），不是那个 209879。
  assert.equal(careOf(result).fatigueValue, 8.7)
  assert.equal(careOf(result).wakefulnessValue, 68.8)
  assert.match(text, /疲劳：正常/)
  assert.doesNotMatch(text, /非常高/)
  active.dispose()
})

test('provider 上报在比例内时被采信', async () => {
  const active = await activate()
  // 1000 × 2.5 = 2500 以内，属于正常偏差，用它的值。
  active.setProviderTokens(1200)
  const result = await active.run({ kind: 'enter', messages: [] })
  assert.equal(careOf(result).fatigueValue, 5.8)
  active.dispose()
})

test('provider 上报的数字变化不触发通知', async () => {
  const active = await activate()
  const first = await active.run({ kind: 'enter', messages: [] })
  active.retain(first.messages[0])
  // 只有 provider 那个数变了，留存内容没变，对模型可见的状态就没变。
  active.setProviderTokens(REPRO.providerTokens)
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)
  active.dispose()
})

test('numeric-only changes do not notify until the model-visible grade changes', async () => {
  const active = await activate()
  const first = await active.run({ kind: 'enter', messages: [] })
  active.retain(first.messages[0])
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)
  active.setSurface(1030) // 留存内容的定价变了，但模型可见的等级没变。
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)
  active.setSurface(1200) // 唤醒值跨过 30/60/85 里的第二道线。
  const changed = await active.run({ kind: 'enter', messages: [] })
  assert.equal(changed.messages.length, 1)
  assert.match(changed.messages[0].content[0].text, /疲劳：正常；唤醒值：升高/)
  active.retain(changed.messages[0])
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)
  active.dispose()
})

test('工具定义计入请求内容量', async () => {
  const plain = await activate()
  const withTools = await activate()
  withTools.setTools([{ name: 'demo', description: 'x'.repeat(4000) }])
  const a = await plain.run({ kind: 'enter', messages: [] })
  const b = await withTools.run({ kind: 'enter', messages: [] })
  assert.equal(careOf(a).wakefulnessValue, careOf(b).wakefulnessValue)
  assert.ok(careOf(b).fatigueValue > careOf(a).fatigueValue, '工具定义应该抬高请求内容量')
  plain.dispose()
  withTools.dispose()
})

test('existing-session numeric upgrade samples when old grade is unchanged and respects rejection', async () => {
  const active = await activate()
  const rejected = { kind: 'reject', messages: [] }
  assert.equal(await active.run(rejected), rejected)
  const result = await active.run({ kind: 'enter', messages: [] })
  assert.equal(result.messages[0].role, 'user')
  assert.equal(careOf(result).fatigueValue, 4.4)
  assert.match(result.messages[0].content[0].text, /疲劳：正常；唤醒值：正常/)
  assert.doesNotMatch(result.messages[0].content[0].text, /4\.4|54\.8|%/)
  active.dispose()
})
