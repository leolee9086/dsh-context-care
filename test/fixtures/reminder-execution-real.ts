import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { threadId } from 'node:worker_threads'
import { z } from 'zod'

/**
 * This module is imported by the production match-worker as a local judge.
 * Its files are observations and synchronization gates; it never replaces the
 * matcher, timers, transport, or runtime. Every entry is a real judge call.
 */
export const JudgeParams = z.object({
  label: z.string().min(1),
  tracePath: z.string().min(1),
  mode: z.enum(['quick', 'gate', 'cpu', 'burn', 'throw', 'uncloneable-error']),
  durationMs: z.number().positive().max(10000).optional(),
  gatePath: z.string().optional(),
  heartbeatPath: z.string().optional(),
  ok: z.boolean(),
  value: z.json(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'gate' && !value.gatePath) ctx.addIssue({ code: 'custom', message: 'gatePath required' })
  if (value.mode === 'cpu' && !value.heartbeatPath) ctx.addIssue({ code: 'custom', message: 'heartbeatPath required' })
  if (value.mode === 'burn' && value.durationMs === undefined) ctx.addIssue({ code: 'custom', message: 'durationMs required' })
})
export type JudgeParamsValue = z.infer<typeof JudgeParams>
const JudgeInput = z.object({
  event: z.object({ callId: z.string(), facts: z.record(z.string(), z.json()) }).catchall(z.json()),
  params: JudgeParams,
}).strict()
export const TraceEntry = z.object({
  phase: z.enum(['start', 'end']), label: z.string(), eventId: z.string(),
  threadId: z.number().int(), at: z.number(), params: JudgeParams,
}).strict()
export type TraceEntryValue = z.infer<typeof TraceEntry>

/** Read actual worker-written records with validation, including unknown JSON. */
export function readTrace(path: string): TraceEntryValue[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  // appendFileSync is used for one complete line; skip only a trailing partial
  // line while another thread is writing, then observe again in waitForTrace.
  return text.split('\n').slice(0, -1).filter(line => line.length > 0)
    .map(line => { const value: unknown = JSON.parse(line); return TraceEntry.parse(value) })
}

/** Poll a physical observation; this is a real-clock timeout, not a fake clock. */
export async function waitForTrace(path: string, predicate: (entry: TraceEntryValue) => boolean,
  timeoutMs = 10000): Promise<TraceEntryValue> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const entry = readTrace(path).find(predicate)
    if (entry) return entry
    await delay(5)
  }
  throw new Error(`real-judge-observation-timeout:${path}`)
}

export interface CpuObservation { checksum: number; iterations: number; elapsedMs: number }

/** Real synchronous arithmetic, also used on the Host to delay its event loop. */
export function burnCpu(durationMs: number): CpuObservation {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('CPU duration must be positive')
  const began = performance.now()
  let checksum = 0x12345678
  let iterations = 0
  do {
    for (let index = 0; index < 4096; index++) checksum = Math.imul(checksum ^ index, 1664525) + 1013904223 | 0
    iterations += 4096
  } while (performance.now() - began < durationMs)
  return { checksum, iterations, elapsedMs: performance.now() - began }
}

type JsonValue = z.infer<ReturnType<typeof z.json>>
interface JudgeResult {
  ok: boolean
  facts: { label: string; value: JsonValue; eventId: string; eventFacts: Record<string, JsonValue> }
}

export async function judge(raw: unknown): Promise<JudgeResult> {
  const { event, params } = JudgeInput.parse(raw)
  const record = (phase: 'start' | 'end') => appendFileSync(params.tracePath, JSON.stringify({
    phase, label: params.label, eventId: event.callId, threadId, at: performance.now(), params,
  }) + '\n')
  record('start')
  if (params.mode === 'throw') throw new Error(`real-judge-failure:${params.label}`)
  if (params.mode === 'uncloneable-error') {
    // JavaScript permits a non-string Error.name even though its TS declaration
    // promises string. This is a real judge exception that Node cannot clone;
    // neither MessagePort nor the worker execution path is replaced by the test.
    const failure = new Error(`real-judge-failure:${params.label}`)
    Object.defineProperty(failure, 'name', { value: () => 'not-cloneable' })
    throw failure
  }
  if (params.mode === 'gate') {
    const gatePath = params.gatePath
    if (gatePath === undefined) throw new Error('gatePath missing after validation')
    const deadline = performance.now() + 10000
    while (!existsSync(gatePath)) {
      if (performance.now() >= deadline) throw new Error('real-judge-gate-timeout')
      await delay(5)
    }
  }
  if (params.mode === 'burn') {
    const durationMs = params.durationMs
    if (durationMs === undefined) throw new Error('durationMs missing after validation')
    const observed = burnCpu(durationMs)
    if (observed.iterations === 0) throw new Error('CPU computation did not execute')
  }
  if (params.mode === 'cpu') {
    const heartbeatPath = params.heartbeatPath
    if (heartbeatPath === undefined) throw new Error('heartbeatPath missing after validation')
    let beats = 0
    let nextBeat = 0
    // Intentionally non-cooperative CPU work. Only terminating the actual
    // Worker can stop it. A settled promise or an idle counter cannot.
    for (;;) {
      const at = performance.now()
      if (at >= nextBeat) {
        writeFileSync(heartbeatPath, String(++beats))
        nextBeat = at + 10
      }
    }
  }
  record('end')
  return { ok: params.ok, facts: { label: params.label, value: params.value,
    eventId: event.callId, eventFacts: event.facts } }
}
