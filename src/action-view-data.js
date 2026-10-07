import { isCheckpointSource } from './producer-source.js'

/**
 * Project one session's journal into request-budget facts and grouped actions.
 * Project the fields consumed by the panel; the Host journal retains full records.
 * Existing compaction events recover facts when a post-commit audit write failed.
 * @param records durable records already filtered to the requested session
 * @param session optional loaded session for committed-event fallback
 * @returns ordered actions and latest conversation admission, without request text
 */
export function contextCareActions(records, session) {
  const groups = new Map()
  // A handoff transaction is audited under its containing maintenance operation.
  // Resolve both IDs before replay so successful and partial settlements stay one action.
  const transactionOwners = new Map(records.filter(record => record.kind === 'maintenance'
    && record.data.operationId && record.data.compactionId).map(record => [record.data.compactionId, record.data.operationId]))
  let admission
  for (const record of records) {
    const data = record.data
    if (record.kind === 'request') {
      if (data.purpose === 'conversation' && data.budget && (!admission || data.logRevision > admission.logRevision
        || (data.logRevision === admission.logRevision && (data.dispatchOrder ?? 0) >= admission.dispatchOrder))) {
        admission = { callId: data.callId, at: record.at, route: data.route, budget: data.budget,
          dispatched: data.dispatched, phase: data.phase, logRevision: data.logRevision, dispatchOrder: data.dispatchOrder ?? 0, rawInput: data.rawInput,
          pricing: data.pricingBasis && { kind: data.pricingBasis.kind, source: data.pricingBasis.source, textScale: data.pricingBasis.textScale, sampleSeq: data.pricingBasis.sampleSeq } }
      }
      continue
    }
    if (record.kind !== 'maintenance') continue
    const id = data.operationId ?? transactionOwners.get(data.compactionId) ?? data.compactionId ?? record.key
    const previous = groups.get(id) ?? { id, phases: [] }
    const fields = ['action', 'reason', 'phase', 'rule', 'outcome', 'beforeSeq', 'afterSeq', 'beforeGeneration', 'afterGeneration',
      'beforeInput', 'afterInput', 'routeSaving', 'heuristicSaving', 'sourceSeqs', 'shadowedSeqs', 'oldSourceSeqs', 'replacements',
      'summaryTransactions', 'summarySeq', 'checkpointSeq', 'endSeq', 'coverage', 'progressed', 'error', 'failure',
      'beforeSummaryInput', 'afterSummaryInput', 'comparisons']
    const display = Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, data[field]]))
    groups.set(id, { ...previous, ...display, at: record.at, journalPersisted: true, phases: [...previous.phases, data.phase] })
  }
  if (session) {
    const events = session.snapshotEvents()
    const summaries = new Map(events.filter(event => event.type === 'compaction/summary').map(event => [event.data.compactionId, event]))
    for (const event of events) {
      if (event.type !== 'user/message' || !isCheckpointSource(event.data.source) || event.surfaceOp?.op !== 'replace') continue
      const transactionId = event.data.source.compactionId
      const audited = [...groups.values()].find(action => action.replacements?.some(replacement => replacement.newSeq === event.seq))
      const id = audited?.id ?? transactionOwners.get(transactionId) ?? transactionId
      const previous = groups.get(id)
      if (previous?.phase === 'committed' || audited) continue
      const summary = summaries.get(transactionId)
      const sources = summary?.data.shadowedSeqs ?? (event.sourceEventSeqs ?? []).filter(seq => ['user/message', 'assistant/message', 'tool/result'].includes(session.eventAt(seq)?.type))
      groups.set(id, { ...previous, id, action: previous?.action ?? (summary ? 'summary' : 'deep-rest'), phase: 'committed',
        at: previous?.at ?? event.time, phases: previous?.phases ?? [], journalPersisted: false, checkpointSeq: event.seq,
        summarySeq: summary?.seq, shadowedSeqs: sources, replacements: [{ newSeq: event.seq, oldStartSeq: event.surfaceOp.startSeq, oldEndSeq: event.surfaceOp.endSeq, sourceSeqs: sources }] })
    }
  }
  return { admission, actions: [...groups.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || b.id.localeCompare(a.id)) }
}
