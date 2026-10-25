import { producerOf, producedUnder, isCheckpointSource } from './producer-source.js'
import { GUIDANCE } from './policy.js'
import { createDiagnosticIndex, createDiagnosticRelations } from '../lib/diagnostic-pages.js'

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

export const promptEventTypes = /** @type {const} */ (['user/message', 'system/message', 'request/header'])
const sourceFacts = (seqs, log) => [...new Set(seqs ?? [])].map(seq => {
  const event = log.at(seq), body = text(event?.data?.content ?? event?.data?.message?.content)
  return { seq, type: event?.type ?? 'unavailable', excerpt: body.slice(0, 2000), truncated: body.length > 2000 }
})

/** Each native fact is classified once; relation changes invalidate only its dependents. */
export function createPromptIndex() {
  const entries = createDiagnosticIndex(), facts = new Map(), requests = new Map(), systems = new Map()
  const dependencies = new Map(), dependenciesById = new Map(), callEntries = new Map()
  const callsBySeq = createDiagnosticRelations(record => record.kind === 'request' ? record.data.requestSourceSeqs ?? record.data.sourceSeqs ?? [] : [])
  const callsById = createDiagnosticRelations(record => record.kind === 'request' ? [record.data.callId] : [])
  const evaluations = createDiagnosticRelations(record => record.kind === 'maintenance' && record.data.action === 'rule-evaluation' && record.data.evaluationId ? [record.data.evaluationId] : [])
  const transactions = createDiagnosticRelations(record => record.kind === 'maintenance' ? [record.data.compactionId, ...(record.data.summaryTransactions ?? [])].filter(Boolean) : [])
  const instructionsBySource = createDiagnosticRelations(record => record.kind === 'request' ? (record.data.careInstructions ?? []).flatMap(item => item.sourceSeq === undefined ? [] : [item.sourceSeq]) : [])
  let previousRecords
  const depend = (id, keys) => {
    for (const key of dependenciesById.get(id) ?? []) { const bucket = dependencies.get(key); bucket.delete(id); if (!bucket.size) dependencies.delete(key) }
    dependenciesById.set(id, keys)
    for (const key of keys) { let bucket = dependencies.get(key); if (!bucket) { bucket = new Set(); dependencies.set(key, bucket) }; bucket.add(id) }
  }
  const set = (id, seq, materialize) => entries.set({ id, seq, order: seq ?? -1, materialize })
  const refreshFact = id => {
    const event = facts.get(id)
    if (!event) return
    if (event.type === 'user/message') {
      const source = event.data.source, trace = source.contextCareTrace
      const checkpoint = isCheckpointSource(source) && (trace?.producer === 'dsh-context-care' || transactions.get(source.compactionId).length > 0)
      if (!own(source) && !checkpoint) { entries.delete(id); return }
      set(id, event.seq, log => {
        const evaluation = trace?.evaluation
        const related = evaluation?.evaluationId && evaluation.evaluationId === trace.evaluationId
          ? [{ ...evaluation, key: `event:${event.seq}:evaluation`, at: event.time, eventSeq: event.seq }]
          : evaluations.get(trace?.evaluationId).map(({ key, at, data }) => ({ key, at, ...data }))
        return { id, seq: event.seq, at: event.time, kind: checkpoint ? 'checkpoint' : 'message',
          producer: checkpoint ? 'dsh-context-care:checkpoint' : producerOf(source), title: source.summary, text: text(event.data.content), source,
          evaluations: related, sources: sourceFacts(trace?.sourceSeqs ?? event.sourceEventSeqs, log),
          calls: callsBySeq.get(event.seq).map(record => reference(record.data)) }
      })
    } else if (event.type === 'system/message') {
      const instruction = systems.get(event.seq)
      if (instruction) set(id, event.seq, () => ({ id, seq: event.seq, at: event.time, kind: instruction.kind,
        producer: 'dsh-context-care', text: instruction.text, sources: [], calls: callsBySeq.get(event.seq).map(record => reference(record.data)) }))
    }
  }
  const refreshCall = callId => {
    const requestId = `request:${callId}`
    for (const id of callEntries.get(callId) ?? []) entries.delete(id)
    const ids = new Set(); callEntries.set(callId, ids)
    const header = requests.get(callId), calls = callsById.get(callId)
    if (header) {
      const decision = header.data.contextCarePrompt
      set(requestId, header.seq, log => ({ id: requestId, seq: header.seq, at: header.time, kind: 'request',
        producer: 'dsh-context-care:scoped-prompts', text: text(decision.message?.content),
        segments: decision.segments.map(segment => Object.fromEntries(segmentFields.filter(key => segment[key] !== undefined).map(key => [key, segment[key]]))),
        sources: sourceFacts(decision.segments.flatMap(segment => segment.sourceSeqs ?? []), log),
        calls: [calls[0] ? reference(calls[0].data) : { callId: decision.callId }] }))
      ids.add(requestId)
    }
    for (const { data, at } of calls) {
      if (data.promptDecision && !ids.has(requestId)) {
        const decision = data.promptDecision, segments = decision.segments
        set(requestId, decision.seq, log => ({ id: requestId, at, seq: decision.seq, kind: 'request', producer: 'dsh-context-care:scoped-prompts',
          text: decision.message ? text(decision.message.content) : segments.map(segment => segment.text).join('\n\n'),
          bodyStatus: decision.message ? 'exact' : 'segments-only', segments,
          sources: sourceFacts(segments.flatMap(segment => segment.sourceSeqs ?? []), log), calls: [reference(data)] }))
        ids.add(requestId)
      }
      for (const [index, instruction] of (data.careInstructions ?? []).entries()) {
        if (instruction.sourceSeq !== undefined && systems.get(instruction.sourceSeq)?.text === instruction.text) continue
        const id = `instruction:${data.callId}:${index}`
        set(id, data.logRevision, log => ({ id, at, seq: data.logRevision, kind: instruction.kind, producer: 'dsh-context-care', text: instruction.text,
          sources: sourceFacts(instruction.sourceSeqs, log), calls: [reference(data)] }))
        ids.add(id)
      }
    }
  }
  return (records, added) => {
    const dirtyFacts = new Set(), dirtyCalls = new Set()
    if (records !== previousRecords) {
      for (const [prefix, changed] of [['seq', callsBySeq.update(records)], ['evaluation', evaluations.update(records)], ['transaction', transactions.update(records)]])
        for (const key of changed) for (const id of dependencies.get(`${prefix}:${key}`) ?? []) dirtyFacts.add(id)
      for (const callId of callsById.update(records)) dirtyCalls.add(callId)
      instructionsBySource.update(records)
      previousRecords = records
    }
    for (const event of added) {
      if (event.type === 'user/message') {
        const source = event.data.source
        if (!own(source) && !isCheckpointSource(source)) continue
        const id = `event:${event.seq}`
        facts.set(id, event); dirtyFacts.add(id)
        depend(id, [`seq:${event.seq}`, `evaluation:${source.contextCareTrace?.evaluationId}`, `transaction:${source.compactionId}`])
      } else if (event.type === 'system/message') {
        // Membership requires inspecting system text once, never on page navigation.
        const instruction = requestCareInstructions({ messages: [{ role: 'system', content: event.data.message?.content ?? event.data.content }] })[0]
        if (!instruction) continue
        systems.set(event.seq, instruction)
        const id = `system:${event.seq}`
        facts.set(id, event); depend(id, [`seq:${event.seq}`]); dirtyFacts.add(id)
        for (const call of instructionsBySource.get(event.seq)) dirtyCalls.add(call.data.callId)
      } else if (event.type === 'request/header' && event.data.contextCarePrompt) {
        requests.set(event.data.contextCarePrompt.callId, event); dirtyCalls.add(event.data.contextCarePrompt.callId)
      }
    }
    for (const id of dirtyFacts) refreshFact(id)
    for (const callId of dirtyCalls) refreshCall(callId)
    return { entries }
  }
}

/** Whole-list query over an explicit shared log; HTTP routes use bounded pages. */
export function contextCarePrompts(records, session, log) {
  const indexed = createPromptIndex()(records, log.select(promptEventTypes)).entries
  return indexed.slice(0, indexed.size).map(entry => entry.materialize(log))
}
