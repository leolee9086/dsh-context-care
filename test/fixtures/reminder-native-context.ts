import { appendFileSync } from 'node:fs'
import { threadId } from 'node:worker_threads'
import { z } from 'zod'

const Input = z.object({
  event: z.object({ callId: z.string(), rootCallId: z.string(), name: z.string(),
    arguments: z.object({ file_path: z.string() }), clock: z.object({ at: z.number() }),
    context: z.object({ messages: z.array(z.object({ text: z.string() })) }),
  }).passthrough(),
  params: z.object({ tracePath: z.string() }),
})
export const NativeObservation = z.object({ threadId: z.number().int(), event: Input.shape.event })
const BeforeInput = z.object({ params: z.object({ tracePath: z.string() }), event: z.object({
  type: z.literal('tool.before-execute'), callId: z.literal('native-prefix-call'), rootCallId: z.literal('native-prefix-call'),
  name: z.literal('native_prefix_probe'), arguments: z.object({ file_path: z.literal('original.ts') }),
  clock: z.object({ at: z.number() }), native: z.object({ type: z.literal('tool-call'), seq: z.number() }),
}).passthrough() })
export const NativeBeforeObservation = z.object({ threadId: z.number().int(), event: BeforeInput.shape.event })

/** Before-execution replay is input to a real judge, never a second tool dispatch. */
export function judgeBefore(raw: unknown) {
  const { event, params } = BeforeInput.parse(raw)
  appendFileSync(params.tracePath, JSON.stringify({ threadId, event }) + '\n')
  return { ok: true }
}
const NativeSessionInput = z.object({ params: z.object({ tracePath: z.string() }),
  event: z.object({ type: z.literal('session.event'), name: z.literal('tool/result'), callId: z.string(), rootCallId: z.string(),
    origin: z.literal('tool'), clock: z.object({ at: z.number() }), native: z.object({ type: z.literal('session-event'), seq: z.number() }),
    arguments: z.object({ message: z.object({ toolCallId: z.literal('native-prefix-call') }).passthrough() }).passthrough(),
  }).passthrough() })
export const NativeSessionObservation = z.object({ threadId: z.number().int(), event: NativeSessionInput.shape.event })

/** The actual Worker must see the original event payload and its own native identity. */
export function judgeSessionEvent(raw: unknown) {
  const { event, params } = NativeSessionInput.parse(raw)
  appendFileSync(params.tracePath, JSON.stringify({ threadId, event }) + '\n')
  return { ok: true }
}

const AliasInput = z.object({ params: z.object({ tracePath: z.string() }),
  event: z.object({ type: z.literal('session.event'), name: z.string(), callId: z.string(), rootCallId: z.string(),
    origin: z.enum(['human', 'tool', 'background', 'reminder']), clock: z.object({ at: z.number() }),
    native: z.object({ type: z.literal('session-event'), seq: z.number() }), arguments: z.json(),
  }).passthrough() })
export const NativeAliasObservation = z.object({ threadId: z.number().int().positive(), event: AliasInput.shape.event })

/** An alias changes the selector name; all factual fields still come from Session. */
export function judgeAlias(raw: unknown) {
  const { event, params } = AliasInput.parse(raw)
  appendFileSync(params.tracePath, JSON.stringify({ threadId, event }) + '\n')
  return { ok: true }
}

/** Observe the actual Worker input after the production native resolver. */
export function judge(raw: unknown) {
  const { event, params } = Input.parse(raw)
  appendFileSync(params.tracePath, JSON.stringify({ threadId, event }) + '\n')
  const context = event.context.messages.map(message => message.text).join('\n')
  return { ok: event.name === 'native_prefix_probe' && event.arguments.file_path === 'original.ts'
    && context.includes('EARLY_CONTEXT') && !context.includes('LATE_CONTEXT') && !context.includes('CURRENT_RESULT') }
}
