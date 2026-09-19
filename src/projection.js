import { z } from 'zod'

const level = z.enum(['unknown', 'low', 'normal', 'elevated', 'high', 'very-high'])
const value = z.number().min(0).max(100).nullable()
const schema = z.object({ fatigue: level, fatigueValue: value, wakefulness: level, wakefulnessValue: value, sampledSeq: z.number().int().nonnegative() }).nullable()

/**
 * 状态行有中文和英文两种写法，都要认。
 *
 * 中文是现行写法（2026-09-19 起，模型面向的提示一律中文）；英文是那天之前注入的历史事件。
 * 投影要**重放整个会话日志**，两种都会遇到 —— 只认一种的话，旧会话的面板就读不出等级。
 * （这条不是推测：改完语言，client.test.js 里重放事件的那条断言立刻拿到了 null。）
 *
 * 数值本身不进模型文本，只放在消息来源里（见下面 apply 里的 numeric）。
 */
const GRADES = {
  fatigue: {
    '正常': 'normal', '升高': 'elevated', '高': 'high', '非常高': 'very-high', '未知': 'unknown',
    unknown: 'unknown', normal: 'normal', elevated: 'elevated', high: 'high', 'very-high': 'very-high',
  },
  wakefulness: {
    '低': 'low', '正常': 'normal', '升高': 'elevated', '高': 'high', '未知': 'unknown',
    unknown: 'unknown', low: 'low', normal: 'normal', elevated: 'elevated', high: 'high',
  },
}
/** 只认状态行本身：`疲劳：高；唤醒值：正常。` / `Fatigue: high; wakefulness: low.` */
const STATE_LINE = /^<context-care>\n(?:Fatigue|疲劳)[:：]\s*([^;；\s]+)[;；]\s*(?:wakefulness|唤醒值)[:：]\s*([^.;。\s]+)[.。]/

/** Numeric UI samples live in message provenance, outside model-facing text. */
export const contextCareProjection = {
  key: 'contextCareNumeric',
  stateVersion: 1,
  stateSchema: schema,
  init: () => null,
  apply(state, event) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== 'dsh-context-care:state') return state
    const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const match = STATE_LINE.exec(text)
    if (!match) return state
    const fatigue = GRADES.fatigue[match[1]]
    const wakefulness = GRADES.wakefulness[match[2]]
    if (fatigue === undefined || wakefulness === undefined) return state
    // Old events have grades only. Never manufacture a number from a grade.
    const sample = event.data.source.contextCare
    const numeric = input => typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= 100 ? input : null
    return { fatigue, fatigueValue: numeric(sample?.fatigueValue), wakefulness, wakefulnessValue: numeric(sample?.wakefulnessValue), sampledSeq: event.seq }
  },
  wire: { viewSchema: schema, view: state => state },
}