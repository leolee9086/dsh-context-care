import { appendFileSync } from 'node:fs'
import { threadId } from 'node:worker_threads'
import { z } from 'zod'

const Input = z.object({
  event: z.object({ type: z.literal('assistant.output'), callId: z.string(), rootCallId: z.string(),
    clock: z.object({ at: z.number() }), output: z.object({ attemptId: z.string(), turn: z.number(), step: z.number(),
      index: z.number(), type: z.enum(['text', 'reasoning']), text: z.string(), full: z.string(), offset: z.number() }),
    native: z.object({ type: z.literal('assistant-output'), seq: z.number() }).optional() }),
  params: z.object({ tracePath: z.string(), label: z.string() }),
})
export const NativeOutputObservation = z.object({ threadId: z.number().int().positive(), label: z.string(), event: Input.shape.event })

/** Record actual Worker input so native recovery can verify both evidence and judge counts. */
export function judge(input: unknown) {
  const value = Input.parse(input)
  appendFileSync(value.params.tracePath, JSON.stringify({ threadId, label: value.params.label, event: value.event }) + '\n')
  return { ok: true }
}
