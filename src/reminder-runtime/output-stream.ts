import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'

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
  offset: number
}
export interface OutputEvent {
  type: 'assistant.output'
  sessionId: string
  callId: string
  rootCallId: string
  clock: { at: number }
  output: OutputEvidence
}
// The observer only consumes these frame fields. The actual chunk union comes
// from DSH; attempt IDs remain plain identities inside this domain algorithm.
export type OutputFrame = (
  | Pick<Extract<AssistantStreamFrame, { type: 'start' }>, 'type' | 'revision' | 'turn' | 'step'>
  | Pick<Extract<AssistantStreamFrame, { type: 'chunk' }>, 'type' | 'revision' | 'chunk'>
  | Pick<Extract<AssistantStreamFrame, { type: 'end' }>, 'type' | 'revision'>
) & { attemptId: string }
interface OutputBlock {
  index: number
  type: 'text' | 'reasoning'
  text: string
  offset: number
  since: number
  dirty: boolean
  revision: number
  hadDelta: boolean
  ended?: boolean
}
interface OutputEntry<Agent> {
  agent: Agent
  sessionId: string
  attemptId: string
  revision: number
  turn: number
  step: number
  blocks: Map<number, OutputBlock>
  timer?: ReturnType<typeof setTimeout>
  overflowed?: boolean
}
interface StreamOptions<Agent> {
  config: OutputConfig
  submit: (event: OutputEvent) => Promise<void>
  afterSubmit: (agent: Agent, output: OutputEvidence) => Promise<void> | void
  report: (error: unknown) => void
  enabled: (sessionId: string) => boolean
  sessionId: (agent: Agent) => string
}

/** Bounded per-attempt, per-block windows. Only readable text/reasoning enter matching. */
export function createOutputStream<Agent>({ config, submit, afterSubmit, report, enabled, sessionId: identify }: StreamOptions<Agent>) {
  const active = new Map<string, OutputEntry<Agent>>(), pending = new Set<Promise<void>>()
  let closed = false, pendingBytes = 0
  const maxPending = config.maxStreamPending ?? 32
  const maxPendingBytes = config.maxStreamPendingBytes ?? 4194304
  function overflow(entry: OutputEntry<Agent>, reason: string) {
    if (entry.overflowed) return
    entry.overflowed = true
    clearTimeout(entry.timer)
    // Observation is best effort after this explicit diagnostic; never abort ordinary output.
    report(new Error(`${reason}: session=${entry.sessionId}, attempt=${entry.attemptId}`))
  }
  function flush(entry: OutputEntry<Agent>, block: OutputBlock) {
    if (!block.dirty || closed || entry.overflowed) return
    block.dirty = false; block.since = 0
    const output: OutputEvidence = { attemptId: entry.attemptId, turn: entry.turn, step: entry.step,
      index: block.index, type: block.type, text: block.text, offset: block.offset }
    const callId = `output:${entry.attemptId}:${block.index}:${++block.revision}`
    const event: OutputEvent = { type: 'assistant.output', sessionId: entry.sessionId, callId, rootCallId: entry.attemptId,
      clock: { at: Date.now() }, output }
    const bytes = Buffer.byteLength(JSON.stringify(event))
    if (pending.size >= maxPending || pendingBytes + bytes > maxPendingBytes) {
      overflow(entry, 'reminder-stream-pending-budget-exceeded'); return
    }
    pendingBytes += bytes
    const task = submit(event).then(() => {
      if (active.get(entry.sessionId) === entry) return afterSubmit(entry.agent, output)
    }).catch(report).finally(() => { pending.delete(task); pendingBytes -= bytes })
    pending.add(task)
  }
  function schedule(entry: OutputEntry<Agent>) {
    if (entry.timer !== undefined || entry.overflowed) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      for (const block of entry.blocks.values()) flush(entry, block)
    }, config.streamFlushMs)
  }
  function append(entry: OutputEntry<Agent>, block: OutputBlock, text: string) {
    // Split large transport chunks so an early match cannot disappear before its first evaluation.
    const size = Math.min(config.streamEveryChars, config.maxStreamChars)
    for (let start = 0; start < text.length && !entry.overflowed; start += size) {
      const piece = text.slice(start, start + size)
      const combined = block.text + piece
      const dropped = Math.max(0, combined.length - config.maxStreamChars)
      block.text = combined.slice(dropped); block.offset += dropped
      block.since += piece.length; block.dirty = true
      if (block.since >= size) flush(entry, block)
    }
    schedule(entry)
  }
  function observe(agent: Agent, frame: OutputFrame) {
    if (closed) return
    const sessionId = identify(agent)
    if (frame.type === 'start') {
      const old = active.get(sessionId)
      if (old) clearTimeout(old.timer)
      active.delete(sessionId)
      if (!enabled(sessionId)) return
      active.set(sessionId, { agent, sessionId, attemptId: frame.attemptId, revision: frame.revision,
        turn: frame.turn, step: frame.step, blocks: new Map() })
      return
    }
    const entry = active.get(sessionId)
    if (!entry || entry.attemptId !== frame.attemptId || frame.revision <= entry.revision) return
    // Host revision belongs to the frame, not the attempt: it increases on every publication.
    entry.revision = frame.revision
    if (frame.type === 'end') {
      clearTimeout(entry.timer)
      for (const block of entry.blocks.values()) flush(entry, block)
      active.delete(sessionId)
      return
    }
    if (entry.overflowed) return
    const chunk = frame.chunk
    if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta'
      && chunk.type !== 'block-start' && chunk.type !== 'block-end') return
    const type = chunk.type === 'text-delta' ? 'text' : chunk.type === 'reasoning-delta' ? 'reasoning'
      : chunk.type === 'block-end' ? chunk.block.type : chunk.blockType
    if (type !== 'text' && type !== 'reasoning') return
    let block = entry.blocks.get(chunk.index)
    if (!block) {
      if (entry.blocks.size >= config.maxStreamBlocks) {
        overflow(entry, 'reminder-stream-block-budget-exceeded'); return
      }
      block = { index: chunk.index, type, text: '', offset: 0, since: 0, dirty: false, revision: 0, hadDelta: false }
      entry.blocks.set(chunk.index, block)
    }
    if (block.type !== type || block.ended) return
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      if (typeof chunk.text === 'string') { block.hadDelta = true; append(entry, block, chunk.text) }
    } else if (chunk.type === 'block-end') {
      // Some adapters only emit a completed block; do not append it over already-seen deltas.
      if (!block.hadDelta && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')
        && typeof chunk.block.text === 'string') append(entry, block, chunk.block.text)
      flush(entry, block); block.ended = true
    }
  }
  return {
    observe,
    isCurrent(agent: Agent, output: OutputEvidence) { return active.get(identify(agent))?.attemptId === output.attemptId },
    async close() {
      closed = true
      for (const entry of active.values()) clearTimeout(entry.timer)
      active.clear()
      await Promise.allSettled([...pending])
    },
  }
}
