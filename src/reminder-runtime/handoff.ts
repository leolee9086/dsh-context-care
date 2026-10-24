import { z } from 'zod'
import { SessionState } from './state.js'
import type { CandidateValue } from './state.js'
import type { MessageView } from './request-context.js'

const KIND = 'plugin:dsh-context-care:reminder'
const Candidate = SessionState.shape.candidates.element
const Handoff = Candidate.pick({ revision: true, policy: true, request: true, sticky: true, queued: true }).extend({
  format: z.literal('context-care/reminder-handoff/v1'), sourceSignature: z.string().min(1),
})
const Message = z.object({
  id: z.string().min(1), role: z.literal('user'), content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  source: z.object({ kind: z.literal(KIND), summary: z.string(),
    reminder: z.object({ key: z.string(), candidateId: z.string(), sessionId: z.string(), handoff: Handoff,
      window: Candidate.shape.window }),
    contextCareTrace: z.object({ sourceId: z.string(), ruleId: z.string(), callId: z.string(), rootCallId: z.string(),
      rule: Candidate.shape.rule, evidence: z.json(), native: Candidate.shape.native, output: Candidate.shape.output }),
  }),
})

/**
 * Identify the rule and control generation that supplied an actual inbox message.
 * This is delivery evidence, not a serialized runtime state or a source token.
 * @param candidate - the matched, rendered candidate being handed to the inbox.
 * @returns stable delivery validity fields, absent for older unsigned candidates.
 */
export function reminderHandoff(candidate: CandidateValue) {
  if (candidate.sourceSignature === undefined) return undefined
  return Handoff.parse({ format: 'context-care/reminder-handoff/v1', sourceSignature: candidate.sourceSignature,
    revision: candidate.revision, policy: candidate.policy,
    ...(candidate.queued ? { queued: candidate.queued } : {}),
    ...(candidate.request ? { request: candidate.request } : {}),
    ...(candidate.sticky ? { sticky: candidate.sticky } : {}),
  })
}

/**
 * Recover only a real handed message; replay never invokes a judge or template.
 * Legacy messages without the validity fields cannot establish a new reservation.
 * @param sessionId - the recipient whose native inbox supplied the message.
 * @param message - a message claimed from that inbox at the next pre-step.
 * @returns a reserved candidate with its original message identity and frozen body.
 */
export function candidateFromMessage(sessionId: string, message: MessageView): CandidateValue | undefined {
  if (message.source?.kind !== KIND) return undefined
  const source: unknown = message.source
  if (source === null || typeof source !== 'object' || !('reminder' in source)) return undefined
  const reminder = source.reminder
  if (reminder === null || typeof reminder !== 'object' || !('handoff' in reminder)) return undefined
  const handed = Message.parse(message), { reminder: identity, contextCareTrace: trace } = handed.source
  if (identity.sessionId !== sessionId) return undefined
  return Candidate.parse({ id: identity.candidateId, sessionId, sourceId: trace.sourceId, sourceToken: '',
    sourceSignature: identity.handoff.sourceSignature, ruleId: trace.ruleId, key: identity.key,
    revision: identity.handoff.revision, policy: identity.handoff.policy,
    ...(identity.window ? { window: identity.window } : {}),
    ...(identity.handoff.request ? { request: identity.handoff.request } : {}),
    ...(identity.handoff.sticky ? { sticky: identity.handoff.sticky } : {}),
    ...(trace.native ? { native: trace.native } : {}),
    ...(trace.output ? { output: trace.output } : {}),
    text: handed.content.map(block => block.text).join(''), title: handed.source.summary,
    eventId: trace.callId, rootCallId: trace.rootCallId, messageId: handed.id,
    status: identity.handoff.queued ? 'pending' : 'reserved', rendered: true,
    ...(identity.handoff.queued ? { queued: identity.handoff.queued } : {}),
    evidence: trace.evidence, rule: trace.rule,
  })
}
