import { z } from 'zod'
import { parseReminderCondition, CountLimits, matchReminderCondition, type ReminderMatch, type TextSampleValue } from './conditions.js'
import { Event, Detector, errorMessage } from './state.js'
import type { ExecutionCheckpoint } from '../matcher/progress.js'
import { serializeWorkerError } from '../matcher/worker-error.js'

// Reuse the validator, not parsed values: every event/result still gets the
// same JSON validation, without constructing a recursive schema per rule.
const Json = z.json()
const Input = z.object({ condition: z.unknown(), event: Event, maxBytes: z.number().int().positive(),
  countLimits: CountLimits, judge: Detector.optional(), params: z.json().optional() }).strict()
const Judged = z.object({ ok: z.boolean(), facts: z.record(z.string(), z.json()).optional() }).catchall(z.json())
const moduleRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
type Matched = ReminderMatch & { facts?: Record<string, unknown> }
const Failure = z.object({ name: z.string(), message: z.string() }).strict()
const Batch = z.object({
  event: Event, maxBytes: z.number().int().positive(), countLimits: CountLimits,
  /** Remaining evaluation time, excluding startup, queues and Host storage. */
  budgetMs: z.number().nonnegative().optional(),
  blockedGroups: z.array(z.string()).optional(),
  rules: z.array(z.object({ key: z.string().min(1), condition: z.unknown(), judge: Detector.optional(), params: z.json().optional(),
    timeoutMs: z.number().nonnegative().optional(), exclusiveGroup: z.string().optional(), error: Failure.optional() }).strict()).max(2048),
}).strict()
export type BatchItem = { key: string; ms: number; match: Matched } | { key: string; ms: number; error: { name: string; message: string } }
export interface BatchResult { items: BatchItem[]; stopped: boolean; elapsedMs: number }
const snapshotOf = (event: z.infer<typeof Event>) => Json.parse({ event, tool: event, facts: event.facts, context: event.context ?? {} })

export async function executeReminderMatch(raw: unknown) {
  const input = Input.parse(raw)
  return bounded(await matchOf(input.event, input.condition, snapshotOf(input.event), input.countLimits, input.judge, input.params), input.maxBytes)
}

/**
 * Preserve the original ordered evaluation, including judge params and exclusive
 * groups, while sharing one event snapshot. A checkpoint surrounds each rule;
 * a stopped worker never implies that its unstarted neighbours timed out.
 */
export async function executeReminderBatch(raw: unknown, onItem?: (item: BatchItem) => void,
  checkpoint?: ExecutionCheckpoint, defaultTimeoutMs = Number.POSITIVE_INFINITY): Promise<BatchResult> {
  const input = Batch.parse(raw)
  const snapshot = snapshotOf(input.event)
  const blocked = new Set(input.blockedGroups)
  const items: BatchItem[] = []
  let elapsedMs = 0, stopped = false
  for (const [index, rule] of input.rules.entries()) {
    if (rule.exclusiveGroup && blocked.has(rule.exclusiveGroup)) continue
    const remaining = (input.budgetMs ?? Number.POSITIVE_INFINITY) - elapsedMs
    if (remaining <= 0) { stopped = true; break }
    const allowance = rule.timeoutMs ?? defaultTimeoutMs
    const limit = Math.min(allowance, remaining)
    const roundLimited = remaining < allowance
    const began = process.hrtime.bigint()
    checkpoint?.start(index, limit, roundLimited)
    let answer: { match: Matched } | { error: { name: string; message: string } }
    try {
      if (rule.error) answer = { error: rule.error }
      else answer = { match: bounded(await matchOf(input.event, rule.condition, snapshot, input.countLimits, rule.judge, rule.params), input.maxBytes) }
    } catch (error: unknown) { answer = { error: serializeWorkerError(error, errorMessage) } }
    const ms = checkpoint?.finish(index) ?? Number(process.hrtime.bigint() - began) / 1e6
    elapsedMs += ms
    if (ms > limit) answer = { error: { name: 'Error', message: roundLimited ? 'reminder-round-timeout' : 'matcher-work-timeout' } }
    if (rule.exclusiveGroup && ('error' in answer || answer.match.ok || answer.match.status === 'unavailable')) blocked.add(rule.exclusiveGroup)
    const item: BatchItem = { key: rule.key, ms, ...answer }
    items.push(item)
    onItem?.(item)
  }
  return { items, stopped, elapsedMs }
}

async function matchOf(event: z.infer<typeof Event>, raw: unknown, snapshot: z.infer<typeof Json>,
  limits: z.infer<typeof CountLimits>, judge?: z.infer<typeof Detector>, params?: unknown): Promise<Matched> {
  // Validate cloned data and clamp its ceilings before it can select a judge.
  const matched = matchReminderCondition(parseReminderCondition(raw, limits), snapshot, event.textSamples ?? [])
  if (matched.status !== 'matched' || judge === undefined) return matched
  const loaded: unknown = await import(judge.module)
  if (!moduleRecord(loaded)) throw new Error('reminder-judge-export-missing')
  const evaluate = loaded[judge.exportName]
  if (typeof evaluate !== 'function') throw new Error('reminder-judge-export-missing')
  const result = Judged.parse(await evaluate({ event, params }))
  return { ...matched, ok: result.ok, status: result.ok ? 'matched' : 'unmatched', facts: result.facts ?? {} }
}

function bounded<T extends ReminderMatch>(value: T & { facts?: Record<string, unknown> }, maxBytes: number): T & { facts?: Record<string, unknown> } {
  const text = JSON.stringify(value)
  if (text === undefined) throw new Error('reminder-result-not-json')
  if (Buffer.byteLength(text) > maxBytes) throw new Error('reminder-result-budget-exceeded')
  Json.parse(value)
  return value
}
export type { ReminderMatch, TextSampleValue }
