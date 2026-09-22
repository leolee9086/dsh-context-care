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
