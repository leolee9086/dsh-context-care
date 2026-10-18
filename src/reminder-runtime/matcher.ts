import { z } from 'zod'
import { compileReminderCondition, matchReminderCondition, CountLimits, type ReminderMatch } from './conditions.js'
import { Event, Detector } from './state.js'

const Input = z.object({ condition: z.unknown(), event: Event, maxBytes: z.number().int().positive(),
  countLimits: CountLimits, judge: Detector.optional(), params: z.json().optional() }).strict()
const Judged = z.object({ ok: z.boolean(), facts: z.record(z.string(), z.json()).optional() }).catchall(z.json())
const moduleRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'

/** Worker entry for reminder JSON. Native regex and plugin judges share the worker's cancellation budget. */
export async function executeReminderMatch(raw: unknown) {
  const input = Input.parse(raw)
  const { event, judge } = input
  const condition = compileReminderCondition(input.condition, input.countLimits)
  const snapshot = z.json().parse({ event, tool: event, facts: event.facts, context: event.context ?? {} })
  const matched = matchReminderCondition(condition, snapshot, event.textSamples ?? [])
  if (matched.status === 'matched' && judge) {
    // The registration owns this module URL; rules only name a registered judge.
    const loaded: unknown = await import(judge.module)
    if (!moduleRecord(loaded)) throw new Error('reminder-judge-export-missing')
    const evaluate = loaded[judge.exportName]
    if (typeof evaluate !== 'function') throw new Error('reminder-judge-export-missing')
    const judged: unknown = await evaluate({ event, params: input.params })
    const result = Judged.parse(judged)
    matched.ok = result.ok
    matched.status = result.ok ? 'matched' : 'unmatched'
    return bounded({ ...matched, facts: result.facts ?? {} }, input.maxBytes)
  }
  return bounded(matched, input.maxBytes)
}

function bounded<T extends ReminderMatch>(value: T, maxBytes: number): T {
  z.json().parse(value)
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new Error('reminder-result-budget-exceeded')
  return value
}
