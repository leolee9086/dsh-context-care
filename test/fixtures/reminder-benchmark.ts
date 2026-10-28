import { RuleEventInput as Event } from '@leolee9086/dsh-rule-engine'
import { createHash } from 'node:crypto'
import { isMainThread, threadId } from 'node:worker_threads'
import { z } from 'zod'


/** Real local judge: its verdict and facts depend on the event AND each rule's params. */
const JudgeInput = z.object({
  event: Event,
  params: z.object({
    mode: z.enum(['accept', 'reject', 'throw']),
    tag: z.string().min(1),
    marker: z.string().min(1),
    minimumLevel: z.number().int(),
    expectedCallId: z.string().min(1),
  }).strict(),
}).strict()

export function judge(input: unknown) {
  const { event, params } = JudgeInput.parse(input)
  if (event.callId !== params.expectedCallId) throw new Error('benchmark-judge-event-mismatch')
  if (params.mode === 'throw') throw new Error(`benchmark-judge-rejected:${params.tag}`)
  const command = z.object({ command: z.string() }).parse(event.arguments).command
  const level = z.number().parse(event.facts.level)
  const context = event.context?.messages.map(message => message.text).join('\n') ?? ''
  // Hash the real context so changing an event/params field cannot leave a canned answer.
  const digest = createHash('sha256').update(context).update(command).update(params.tag).digest('hex')
  return {
    ok: params.mode === 'accept' && command.includes(params.marker) && level >= params.minimumLevel,
    facts: { tag: params.tag, mode: params.mode, level, contextChars: context.length,
      commandChars: command.length, eventId: event.callId, digest },
  }
}

/** Separate startup proof: environment fields must not contaminate semantic comparisons. */
export function probe(input: unknown) {
  z.object({ event: Event, params: z.null() }).strict().parse(input)
  return { ok: true, facts: { isMainThread, threadId, execArgv: [...process.execArgv], node: process.version } }
}
