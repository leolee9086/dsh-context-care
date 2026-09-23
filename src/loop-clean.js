// src/loop-clean.js — 把退化成循环的内容,从这一轮要发出去的东西里清掉。
//
// **这件事只能打地鼠。** 循环没有通用判据可写 —— 它是模型侧的退化,
// 换一组词、换一种退化方式就是另一个模式。所以这里不追求"认出所有循环",
// 只追求**加一个模式要足够便宜**:一个模式就是 PATTERNS 里的一项,
// 写一个 detect、写一个 clean,别的都不用动。
//
// 与 loop-guard.js 的分工:那边是流式生成中的掐断与提醒(via stream-watch 的触发器表),
// 这边是事后的清理。两处的模式表早晚该合成一份,现在先各自成表。
//
// 改的是这一轮组装好的 messages,**不是日志** —— 原文留在会话日志里,随时查得回来;
// 清理只是"这一次不把它发出去"。
//
// 为什么不替换 surface 节点:pre-step 跑在 step/start **之前**,而 core/session 的
// invariant 要求 assistant/message 处在 open step 内(requireOpenStep)。那条路会被拒。

/** 清理后补的那行说明。模型需要知道这里被处理过,否则看到的是一段突然中断的思考。 */
const CLEANED_MARK = '（这里原本有一段重复输出，已清理）'

/** 只看末尾这么多行 —— 循环总是拖在尾巴上。 */
const TAIL_LINES = 80
/** 太短的行不参与统计:代码里的 `}`、空行之类天然会重复。 */
const MIN_LINE_LEN = 3
/** 代码围栏行不参与:写文档时围栏成对出现,天然重复。 */
const FENCE_LINE = new RegExp('^(`{3,}|~{3,})[\\w+-]*$')
/** 同一行在窗口里出现这么多次才算循环。 */
const REPEAT_THRESHOLD = 15
/** 还要占够窗口比例,免得把「正常但啰嗦」也输出判成循环。 */
const REPEAT_RATIO = 0.2

/** 一行参不参与统计。 */
function counts(line) {
  const trimmed = line.trim()
  return trimmed.length >= MIN_LINE_LEN && !FENCE_LINE.test(trimmed)
}

/**
 * 模式表。**加一个模式就是加一项**:detect 认出来,clean 负责清。
 *
 * detect(text) → 命中信息 | undefined
 * clean(text, hit) → 清理后的文本
 *
 * 一开始只有"同一行反复出现"这一种 —— 实测样本(DeepSeek V4 Flash 失控时):
 *
 *     （输出。）
 *     **做。**
 *     go.
 *     （输出。）
 *     **做。**
 *     go.
 *     …重复上百行
 *
 * 再遇到别的退化形状,在这里加一项,并把那个样本抄进注释 —— 样本比描述有用。
 */
export const PATTERNS = [
  {
    id: 'line-repeat',
    detect(text) {
      const lines = String(text).split('\n')
      const marks = lines.map(counts)
      const counted = []
      for (let index = 0; index < lines.length; index += 1) {
        if (marks[index]) counted.push(index)
      }
      if (counted.length === 0) return undefined

      const windowStart = counted.length > TAIL_LINES ? counted[counted.length - TAIL_LINES] : counted[0]
      const window = []
      for (let index = windowStart; index < lines.length; index += 1) {
        if (marks[index]) window.push(lines[index].trim())
      }
      if (window.length === 0) return undefined

      const tallies = new Map()
      for (const line of window) tallies.set(line, (tallies.get(line) ?? 0) + 1)
      let line
      let count = 0
      for (const [candidate, seen] of tallies) {
        if (seen > count) {
          line = candidate
          count = seen
        }
      }
      if (count < REPEAT_THRESHOLD || count / window.length < REPEAT_RATIO) return undefined
      return { pattern: 'line-repeat', line, count, total: window.length, ratio: count / window.length, windowStart, lines, marks }
    },
    clean(text, hit) {
      // 从这个循环行在窗口里第一次出现的地方截断。
      let cut = hit.lines.length
      for (let index = hit.windowStart; index < hit.lines.length; index += 1) {
        if (hit.marks[index] && hit.lines[index].trim() === hit.line) {
          cut = index
          break
        }
      }
      // 截断点落在第 0 行就保一段:整块清空会让模型看到一段凭空消失的思考。
      if (cut === 0) cut = Math.max(1, Math.floor(hit.lines.length / 4))
      return hit.lines.slice(0, cut).join('\n')
    },
  },
]

/**
 * 跑一遍所有模式,清掉命中的那段。
 *
 * 同一个输入必须产出同一个结果 —— 清理不稳定的话,每轮请求都会重新废一次前缀缓存。
 * 而且它必须**幂等**:清过的再清一次不再变。
 *
 * @param {string} text 原文。
 * @returns {{ text: string, removedLines: number, pattern: string|undefined }} 清理结果;没命中时原样返回。
 */
export function cleanTail(text) {
  const source = String(text)
  for (const pattern of PATTERNS) {
    const hit = pattern.detect(source)
    if (hit === undefined) continue
    const kept = pattern.clean(source, hit).replace(/\s+$/, '')
    const lines = source.split('\n').length
    const keptLines = kept.length === 0 ? 0 : kept.split('\n').length
    return {
      text: kept.length === 0 ? CLEANED_MARK : `${kept}\n${CLEANED_MARK}`,
      removedLines: lines - keptLines,
      pattern: hit.pattern,
    }
  }
  return { text: source, removedLines: 0, pattern: undefined }
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
