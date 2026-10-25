// src/prompt-text.js — 从组装好的消息里取纯文本。
// 提示规则和通知通道都要用,所以放在这里,不各自抄一份。

/** 从一条消息里取纯文本。 */
export function textOf(message) {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/**
 * 最后一条真人说的话。
 * 要判的是「用户刚说了什么」,不是历史里任何一句话;没有就返回 undefined。
 */
export function lastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.source?.kind === 'user') return messages[i]
  }
  return undefined
}

/** 最后一条助手输出;没有就返回 undefined。 */
export function lastAssistantMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'assistant') return messages[i]
  }
  return undefined
}

/**
 * 从会话里取最近的工具调用记录(名字 + 时间)。
 * 「某个工具多久没被调用了」这个判断用它。
 *
 * 调用方提供 Host 共享 surface 类型索引;时间来自原生事件信封。
 *
 * @param {object} session 会话。
 * @param {object} [options]
 * @param {number} [options.limit] 最多往回看多少条调用;找"最近一次"够用了。
 * @returns {Array<{name: string, at: number}>} 按时间正序。
 */
export function recentToolCalls(session, history, { limit = 50 } = {}) {
  const events = history.surfaceEvents(session, 'tool/call')
  return (limit > 0 ? events.slice(Math.max(0, events.length - limit)) : []).map(event => ({ name: String(event.data.name), at: Number(event.time) }))
}

/**
 * 从会话里取最后一条助手输出的纯文本。
 * 提醒规则里的 when.produced 用它判「助手刚说过什么」。
 *
 * @param {object} session 会话。
 * @returns {string} 文本;没有就空串。
 */
export function lastAssistantText(session, history) {
  const event = history.lastSurface(session, 'assistant/message')
  return event ? textOf(history.messageAt(session, event.seq)) : ''
}
