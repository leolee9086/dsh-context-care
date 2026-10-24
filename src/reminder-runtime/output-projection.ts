import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { OutputConfig, OutputEvidence, OutputEvent } from './output-stream.js'

interface Block {
  index: number
  type: 'text' | 'reasoning'
  text: string
  offset: number
  since: number
  dirty: boolean
  revision: number
  hadDelta: boolean
  ended: boolean
}
interface Identity {
  sessionId: string
  attemptId: string
  turn: number
  step: number
}

/**
 * Fold readable chunks using their native timestamps. Timers publish at the
 * recorded deadline even if the Host callback runs late; the next chunk first
 * flushes any earlier deadline. The same fold therefore works without timers.
 * @param config - readable text, block and flush limits.
 * @param identity - stable identity and native step owning this attempt.
 * @param report - reports the first block-capacity failure.
 * @returns incremental chunk, deadline and terminal readers.
 */
export function createOutputProjection(config: OutputConfig, identity: Identity, report: (error: unknown) => void) {
  const blocks = new Map<number, Block>()
  let deadline: number | undefined, stopped = false
  function fullText() {
    let truncated = false
    const parts: string[] = []
    for (const block of [...blocks.values()].sort((left, right) => left.index - right.index)) {
      if (!block.text) continue
      if (block.offset > 0) truncated = true
      parts.push(block.text)
    }
    const joined = parts.join('\n'), dropped = Math.max(0, joined.length - config.maxStreamChars)
    return { text: joined.slice(dropped), truncated: truncated || dropped > 0 }
  }
  function* flush(block: Block, at: number, complete = false): Generator<OutputEvent> {
    if ((!block.dirty && !complete) || !block.text || stopped) return
    block.dirty = false; block.since = 0
    const full = fullText(), phase = complete ? 'complete' : 'prefix'
    const output: OutputEvidence = { attemptId: identity.attemptId, turn: identity.turn, step: identity.step,
      index: block.index, type: block.type, text: block.text, full: full.text, offset: block.offset }
    const textSamples: OutputEvent['textSamples'] = [{ field: 'event.output.text',
      sampleId: `output:${identity.attemptId}:${block.index}`, window: 'current-block', phase, truncated: block.offset > 0 }]
    if (full.text) textSamples.push({ field: 'event.output.full', sampleId: `output:${identity.attemptId}:full`,
      window: 'current-output', phase, truncated: full.truncated })
    yield { type: 'assistant.output', sessionId: identity.sessionId,
      callId: `output:${identity.attemptId}:${block.index}:${++block.revision}`, rootCallId: identity.attemptId,
      clock: { at }, output, textSamples }
  }
  function* advance(at: number): Generator<OutputEvent> {
    if (stopped || deadline === undefined || deadline > at) return
    const due = deadline
    deadline = undefined
    for (const block of blocks.values()) yield* flush(block, due)
  }
  function* append(block: Block, text: string, at: number): Generator<OutputEvent> {
    // Split oversized transport chunks lazily: a consumer can stop immediately
    // when its actual work budget fills, without retaining all sample events.
    const size = Math.min(config.streamEveryChars, config.maxStreamChars)
    for (let start = 0; start < text.length && !stopped; start += size) {
      const piece = text.slice(start, start + size), combined = block.text + piece
      const dropped = Math.max(0, combined.length - config.maxStreamChars)
      block.text = combined.slice(dropped); block.offset += dropped
      block.since += piece.length; block.dirty = true
      if (block.since >= size) yield* flush(block, at)
    }
    deadline ??= at + config.streamFlushMs
  }
  function* push(at: number, chunk: StreamChunk): Generator<OutputEvent> {
    if (stopped) return
    yield* advance(at)
    if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta'
      && chunk.type !== 'block-start' && chunk.type !== 'block-end') return
    const type = chunk.type === 'text-delta' ? 'text' : chunk.type === 'reasoning-delta' ? 'reasoning'
      : chunk.type === 'block-end' ? chunk.block.type : chunk.blockType
    if (type !== 'text' && type !== 'reasoning') return
    let block = blocks.get(chunk.index)
    if (!block) {
      if (blocks.size >= config.maxStreamBlocks) {
        stopped = true; deadline = undefined
        report(new Error(`reminder-stream-block-budget-exceeded: session=${identity.sessionId}, attempt=${identity.attemptId}`))
        return
      }
      block = { index: chunk.index, type, text: '', offset: 0, since: 0, dirty: false, revision: 0, hadDelta: false, ended: false }
      blocks.set(chunk.index, block)
    }
    if (block.type !== type || block.ended) return
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      block.hadDelta = true
      yield* append(block, chunk.text, at)
    } else if (chunk.type === 'block-end') {
      if (!block.hadDelta && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')) yield* append(block, chunk.block.text, at)
      yield* flush(block, at, true)
      block.ended = true
    }
  }
  function* finish(at: number): Generator<OutputEvent> {
    if (stopped) return
    yield* advance(at)
    for (const block of blocks.values()) if (!block.ended) { yield* flush(block, at, true); block.ended = true }
    deadline = undefined
  }
  return {
    push, advance, finish,
    get deadline() { return stopped ? undefined : deadline },
    stop() { stopped = true; deadline = undefined },
  }
}
