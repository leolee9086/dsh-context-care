import type { ToolOutputDefinition } from '@deepseek-ai/dsh-tools'
import { SnoozeResult, createSnoozeResult, snoozeResultSchema } from '@leolee9086/dsh-rule-engine'
import type { SnoozeWindowValue, SnoozeResultValue } from '@leolee9086/dsh-rule-engine'

export const SNOOZE_TOOL = 'reminder_snooze'
/** Tool presentation is native; the retained domain fact comes from the engine. */
export function snoozeResult(sessionId: string, windows: SnoozeWindowValue[]): SnoozeResultValue {
  return createSnoozeResult(sessionId, windows, windows.length
    ? '已暂停 ' + windows.length + ' 条当前窗口提醒，窗口结束后自动恢复。' : '当前没有可暂停的时间窗口提醒。')
}
export const snoozeOutput: ToolOutputDefinition = {
  schema: snoozeResultSchema,
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(SnoozeResult.parse(value)) }],
  presentationMeta: (_args, value) => SnoozeResult.parse(value),
}
