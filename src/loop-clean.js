// src/loop-clean.js — 把退化成循环的内容，从这一轮要发出去的东西里清掉。
//
// **这件事只能打地鼠。** 循环没有通用判据可写 —— 它是模型侧的退化，
// 换一组词、换一种退化方式就是另一个模式。所以这里不追求"认出所有循环"，
// 只追求**加一个模式要足够便宜**：判定表里加一项（loop-patterns.js），
// 这里配一个清法（CLEANERS），别的都不用动。
//
// 判定表在 loop-patterns.js，与 loop-guard.js（agent 层的提醒）共用同一份 ——
// 两张表各自成表的代价实测过：弱循环能清却从不提醒。这里只保留"清法"。
//
// **这里只清严重档**（`hit.severity === 'severe'`，见 loop-patterns.js 开头）：
//   · 轻微档（稀疏轮转、行首单调）交给提醒。那些内容多半还带着信息，切掉是损失；
//     而且"清了又提醒"会让模型被叫去找一段已经不存在的文本。
//   · 严重档（重复占满尾巴）才是噪声，清掉纯赚。
//   注意严重度是按**这一轮的占比**算的，不是模式的静态属性：同样是短句重复，
//   占 93% 是卡带（清），占 33% 是稀疏轮转（报）。
//
// 反过来，严重档在清理执行者缺席时也**必须**由提醒兜底 —— 那条兜底在 loop-guard.js 的
// loopNeedsReminder：执行者就是本文件注册上去的那个改写器。
//
// 改的是这一轮组装好的 messages，**不是日志** —— 原文留在会话日志里，随时查得回来；
// 清理只是"这一次不把它发出去"。执行点在 fetch-router 的请求改写通道
// （见 request-rewrite.js）：pre-step 够不着上一轮的助手输出，请求体里才有。
//
// **清理不往模型可见内容里放任何标记**（2026-09-23 哥哥定的）：模型看到的
// 就是干净的截断内容，不用知道"这里被清理过"；要让人知道，走 UI 记录那条路。

import { CLEANABLE_IDS, detectDegradation } from './loop-patterns.js'

/**
 * 各严重档模式的清法。判定（含"这一轮算不算严重"）全在 loop-patterns.js，
 * 这里只回答"命中之后怎么清"。
 */
const CLEANERS = {
  /** 同一行刷满尾巴：从这个循环行在窗口里第一次出现的地方截断。 */
  'line-repeat'(text, hit) {
    let cut = hit.lines.length
    for (let index = hit.windowStart; index < hit.lines.length; index += 1) {
      if (hit.marks[index] && hit.lines[index].trim() === hit.line) {
        cut = index
        break
      }
    }
    // 截断点落在第 0 行就保一段：整块清空会让模型看到一段凭空消失的思考。
    if (cut === 0) cut = Math.max(1, Math.floor(hit.lines.length / 4))
    return hit.lines.slice(0, cut).join('\n')
  },
  /** 填充行成片：这些行逐条删掉，其余保留 —— 它们本来就不承载信息。 */
  'filler-lines'(text, hit) {
    return hit.lines.filter((_line, index) => !hit.marks[index]).join('\n')
  },
}

/**
 * 模式表。**加一个可清理的模式就是加一项**：判定表里加 detect 并标 cleanable，
 * 这里加同名的清法。
 *
 * 表里的 id 与顺序都取自 loop-patterns.js 的 `CLEANABLE_IDS` ——
 * 判定层是唯一的事实来源，两张表不会各自漂开。
 */
export const PATTERNS = CLEANABLE_IDS.map(id => ({ id, clean: CLEANERS[id] }))

for (const id of CLEANABLE_IDS) {
  if (typeof CLEANERS[id] !== 'function') {
    throw new Error(`loop-clean: 判定表把 "${id}" 标成可清理，但这里没有它的清法`)
  }
}

/**
 * 跑一遍判定表，严重档就清掉命中的那段。
 *
 * 同一个输入必须产出同一个结果 —— 清理不稳定的话，每轮请求都会重新废一次前缀缓存。
 * 而且它必须**幂等**：清过的再清一次不再变。
 *
 * @param {string} text 原文。
 * @returns {{ text: string, removedLines: number, pattern: string|undefined }} 清理结果；没命中时原样返回。
 */
export function cleanTail(text) {
  const source = String(text)
  // 判定只看一次：全表第一个命中说了算。轻微档也认得出，但不在这里动手 —— 那是提醒的活。
  const hit = detectDegradation(source)
  if (hit === undefined || hit.severity !== 'severe') {
    return { text: source, removedLines: 0, pattern: undefined }
  }
  const pattern = PATTERNS.find(entry => entry.id === hit.pattern)
  if (pattern === undefined) return { text: source, removedLines: 0, pattern: undefined }
  const kept = pattern.clean(source, hit).replace(/\s+$/, '')
  const lines = source.split('\n').length
  const keptLines = kept.length === 0 ? 0 : kept.split('\n').length
  return {
    // 不给模型留"已清理"的标记（哥哥 2026-09-23 定的） —— 看到的就是干净截断。
    text: kept,
    removedLines: lines - keptLines,
    pattern: hit.pattern,
  }
}

/**
 * 清掉一条消息里所有思考块和正文块末尾的循环。
 *
 * @param {object} message 消息（会被复制，不改原件）。
 * @returns {{ message: object, removedLines: number, pattern: string|undefined }} 清理后的消息与总行数变化。
 */
export function cleanMessage(message) {
  if (!Array.isArray(message?.content)) return { message, removedLines: 0, pattern: undefined }
  let removedLines = 0
  let pattern
  const content = message.content.map(block => {
    if (typeof block?.text !== 'string') return block
    if (block.type !== 'reasoning' && block.type !== 'text') return block
    const cleaned = cleanTail(block.text)
    removedLines += cleaned.removedLines
    if (cleaned.pattern !== undefined) pattern = cleaned.pattern
    return cleaned.removedLines === 0 ? block : { ...block, text: cleaned.text }
  })
  if (removedLines === 0) return { message, removedLines: 0, pattern: undefined }
  return { message: { ...message, content }, removedLines, pattern }
}

/**
 * 在准备发出去的消息里，清掉最后一条助手输出末尾的循环。
 *
 * 只碰最后一条：循环总是刚发生的那一条，往前翻会把正常的历史也改掉。
 *
 * @param {object[]} messages 这一轮组装好的消息。
 * @returns {{ messages: object[], removedLines: number, index: number, pattern: string|undefined }}
 *   清理后的消息、去掉的行数、被清理的是第几条（-1 表示没找到助手消息）、哪个模式命中的。
 */
export function cleanMessages(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'assistant') continue
    const cleaned = cleanMessage(messages[index])
    if (cleaned.removedLines === 0) return { messages, removedLines: 0, index, pattern: undefined }
    const next = [...messages]
    next[index] = cleaned.message
    return { messages: next, removedLines: cleaned.removedLines, index, pattern: cleaned.pattern }
  }
  return { messages, removedLines: 0, index: -1, pattern: undefined }
}
