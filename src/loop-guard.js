/**
 * 输出循环检测 —— 认出模型"卡带"式的退化输出，提醒它落盘并压缩。
 *
 * 什么算循环：助手某条回复的末尾一大段里，同一行反复出现几十次。
 * 实测样本（DeepSeek V4 Flash 失控时）长这样：
 *
 *     （输出。）
 *     **做。**
 *     go.
 *     （输出。）
 *     **做。**
 *     go.
 *     …重复上百行
 *
 * 判据只看**末尾窗口内同一行的重复次数与占比**，不看具体内容 ——
 * 换一组词同样能认出来，也就不必维护什么关键词表。
 *
 * 只做检测与措辞，不碰会话：注入由调用方（index.js 的请求边界）负责。
 */

/** 只看回复末尾这么多行 —— 循环总是拖在尾巴上。 */
const WINDOW_LINES = 80
/** 行数太少就不判：样本不足时任何比例都不可信。 */
const MIN_LINES = 30
/** 太短的行不参与统计（代码里的 `}`、空行之类天然会重复）。 */
const MIN_LINE_LEN = 3
/** 同一行在窗口里出现这么多次才算循环。 */
const REPEAT_THRESHOLD = 15
/** 同时还要占够窗口的比例，避免把"正常但啰嗦"的输出也判成循环。 */
const REPEAT_RATIO = 0.2

/**
 * 取会话里最近一条助手回复的全部文本（思考块 + 正文块）。
 *
 * 会话里 assistant/message 的 data.message.content 是块数组，
 * reasoning 与 text 两种块才有 text 字段；这里把它们按顺序拼起来，
 * 因为循环可能出现在任何一类块里。
 *
 * @param {object} session 当前会话
 * @returns {string|undefined} 最近的助手文本；没有助手消息时返回 undefined
 */
function latestAssistantText(session) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes)) return undefined
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(nodes[index])
    if (event?.type !== 'assistant/message') continue
    const content = event.data?.message?.content
    if (!Array.isArray(content)) return undefined
    const parts = []
    for (const block of content) {
      if (typeof block?.text === 'string' && (block.type === 'reasoning' || block.type === 'text')) {
        parts.push(block.text)
      }
    }
    return parts.join('\n')
  }
  return undefined
}

/**
 * 检查最近的助手回复是不是退化成循环了。
 *
 * @param {object} session 当前会话
 * @returns {{ line: string, count: number, total: number, ratio: number }|undefined}
 *   命中时返回那行内容与统计；没命中返回 undefined
 */
export function detectLoop(session) {
  const text = latestAssistantText(session)
  if (text === undefined) return undefined

  const lines = text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_LINE_LEN)
  if (lines.length < MIN_LINES) return undefined

  const tail = lines.slice(-WINDOW_LINES)
  const counts = new Map()
  for (const line of tail) counts.set(line, (counts.get(line) ?? 0) + 1)

  let worstLine = ''
  let worstCount = 0
  for (const [line, count] of counts) {
    if (count > worstCount) {
      worstLine = line
      worstCount = count
    }
  }

  const ratio = worstCount / tail.length
  if (worstCount < REPEAT_THRESHOLD || ratio < REPEAT_RATIO) return undefined
  return { line: worstLine, count: worstCount, total: tail.length, ratio }
}

/**
 * 判断刚刚是不是已经提醒过一次了 —— 连着注入两条一样的提醒只会刷屏，
 * 而模型真卡住时靠的是压缩，不是多喊几遍。
 *
 * @param {object} session 当前会话
 * @param {string} plugin 提醒消息的 source.plugin
 * @returns {boolean} 最近一条消息已经是本插件发的提醒时为 true
 */
export function alreadyWarned(session, plugin) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes)) return false
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(nodes[index])
    if (event?.type !== 'user/message') continue
    // 只看最后一条 user 消息：中间隔着别的消息就说明情况变了，该重新提醒。
    return event.data?.source?.kind === 'plugin' && event.data?.source?.plugin === plugin
  }
  return false
}

/**
 * 把命中结果写成给模型看的一段话。
 *
 * 措辞要点：明确说这是**模型侧的退化、不是任务的错**，并给出两步可执行动作
 * （先落盘、再压缩）；顺序不能反 —— 压缩会带走细节，笔记必须先写。
 *
 * @param {{ line: string, count: number, total: number, ratio: number }} hit 检测结果
 * @param {boolean} aborted 这次是不是已经在流式阶段中止了本轮响应 —— 是的话要说清楚
 *   「不是你自己停的」，否则模型会以为自己正常收尾了
 * @returns {string} 提醒正文
 */
export function loopNoticeText(hit, aborted = false) {
  const percent = Math.round(hit.ratio * 100)
  const shown = hit.line.length > 40 ? `${hit.line.slice(0, 40)}…` : hit.line
  return [
    '<context-care>',
    `检测到输出循环：最近一条回复里「${shown}」重复了 ${hit.count} 次，`
      + `占末尾 ${hit.total} 行的 ${percent}%。`,
    ...(aborted
      ? ['', '**本轮响应已经在生成过程中被中止**（不是你自己停下来的），以免继续刷屏。']
      : []),
    '',
    '请先做这两件事，然后再继续任务（顺序不能反）：',
    '',
    '1. 【最重要】**把当前进度落盘到笔记文件，而且要写得非常详细。**',
    '   压缩会把原始细节一起带走，笔记是之后唯一的依据 —— 写少了就等于丢掉这段工作。',
    '   必须写全的：',
    '   · 目标与背景：在做什么、为什么做、给谁用；',
    '   · 已完成：具体改变了哪些文件（写全路径），跑过什么命令（原样抄，含参数），',
    '     得到什么结果（数字、文件名、URL 都写上）；',
    '   · 待办与下一步：还没做的、卡住的、下次该从哪儿接着干；',
    '   · 踩过的坑与原因：什么现象、根因是什么、怎么绕开的；',
    '   · 关键路径：笔记文件自己、工作目录、脚本、配置、凭据的名字（不写值）。',
    '   宁可写多不要写少；能抄的原文一律抄进去，别转述成摘要。',
    '',
    '2. 落盘完成之后，再调用 context_rest 压缩历史，把这段循环清掉。',
    '',
    '循环是模型侧的退化（DeepSeek V4 Flash 上反复出现过），不是任务的错，'
      + '压缩之后一般就能恢复正常。',
    '</context-care>',
  ].join('\n')
}
