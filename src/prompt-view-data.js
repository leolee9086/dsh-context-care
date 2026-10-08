import { producerOf, producedUnder, isCheckpointSource } from './producer-source.js'
import { GUIDANCE } from './policy.js'

const own = source => producerOf(source) === 'dsh-context-care' || producedUnder(source, 'dsh-context-care:')
const text = value => typeof value === 'string' ? value : (Array.isArray(value) ? value : []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const segmentFields = ['ruleId', 'version', 'trigger', 'provider', 'model', 'purpose', 'text', 'segmentId', 'sourceRoute', 'sourceSeqs', 'metrics']
const reference = data => ({ callId: data.callId, dispatched: data.dispatched, phase: data.phase, route: data.route })

/** Extract exact identifiable contributions; a marker alone cannot authorize exposing adjacent system text. */
export function requestCareInstructions(request) {
  const instructions = []
  const system = [text(request.system), ...(request.messages ?? []).filter(message => message.role === 'system').map(message => text(message.content))].join('\n\n')
  const start = system.indexOf(GUIDANCE)
  if (start >= 0) instructions.push({ kind: 'guidance', text: system.slice(start, start + GUIDANCE.length) })
  for (const message of request.messages ?? []) {
    if (producerOf(message.source) === 'dsh-context-care:summary-instruction') instructions.push({ kind: 'summary-instruction',
      text: text(message.content), sourceSeqs: message.source.contextCareTrace?.sourceSeqs ?? [] })
  }
  return instructions
}

/**
 * Project this plugin's messages, request-only decisions and checkpoint wrappers from durable facts.
 * Source excerpts are bounded and explicitly marked; prompt bodies remain exact.
 * @param records durable journal records filtered to this session
 * @param session loaded session, including log-only history
 * @returns newest-first prompt records with stable identity and request/source references
 */
export function contextCarePrompts(records, session) {
  const events = session?.snapshotEvents() ?? []
  const bySeq = new Map(events.map(event => [event.seq, event]))
  const calls = records.filter(record => record.kind === 'request')
  const actions = records.filter(record => record.kind === 'maintenance')
  const ownedTransactions = new Set(actions.flatMap(({ data }) => [data.compactionId, ...(data.summaryTransactions ?? [])]).filter(Boolean))
  const prompts = new Map()
  const sourceFacts = seqs => [...new Set(seqs ?? [])].map(seq => {
    const event = bySeq.get(seq)
    const body = text(event?.data?.content ?? event?.data?.message?.content)
    return { seq, type: event?.type ?? 'unavailable', excerpt: body.slice(0, 2000), truncated: body.length > 2000 }
  })
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = event.data.source
    const checkpoint = isCheckpointSource(source) && (source.contextCareTrace?.producer === 'dsh-context-care' || ownedTransactions.has(source.compactionId))
    if (!own(source) && !checkpoint) continue
    prompts.set(`event:${event.seq}`, { id: `event:${event.seq}`, seq: event.seq, at: event.time, kind: checkpoint ? 'checkpoint' : 'message',
      producer: checkpoint ? 'dsh-context-care:checkpoint' : producerOf(source), title: source.summary, text: text(event.data.content), source,
      evaluations: actions.filter(({ data }) => data.action === 'rule-evaluation' && data.evaluationId
        && data.evaluationId === source.contextCareTrace?.evaluationId).map(({ key, at, data }) => ({ key, at, ...data })),
      sources: sourceFacts(source.contextCareTrace?.sourceSeqs ?? event.sourceEventSeqs),
      calls: calls.filter(record => (record.data.requestSourceSeqs ?? record.data.sourceSeqs)?.includes(event.seq)).map(record => reference(record.data)) })
  }
  for (const event of events) {
    if (event.type === 'system/message') {
      const instructions = requestCareInstructions({ messages: [{ role: 'system', content: event.data.message?.content ?? event.data.content }] })
      for (const instruction of instructions) prompts.set(`system:${event.seq}`, { id: `system:${event.seq}`, seq: event.seq, at: event.time,
        kind: instruction.kind, producer: 'dsh-context-care', text: instruction.text, sources: [],
        calls: calls.filter(record => (record.data.requestSourceSeqs ?? record.data.sourceSeqs)?.includes(event.seq)).map(record => reference(record.data)) })
    }
    if (event.type !== 'request/header' || !event.data.contextCarePrompt) continue
    const decision = event.data.contextCarePrompt
    const call = calls.find(record => record.data.callId === decision.callId)
    prompts.set(`request:${decision.callId}`, { id: `request:${decision.callId}`, seq: event.seq, at: event.time, kind: 'request',
      producer: 'dsh-context-care:scoped-prompts', text: text(decision.message?.content),
      segments: decision.segments.map(segment => Object.fromEntries(segmentFields.filter(key => segment[key] !== undefined).map(key => [key, segment[key]]))),
      sources: sourceFacts(decision.segments.flatMap(segment => segment.sourceSeqs ?? [])),
      calls: [call ? reference(call.data) : { callId: decision.callId }] })
  }
  for (const { data, at } of calls) {
    // A journal decision can survive an auxiliary failure without a committed checkpoint.
    if (data.promptDecision && !prompts.has(`request:${data.callId}`)) {
      const segments = data.promptDecision.segments
      prompts.set(`request:${data.callId}`, { id: `request:${data.callId}`, at, seq: data.promptDecision.seq, kind: 'request',
        producer: 'dsh-context-care:scoped-prompts', text: data.promptDecision.message ? text(data.promptDecision.message.content) : segments.map(segment => segment.text).join('\n\n'),
        bodyStatus: data.promptDecision.message ? 'exact' : 'segments-only',
        segments, sources: sourceFacts(segments.flatMap(segment => segment.sourceSeqs ?? [])), calls: [reference(data)] })
    }
    for (const [index, instruction] of (data.careInstructions ?? []).entries()) {
      const sourcePrompt = instruction.sourceSeq === undefined ? undefined : prompts.get(`system:${instruction.sourceSeq}`)
      if (sourcePrompt?.text === instruction.text) continue
      const id = `instruction:${data.callId}:${index}`
      prompts.set(id, { id, at, seq: data.logRevision, kind: instruction.kind, producer: 'dsh-context-care', text: instruction.text,
        sources: sourceFacts(instruction.sourceSeqs ?? []), calls: [reference(data)] })
    }
  }
  return [...prompts.values()].sort((a, b) => (b.seq ?? -1) - (a.seq ?? -1) || b.id.localeCompare(a.id))
}
