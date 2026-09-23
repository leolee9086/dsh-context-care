// src/loop-clean.js — 把退化成循环的思考,从这一轮要发出去的内容里清掉。
//
// 与 loop-guard.js 的分工:那里只认「是不是循环」并给措辞,不碰会话;
// 这里拿它的判定结果去改内容。改的是这一轮组装好的 messages,**不是日志** ——
// 原文留在会话日志里,随时查得回来;清理只是「这一次不把它发出去」。
//
// 为什么不替换 surface 节点:pre-step 跑在 step/start **之前**,而
// core/session 的 invariant 要求 assistant/message 处在 open step 内
// (requireOpenStep)。所以那条路在 pre-step 会被拒 —— 改 messages 才是对的位置。
//
// 为什么不能只提醒:循环的思考块留在内容里,下一轮请求照样发给模型,
// 既占地方又把退化模式喂回去。提醒是让模型自己收拾,清理由这里做。

/** 清理后补的那行长文。模型需要知道这里被处理过,否则看到的是一段突然中断的思考。 */
const CLEANED_MARK = '（这里原本有一段重复输出，已清理）'

/** 只看末尾这么多行 —— 循环总是拖在尾巴上(与 loop-guard.js 一致)。 */
const TAIL_LINES = 80
/** 太短的行不参与统计:代码里的 `}`、空行之类天然会重复。 */
const MIN_LINE_LEN = 3
/** 代码围栏行不参与:写文档时围栏成对出现,天然重复。 */
const FENCE_LINE = new RegExp('^(`{3,}|~{3,})[\\w+-]*$')
/** 同一行在窗口里出现这么多次才算循环(与 loop-guard.js 一致)。 */
const REPEAT_THRESHOLD = 15
/** 还要占够窗口比例,免得把「正常但啰嗦」也判成循环。 */
const REPEAT_RATIO = 0.2

/** 一行参不参与统计。 */
function counts(line) {
  const trimmed = line.trim()
  return trimmed.length >= MIN_LINE_LEN && !FENCE_LINE.test(trimmed)
}

/**
 * 清掉一段文本末尾的循环。
 *
 * 从末尾往前找:某一行在尾部窗口里重复够多,就把它在这次窗口里**第一次出现**的位置
 * 之后的内容全部丢掉。剩下的照原样保留。
 *
 * 同样的输入必须产出同样的结果 —— 清理不稳定的话,每轮请求都会重新废一次前缀缓存。
 *
 * @param {string} text 原文。
 * @returns {{ text: string, removedLines: number }} 清理结果;没循环时 removedLines 为 0、text 原样。
 */
export function cleanTail(text) {
  const source = String(text)
  const lines = source.split('\n')
  const marks = lines.map(counts)
  const counted = []
  for (let index = 0; index < lines.length; index += 1) {
    if (marks[index]) counted.push(index)
  }
  if (counted.length === 0) return { text: source, removedLines: 0 }

  const windowStart = counted.length > TAIL_LINES ? counted[counted.length - TAIL_LINES] : counted[0]
  const window = lines.slice(windowStart).map(line => line.trim()).filter((line, offset) => marks[windowStart + offset])
  if (window.length === 0) return { text: source, removedLines: 0 }

  const tallies = new Map()
  for (const line of window) tallies.set(line, (tallies.get(line) ?? 0) + 1)
  let worstLine
  let worstCount = 0
  for (const [line, count] of tallies) {
    if (count > worstCount) {
      worstLine = line
      worstCount = count
    }
  }
  if (worstCount < REPEAT_THRESHOLD || worstCount / window.length < REPEAT_RATIO) {
    return { text: source, removedLines: 0 }
  }

  // 从这个循环行在窗口里第一次出现的地方截断。
  let cut = windowStart
  for (let index = windowStart; index < lines.length; index += 1) {
    if (marks[index] && lines[index].trim() === worstLine) {
      cut = index
      break
    }
  }
  // 截断点在第 0 行就保一段:整块清空会让模型看到一段凭空消失的思考。
  if (cut === 0) {
    cut = Math.max(1, Math.floor(lines.length / 4))
  }
  const kept = lines.slice(0, cut).join('\n').replace(/\s+$/, '')
  return {
    text: kept.length === 0 ? CLEANED_MARK : `${kept}\n${CLEANED_MARK}`,
    removedLines: lines.length - cut,
  }
}

/**
 * 清掉一条消息里所有思考块和正文块末尾的循环。
 *
 * @param {object} message 消息(会被复制,不改原件)。
 * @returns {{ message: object, removedLines: number }} 清理后的消息与总行数变化。
 */
export function cleanMessage(message) {
  if (!Array.isArray(message?.content)) return { message, removedLines: 0 }
  let removedLines = 0
  const content = message.content.map(block => {
    if (typeof block?.text !== 'string') return block
    if (block.type !== 'reasoning' && block.type !== 'text') return block
    const cleaned = cleanTail(block.text)
    removedLines += cleaned.removedLines
    return cleaned.removedLines === 0 ? block : { ...block, text: cleaned.text }
  })
  if (removedLines === 0) return { message, removedLines: 0 }
  return { message: { ...message, content }, removedLines }
}

/**
 * 在准备发出去的消息里,清掉最后一条助手输出末尾的循环。
 *
 * 只碰最后一条:循环总是刚发生的那一条,往前翻会把正常的历史也改掉。
 *
 * @param {object[]} messages 这一轮组装好的消息。
 * @returns {{ messages: object[], removedLines: number, index: number }}
 *   清理后的消息、去掉的行数、被清理的是第几条(-1 表示没找到助手消息)。
 */
export function cleanMessages(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'assistant') continue
    const cleaned = cleanMessage(messages[index])
    if (cleaned.removedLines === 0) return { messages, removedLines: 0, index }
    const next = [...messages]
    next[index] = cleaned.message
    return { messages: next, removedLines: cleaned.removedLines, index }
  }
  return { messages, removedLines: 0, index: -1 }
}
