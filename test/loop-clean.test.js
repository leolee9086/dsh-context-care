import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanTail, cleanMessage, cleanMessages } from '../src/loop-clean.js'
import { detectLoop } from '../src/loop-guard.js'

/** 造一段像真实循环的文本:前面正常,尾巴上同一行刷了几十遍。 */
function loopingText() {
  const head = ['先读 surface 的实现', '再看 invariant 的约束', '这里有几个点要查'].join('\n')
  const spin = Array.from({ length: 40 }, () => '（做。）').join('\n')
  return head + '\n' + spin
}

test('正常文本原样返回', () => {
  const text = '第一行\n第二行\n第三行'
  assert.deepEqual(cleanTail(text), { text, removedLines: 0 })
})

test('行数太少不判', () => {
  const text = Array.from({ length: 10 }, () => '（做。）').join('\n')
  assert.equal(cleanTail(text).removedLines, 0)
})

test('循环文本被截断并留下说明', () => {
  const cleaned = cleanTail(loopingText())
  assert.ok(cleaned.removedLines > 0)
  assert.match(cleaned.text, /先读 surface 的实现/)
  assert.match(cleaned.text, /已清理/)
  assert.equal(cleaned.text.includes('（做。）'), false)
})

test('同样的输入产出同样的结果 —— 缓存要的就是这个', () => {
  const text = loopingText()
  assert.deepEqual(cleanTail(text), cleanTail(text))
  // 清理过的再清一次不再变:第二次请求不会重复花缓存。
  const once = cleanTail(text).text
  assert.deepEqual(cleanTail(once), { text: once, removedLines: 0 })
})

test('代码围栏行不参与统计', () => {
  const fences = Array.from({ length: 40 }, () => '```').join('\n')
  assert.equal(cleanTail(fences).removedLines, 0)
})

test('cleanMessage 只碰 reasoning 和 text 块，且不改原件', () => {
  const message = {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: loopingText() },
      { type: 'image', data: 'x' },
    ],
  }
  const cleaned = cleanMessage(message)
  assert.ok(cleaned.removedLines > 0)
  assert.notEqual(cleaned.message, message)
  assert.equal(cleaned.message.content[1].data, 'x')
  assert.equal(message.content[0].text.includes('已清理'), false)
})

test('cleanMessages 只清最后一条助手消息', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '问' }] },
    { role: 'assistant', content: [{ type: 'text', text: loopingText() }] },
    { role: 'user', content: [{ type: 'text', text: '再问' }] },
  ]
  const result = cleanMessages(messages)
  assert.ok(result.removedLines > 0)
  assert.equal(result.index, 1)
  assert.match(result.messages[1].content[0].text, /已清理/)
  assert.equal(messages[1].content[0].text.includes('已清理'), false)
})

test('没有助手消息时原样返回', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  const result = cleanMessages(messages)
  assert.equal(result.index, -1)
  assert.equal(result.messages, messages)
})

test('跟 loop-guard 串起来:检测到就清得掉', () => {
  // 假 session 跟真实会话同形:surface.nodes 上是 seq,eventAt 取回事件。
  const message = { role: 'assistant', content: [{ type: 'reasoning', text: loopingText() }] }
  const event = { type: 'assistant/message', seq: 1, time: 0, data: { turn: 1, step: 1, message, stream: [] } }
  const session = { surface: { nodes: [1] }, eventAt: () => event }

  const hit = detectLoop(session)
  assert.ok(hit !== undefined, 'loop-guard 应该认出这段循环')
  assert.equal(hit.line, '（做。）')

  const messages = [{ role: 'user', content: [] }, message]
  const cleaned = cleanMessages(messages)
  assert.ok(cleaned.removedLines > 0)
  assert.equal(cleaned.index, 1)
  assert.match(cleaned.messages[1].content[0].text, /已清理/)
  // 原文不动 —— 日志里那份还在。
  assert.equal(message.content[0].text.includes('已清理'), false)
})
