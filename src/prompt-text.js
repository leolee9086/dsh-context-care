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
 * 事件在 session.surface.nodes 上,用 session.eventAt 取回来;
 * tool/call 的 data 是 { turn, step, callId, name, arguments },时间在事件信封的 time 上。
 *
 * @param {object} session 会话。
 * @param {object} [options]
 * @param {number} [options.limit] 最多往回看多少条调用;找"最近一次"够用了。
 * @returns {Array<{name: string, at: number}>} 按时间正序。
 */
export function recentToolCalls(session, { limit = 50 } = {}) {
  const out = []
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes)) return out
  for (let i = nodes.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const event = session.eventAt(nodes[i])
    if (event?.type !== 'tool/call') continue
    out.push({ name: String(event.data?.name ?? ''), at: Number(event.time) })
  }
  return out.reverse()
}

/**
 * 从会话里取最后一条助手输出的纯文本。
 * 提醒规则里的 when.produced 用它判「助手刚说过什么」。
 *
 * @param {object} session 会话。
 * @returns {string} 文本;没有就空串。
 */
export function lastAssistantText(session) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes)) return ''
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const event = session.eventAt(nodes[i])
    if (event?.type !== 'assistant/message') continue
    return textOf(event.data)
  }
  return ''
}
