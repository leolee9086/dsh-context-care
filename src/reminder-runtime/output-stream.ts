import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { TextSampleValue } from './conditions.js'
import { createOutputProjection } from './output-projection.js'

export interface OutputConfig {
  maxStreamChars: number
  maxStreamBlocks: number
  streamEveryChars: number
  streamFlushMs: number
  maxStreamPending?: number
  maxStreamPendingBytes?: number
}
export interface OutputEvidence {
  attemptId: string
  turn: number
  step: number
  index: number
  type: 'text' | 'reasoning'
  text: string
  /** The attempt's readable text so far, tail-capped like a block; `current-output` counts read this. */
  full: string
  offset: number
}
export interface OutputEvent {
  type: 'assistant.output'
  sessionId: string
  callId: string
  rootCallId: string
  clock: { at: number }
  output: OutputEvidence
  textSamples: TextSampleValue[]
}
/** Native chunk times and the committed terminal event time drive the fold. */
export type OutputFrame = (
  | Pick<Extract<AssistantStreamFrame, { type: 'start' }>, 'type' | 'revision' | 'turn' | 'step'>
  | Pick<Extract<AssistantStreamFrame, { type: 'chunk' }>, 'type' | 'revision' | 'chunk' | 'time'>
  | (Pick<Extract<AssistantStreamFrame, { type: 'end' }>, 'type' | 'revision'> & { time: number })
) & { attemptId: string }
interface OutputEntry<Agent> {
  agent: Agent
  sessionId: string
  liveAttemptId: string
  attemptId: string
  revision: number
  projection: ReturnType<typeof createOutputProjection>
  timer?: ReturnType<typeof setTimeout>
  timerAt?: number
  overflowed: boolean
}
interface StreamOptions<Agent> {
  config: OutputConfig
  submit: (event: OutputEvent) => Promise<void>
  afterSubmit: (agent: Agent, output: OutputEvidence) => Promise<void> | void
  report: (error: unknown) => void
  enabled: (sessionId: string) => boolean
  sessionId: (agent: Agent) => string
  /** The Host derives this key from the native step/preceding-attempt boundary. */
  attemptId?: (agent: Agent) => string
}

/** Bounded live scheduling around the same timestamp fold used by native replay. */
export function createOutputStream<Agent>({ config, submit, afterSubmit, report, enabled, sessionId: identify, attemptId: identifyAttempt }: StreamOptions<Agent>) {
  const active = new Map<string, OutputEntry<Agent>>(), pending = new Set<Promise<void>>()
  let closed = false, pendingBytes = 0
  const maxPending = config.maxStreamPending ?? 32, maxPendingBytes = config.maxStreamPendingBytes ?? 4194304
  function consume(entry: OutputEntry<Agent>, events: Iterable<OutputEvent>) {
    for (const event of events) {
      if (closed || entry.overflowed) return
      const bytes = Buffer.byteLength(JSON.stringify(event))
      if (pending.size >= maxPending || pendingBytes + bytes > maxPendingBytes) {
        entry.overflowed = true
        entry.projection.stop()
        clearTimeout(entry.timer)
        report(new Error(`reminder-stream-pending-budget-exceeded: session=${entry.sessionId}, attempt=${entry.attemptId}`))
        return
      }
      pendingBytes += bytes
      const task = submit(event).then(() => {
        if (active.get(entry.sessionId) === entry) return afterSubmit(entry.agent, event.output)
      }).catch(report).finally(() => { pending.delete(task); pendingBytes -= bytes })
      pending.add(task)
    }
  }
  function schedule(entry: OutputEntry<Agent>) {
    const at = entry.projection.deadline
    if (at === entry.timerAt) return
    clearTimeout(entry.timer)
    entry.timer = undefined; entry.timerAt = at
    if (at === undefined || entry.overflowed) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined; entry.timerAt = undefined
      consume(entry, entry.projection.advance(at))
      schedule(entry)
    }, Math.max(0, at - Date.now()))
  }
  function observe(agent: Agent, frame: OutputFrame) {
    if (closed) return
    const sessionId = identify(agent)
    if (frame.type === 'start') {
      const old = active.get(sessionId)
      if (old) clearTimeout(old.timer)
      active.delete(sessionId)
      if (!enabled(sessionId)) return
      const attemptId = identifyAttempt?.(agent) ?? frame.attemptId
      active.set(sessionId, { agent, sessionId, liveAttemptId: frame.attemptId, attemptId, revision: frame.revision,
        projection: createOutputProjection(config, { sessionId, attemptId, turn: frame.turn, step: frame.step }, report), overflowed: false })
      return
    }
    const entry = active.get(sessionId)
    if (!entry || entry.liveAttemptId !== frame.attemptId || frame.revision <= entry.revision) return
    entry.revision = frame.revision
    if (frame.type === 'end') {
      clearTimeout(entry.timer)
      consume(entry, entry.projection.finish(frame.time))
      active.delete(sessionId)
    } else {
      consume(entry, entry.projection.push(frame.time, frame.chunk))
      schedule(entry)
    }
  }
  return {
    observe,
    /** No committed stream exists for abandonment; it cannot supply complete evidence. */
    abandon(agent: Agent, frame: { attemptId: string; revision: number }) {
      const entry = active.get(identify(agent))
      if (!entry || entry.liveAttemptId !== frame.attemptId || frame.revision <= entry.revision) return
      clearTimeout(entry.timer)
      active.delete(entry.sessionId)
    },
    isCurrent(agent: Agent, output: OutputEvidence) { return active.get(identify(agent))?.attemptId === output.attemptId },
    async close() {
      closed = true
      for (const entry of active.values()) clearTimeout(entry.timer)
      active.clear()
      await Promise.allSettled([...pending])
    },
  }
}
