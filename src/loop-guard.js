/**
 * 输出循环检测 —— 认出模型"卡带"式的退化输出，提醒它落盘并压缩。
 *
 * 判定表在 loop-patterns.js（与请求层的清理共用同一份）：这里只管三件事 ——
 * 从会话里取最近一条助手输出、决定要不要提醒、把提醒写成给模型看的话。
 *
 * **要不要提醒由严重度和清理执行者共同决定**（见 loop-patterns.js 开头）：
 * 轻微档一律提醒；严重档本来交给请求层硬清理、不必再提醒，但清理要有执行者
 * （fetch-router 的 `requestRewrite` 服务），执行者不在时严重档也清不掉 —— 那就得提醒。
 * 判据是 {@link loopNeedsReminder}，它只看这两个输入，不自己去找服务。
 *
 * **提醒只在 agent 层**（由 index.js 的请求边界注入）：请求层的清理只是"这一次不把它发出去"，
 * 模型看不见，所以清理不能替代提醒；要让模型自己改掉这个腔调，只有这条提醒能办到。
 *
 * 实测样本（DeepSeek V4 Flash 失控时）：
 *
 *     （输出。）
 *     **做。**
 *     go.
 *     （输出。）
 *     **做。**
 *     go.
 *     …重复上百行
 *
 * 以及 2026-09-25 的弱循环（隔着空行的短句轮转，单行永远到不了门槛）：
 *
 *     好。
 *
 *     做。
 *
 *     输出。
 *     …
 *
 * 只做检测与措辞，不碰会话：注入由调用方负责。
 */

import { producedBy } from './producer-source.js'
import { describeHit, detectDegradation } from './loop-patterns.js'

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
 * 这是**纯判定**：命中什么就返回什么，不替调用方决定提不提醒 ——
 * 提醒与否还取决于清理执行者在不在，见 {@link loopNeedsReminder}。
 *
 * @param {object} session 当前会话
 * @returns {object|undefined} 命中信息（形状见 loop-patterns.js）；没命中返回 undefined
 */
export function detectLoop(session) {
  const text = latestAssistantText(session)
  if (text === undefined) return undefined
  return detectDegradation(text)
}

/**
 * 这一轮的退化要不要提醒模型。
 *
 * 语义（2026-09-25 哥哥定）：
 *   · 轻微档 —— 提醒。这类内容还带信息，不该被清掉，让模型自己看见、自己改腔调。
 *   · 严重档 —— 交给请求层硬清理，**清了就不再提醒**：否则模型被叫去找一段
 *     已经不存在的文本（房间里的大象）。但清理挂在 fetch-router 提供的
 *     `requestRewrite` 服务上，服务不在就没有执行者 —— 那时严重档也清不掉，
 *     所以必须提醒，不能既不清也不说。
 *
 * @param {object|undefined} hit `detectLoop` 的结果。
 * @param {boolean} cleanupActive 请求层清理的执行者在不在（index.js 由 `ctx.inject(['requestRewrite'])` 维护）。
 * @returns {boolean} 该不该注入提醒。
 */
export function loopNeedsReminder(hit, cleanupActive) {
  if (hit === undefined) return false
  if (hit.severity === 'mild') return true
  return cleanupActive !== true
}

/**
 * 判断刚刚是不是已经提醒过一次了 —— 连着注入两条一样的提醒只会刷屏，
 * 而模型真卡住时靠的是压缩，不是多喊几遍。
 *
 * @param {object} session 当前会话
 * @param {string} plugin 提醒消息的生产者名
 * @returns {boolean} 最近一条 user 消息已经是本插件发的提醒时为 true
 */
export function alreadyWarned(session, plugin) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes)) return false
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(nodes[index])
    if (event?.type !== 'user/message') continue
    // 只看最后一条 user 消息：中间隔着别的消息就说明情况变了，该重新提醒。
    return producedBy(event.data?.source, plugin)
  }
  return false
}

/**
 * 把命中结果写成给模型看的一段话。
 *
 * 措辞要点：明确说这是**模型侧的退化、不是任务的错**，并给出两步可执行动作
 * （先落盘、再压缩）；顺序不能反 —— 压缩会带走细节，笔记必须先写。
 * 具体命中了哪一种形状由 loop-patterns.js 的 describeHit 负责，
 * 这里不重复判断模式，免得两处措辞各自漂移。
 *
 * @param {object} hit 命中信息
 * @param {boolean} aborted 这次是不是已经在流式阶段中止了本轮响应 —— 是的话要说清楚
 *   「不是你自己停的」，否则模型会以为自己正常收尾了
 * @returns {string} 提醒正文
 */
export function loopNoticeText(hit, aborted = false) {
  return [
    '<context-care>',
    `检测到输出循环：${describeHit(hit)}。`,
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
