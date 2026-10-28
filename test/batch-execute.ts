import type { EventWork as Work } from '@leolee9086/dsh-rule-engine'
import { performance } from 'node:perf_hooks'


/** 只认单条 `reminder` 的判定函数，就是几乎所有测试原来写的那个形状。 */
export type SingleExecutor = (input: Work, signal?: AbortSignal, timing?: unknown) => Promise<unknown>
/** 批量工作里的单条规则，字段直接取自真实端口类型，避免替身自己造一套。 */
type ReminderWork = Extract<Work, { reminder: unknown }>['reminder']
export interface BatchRule { key: string; condition: ReminderWork['condition']
  judge?: ReminderWork['judge']; params?: ReminderWork['params'] }
interface BatchWork { event: ReminderWork['event']; maxBytes: number; countLimits: ReminderWork['countLimits']; rules: BatchRule[] }

/**
 * 测试替身：把「按单条规则判定」的函数包装成执行端口。
 *
 * 这是替身，不是适配层。需要控制「这条规则判出什么」的测试用它，
 * 这样能直接构造命中、不命中、返回非法结果、抛错这些情形。
 *
 * 真正的执行端口（matcher.detect + worker 线程池）不由这里覆盖：
 * 批量的一次投递、逐条上报、线程卡死后未结算规则的补投，
 * 都由 test/reminder-runtime.test.js 里跑真 matcher 的用例负责验证。
 */
export function asBatch(execute: SingleExecutor) {
  return async (input: Work, signal?: AbortSignal, timing?: unknown): Promise<unknown> => {
    if (!('reminderBatch' in input)) return execute(input, signal, timing)
    const batch = (input as { reminderBatch: BatchWork }).reminderBatch
    const items: unknown[] = []
    for (const rule of batch.rules) {
      const began = performance.now()
      try {
        const match = await execute({ reminder: { condition: rule.condition, event: batch.event,
          maxBytes: batch.maxBytes, countLimits: batch.countLimits,
          ...(rule.judge === undefined ? {} : { judge: rule.judge, params: rule.params }) } }, signal, timing)
        items.push({ key: rule.key, ms: performance.now() - began, match })
      } catch (error) {
        items.push({ key: rule.key, ms: performance.now() - began,
          error: { name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error) } })
      }
    }
    return { items, stopped: false, elapsedMs: 0 }
  }
}
