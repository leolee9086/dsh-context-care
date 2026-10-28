import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { createOutputStream as createStream } from '@leolee9086/dsh-rule-engine'

export type OutputFrame = (
  | Pick<Extract<AssistantStreamFrame, { type: 'start' }>, 'type' | 'revision' | 'turn' | 'step'>
  | Pick<Extract<AssistantStreamFrame, { type: 'chunk' }>, 'type' | 'revision' | 'chunk' | 'time'>
  | (Pick<Extract<AssistantStreamFrame, { type: 'end' }>, 'type' | 'revision'> & { time: number })
) & { attemptId: string }
/** Native protocol mapping only; the library owns stream limits, clocks and work. */
export function createOutputStream<Agent>(options: Parameters<typeof createStream<Agent>>[0]) {
  const stream = createStream(options)
  return { ...stream, observe(agent: Agent, frame: OutputFrame) {
    if (frame.type !== 'chunk') return stream.observe(agent, frame)
    const { chunk } = frame
    stream.observe(agent, { ...frame, chunk: chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
      || chunk.type === 'block-start' || chunk.type === 'block-end' ? chunk : null })
  } }
}
