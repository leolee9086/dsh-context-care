import type { AssistantStreamRecord, StreamChunk, TimedStreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { OutputConfig, OutputEvent } from '@leolee9086/dsh-rule-engine'
import { createOutputProjection } from './output-projection.js'
import type { SessionLogRead } from '../session-log.js'

type Terminal = Extract<SessionEvent, { type: 'assistant/message' | 'assistant/attempt' }>

/**
 * Name an attempt by its preceding native step/attempt, not an Agent-lifecycle counter.
 * @param session - Session whose next or committed stream is being observed.
 * @param log - shared native event index for this immutable cut.
 * @param before - exclusive event cursor; a terminal event excludes itself.
 * @returns the same key before streaming and after replaying its committed terminal.
 */
export function nativeOutputAttempt(session: Pick<Session, 'id'>, log: Pick<SessionLogRead, 'length' | 'last'>, before = log.length): string {
  const event = log.last(['step/start', 'assistant/message', 'assistant/attempt'], before)
  if (!event) throw new Error('reminder-native-output-boundary-missing')
  return `session:${session.id}:output:${event.seq + 1}`
}

/** Read the lossless native compact stream lazily, without copying its whole delta corpus. */
function* chunks(stream: readonly AssistantStreamRecord[]): Generator<TimedStreamChunk> {
  for (const record of stream) {
    if (record.type === 'chunk') { yield { time: record.time, chunk: record.chunk }; continue }
    let time = record.time0
    const count = record.type === 'tool-call-chunks' ? record.args.length : record.texts.length
    for (let index = 0; index < count; index++) {
      if (index > 0) time += record.dt[index - 1]!
      let chunk: StreamChunk
      if (record.type === 'tool-call-chunks') chunk = { type: 'tool-call-delta', index: record.index, id: record.id,
        ...(record.name === undefined ? {} : { name: record.name }), argumentsDelta: record.args[index]! }
      else chunk = { type: record.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta',
        index: record.index, text: record.texts[index]! }
      yield { time, chunk }
    }
  }
}

/**
 * Reconstruct readable sample events from a committed native stream, including
 * interrupted messages and failed attempts. No live interruption is performed.
 * @param config - the same limits and flush intervals used by live observation.
 * @param session - native history containing the terminal and its preceding step.
 * @param terminal - actual completed, interrupted or failed assistant settlement.
 * @param report - reports bounded projection failures.
 * @returns ordered output samples with stable identities and recorded clocks.
 */
export function* replayNativeOutput(config: OutputConfig, session: Pick<Session, 'id'>, log: Pick<SessionLogRead, 'length' | 'last'>, terminal: Terminal,
  report: (error: unknown) => void): Generator<OutputEvent> {
  for (const sample of nativeOutputSamples(config, session, log, terminal, report)) yield sample.event
}

/** Distinguish chunk observations from final samples emitted after native settlement. */
export function* nativeOutputSamples(config: OutputConfig, session: Pick<Session, 'id'>, log: Pick<SessionLogRead, 'length' | 'last'>, terminal: Terminal,
  report: (error: unknown) => void): Generator<{ event: OutputEvent; afterCommit: boolean }> {
  const projection = createOutputProjection(config, { sessionId: String(session.id),
    attemptId: nativeOutputAttempt(session, log, terminal.seq), turn: terminal.data.turn, step: terminal.data.step }, report)
  for (const frame of chunks(terminal.data.stream)) {
    for (const event of projection.push(frame.time, frame.chunk)) yield { event, afterCommit: false }
  }
  for (const event of projection.finish(terminal.time)) yield { event, afterCommit: true }
}
