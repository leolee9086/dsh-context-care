import test from 'node:test'
import assert from 'node:assert/strict'
import { lastAssistantText, lastUserMessage, recentToolCalls, textOf } from '../src/prompt-text.js'

/** 造一个假会话:节点顺序就是事件顺序。 */
function fakeSession(events) {
  return {
    surface: { nodes: events.map((_, index) => index) },
    eventAt: node => events[node],
  }
}

test('textOf 只取 text 块', () => {
  assert.equal(textOf({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assert.equal(textOf({ content: 'raw' }), 'raw')
  assert.equal(textOf({}), '')
})

test('lastUserMessage 找最后一条真人说的', () => {
  const messages = [
    { source: { kind: 'user' }, content: [{ type: 'text', text: '第一句' }] },
    { source: { kind: 'plugin' }, content: [{ type: 'text', text: '插件注入' }] },
    { source: { kind: 'user' }, content: [{ type: 'text', text: '第二句' }] },
  ]
  assert.equal(textOf(lastUserMessage(messages)), '第二句')
  assert.equal(lastUserMessage([]), undefined)
})

test('recentToolCalls 从会话事件里取工具调用，按时间正序', () => {
  const session = fakeSession([
    { type: 'user/message', time: 1, data: { content: [] } },
    { type: 'tool/call', time: 100, data: { name: 'read' } },
    { type: 'tool/result', time: 101, data: {} },
    { type: 'tool/call', time: 200, data: { name: 'session_blocks_remember' } },
    { type: 'assistant/message', time: 300, data: { content: [{ type: 'text', text: '说完了' }] } },
  ])
  assert.deepEqual(recentToolCalls(session), [
    { name: 'read', at: 100 },
    { name: 'session_blocks_remember', at: 200 },
  ])
  assert.deepEqual(recentToolCalls(session, { limit: 1 }), [{ name: 'session_blocks_remember', at: 200 }])
})

test('lastAssistantText 取最后一条助手输出', () => {
  const session = fakeSession([
    { type: 'assistant/message', time: 1, data: { content: [{ type: 'text', text: '早先说的' }] } },
    { type: 'user/message', time: 2, data: { content: [] } },
    { type: 'assistant/message', time: 3, data: { content: [{ type: 'text', text: '刚说的' }] } },
  ])
  assert.equal(lastAssistantText(session), '刚说的')
})

test('会话没有 surface 时返回空，不抛', () => {
  assert.deepEqual(recentToolCalls(undefined), [])
  assert.equal(lastAssistantText({}), '')
})
