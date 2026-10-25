import { z } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionLog } from './session-log.js'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionRequestRecord } from './request-history.js'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
// Messages come from already-admitted Session data. Check the projection fields
// we consume without stripping provider-owned content or attachment references.
const message = z.custom<GenerateOptions['messages'][number]>(value => object(value)
  && typeof value.role === 'string' && Array.isArray(value.content))
const Prompt = z.object({ callId: z.string(), message: message.optional(),
  segments: z.array(z.record(z.string(), z.json())) }).passthrough()
const Workbench = z.object({ callId: z.string(), diff: z.object({
  after: z.object({ system: z.string().optional(), messages: z.array(message) }) }) }).passthrough()

/**
 * Read request-only inputs already committed by their producer.
 * @param event a committed Session event
 * @returns logged input changes, or undefined for unrelated events
 */
export function requestDecision(event: SessionEvent) {
  if (event.type !== 'request/header') return undefined
  const prompt = 'contextCarePrompt' in event.data ? Prompt.parse(event.data.contextCarePrompt) : undefined
  const workbench = 'contextCareWorkbench' in event.data ? Workbench.parse(event.data.contextCareWorkbench) : undefined
  if (!prompt && !workbench) return undefined
  return { seq: event.seq, prompt, workbench }
}

/**
 * Reconstruct one settled conversation's input using the native Session surface
 * projection. Only calibration misses need this; no provider or judge is called.
 * @param logs - the Host-owned native log and historical projection service.
 * @param session - the original event log.
 * @param record - the settlement to price.
 * @returns the historical input, including committed request-only changes.
 */
export function replayRequest(logs: SessionLog, session: Session, record: SessionRequestRecord) {
  const restored = logs.historical(session, record.data.eventSeq)
  const header = record.data.sourceHeader
  if (!header) throw new Error('context-care: settled request has no logged header')
  // The shared settlement fold already binds changes to exactly this attempt.
  const prompt = record.data.promptDecision, workbench = record.data.workbenchDecision
  const request: GenerateOptions = { ...header.config, sessionId: session.id, toolHistory: logs.tools(restored),
    messages: workbench?.diff.after.messages ?? [...logs.messages(restored)],
    ...(header.tools === undefined ? {} : { tools: header.tools }),
    ...(workbench?.diff.after.system === undefined ? {} : { system: workbench.diff.after.system }) }
  if (prompt?.message && !workbench) {
    request.messages = [...request.messages, prompt.message]
  }
  return { session: restored, request, promptDecision: prompt, sourceSeqs: [...restored.surface.nodes] }
}
