import { isCheckpointSource } from './producer-source.js'

const fields = ['action', 'reason', 'phase', 'rule', 'outcome', 'beforeSeq', 'afterSeq', 'beforeGeneration', 'afterGeneration',
  'beforeInput', 'afterInput', 'routeSaving', 'heuristicSaving', 'sourceSeqs', 'shadowedSeqs', 'oldSourceSeqs', 'replacements',
  'summaryTransactions', 'summarySeq', 'checkpointSeq', 'endSeq', 'coverage', 'progressed', 'error', 'failure', 'secondaryFailures',
  'beforeSummaryInput', 'afterSummaryInput', 'comparisons', 'proposalKey', 'callId']
const settled = new Set(['committed', 'completed', 'failed', 'no-useful-range'])

/**
 * Merge this session's durable audits and committed history without inventing missing prices or ownership.
 * @param records durable records already filtered to the requested session
 * @param session optional loaded session containing replacement and summary facts
 * @returns ordered actions and latest conversation admission, without unrelated request text
 */
export function contextCareActions(records, session) {
  const groups = new Map()
  const transactionOwners = new Map()
  for (const { kind, data } of records) {
    if (kind !== 'maintenance' || !data.operationId) continue
    for (const id of [...(data.summaryTransactions ?? []), ...(data.compactionId ? [data.compactionId] : [])]) transactionOwners.set(id, data.operationId)
  }
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
    if (record.kind !== 'maintenance' || ['rule-evaluation', 'request-rewrite'].includes(data.action)) continue
    const id = data.operationId ?? transactionOwners.get(data.compactionId) ?? data.compactionId ?? record.key
    const previous = groups.get(id) ?? { id, phases: [], auditKeys: [] }
    const display = Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, data[field]]))
    groups.set(id, { ...previous, ...display, at: record.at, journalPersisted: true,
      auditStatus: settled.has(data.phase) ? 'complete' : 'partial',
      auditKeys: [...previous.auditKeys, record.key], phases: [...previous.phases, data.phase] })
  }
  if (session) {
    const events = session.snapshotEvents()
    const summaries = new Map(events.filter(event => event.type === 'compaction/summary').map(event => [event.data.compactionId, event]))
    for (const event of events) {
      if (event.type !== 'user/message' || !isCheckpointSource(event.data.source) || event.surfaceOp?.op !== 'replace') continue
      const transactionId = event.data.source.compactionId
      const audited = [...groups.values()].find(action => action.checkpointSeq === event.seq || action.replacements?.some(replacement => replacement.newSeq === event.seq))
      const id = audited?.id ?? transactionOwners.get(transactionId) ?? transactionId ?? `checkpoint:${event.seq}`
      const previous = groups.get(id)
      const summary = summaries.get(transactionId)
      const sources = summary?.data.shadowedSeqs ?? (event.sourceEventSeqs ?? []).filter(seq => ['user/message', 'assistant/message', 'tool/result'].includes(session.eventAt(seq)?.type))
      const fact = { compactionId: transactionId, checkpointSeq: event.seq, summarySeq: summary?.seq,
        at: event.time, sourceCommandId: summary?.data.sourceCommandId, shadowedTokenCount: summary?.data.shadowedTokenCount,
        route: summary?.data.llmStreamCall === true ? { provider: summary.data.provider, model: summary.data.model } : undefined, usage: summary?.data.usage,
        sourceSeqs: sources, newSeq: event.seq, oldStartSeq: event.surfaceOp.startSeq, oldEndSeq: event.surfaceOp.endSeq }
      // A failed operation may already contain durable replacements. Retain its failure and prices.
      const hasAudit = (previous?.auditKeys?.length ?? 0) > 0
      const complete = hasAudit && previous.auditStatus === 'complete'
      const replacements = [...(previous?.replacements ?? [])]
      if (!replacements.some(replacement => replacement.newSeq === event.seq)) replacements.push({ newSeq: event.seq,
        oldStartSeq: event.surfaceOp.startSeq, oldEndSeq: event.surfaceOp.endSeq, sourceSeqs: sources })
      groups.set(id, { ...previous, id, action: previous?.action ?? (event.data.source.contextCareTrace?.trigger === 'deep-rest' ? 'deep-rest' : summary?.data.llmStreamCall === true ? 'summary' : 'checkpoint'),
        phase: complete ? previous.phase : 'committed', at: previous?.at ?? event.time, phases: previous?.phases ?? [],
        auditKeys: previous?.auditKeys ?? [], auditStatus: hasAudit ? (complete ? 'complete' : 'partial') : 'session-only',
        journalPersisted: Boolean(complete), checkpointSeq: previous?.checkpointSeq ?? event.seq,
        summarySeq: previous?.summarySeq ?? summary?.seq, shadowedSeqs: previous?.shadowedSeqs ?? sources,
        replacements, commits: [...(previous?.commits ?? []), fact] })
    }
  }
  return { admission, actions: [...groups.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || b.id.localeCompare(a.id)) }
}
