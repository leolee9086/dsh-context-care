import { isCheckpointSource } from './producer-source.js'
import { createDiagnosticIndex, createDiagnosticRelations, createDiagnosticRecordChanges, compareDiagnosticRecords, createDiagnosticOrder } from '../lib/diagnostic-pages.js'

const fields = ['action', 'reason', 'phase', 'rule', 'outcome', 'beforeSeq', 'afterSeq', 'beforeGeneration', 'afterGeneration',
  'beforeInput', 'afterInput', 'routeSaving', 'heuristicSaving', 'sourceSeqs', 'shadowedSeqs', 'oldSourceSeqs', 'replacements',
  'summaryTransactions', 'summarySeq', 'checkpointSeq', 'endSeq', 'coverage', 'progressed', 'error', 'failure', 'secondaryFailures',
  'beforeSummaryInput', 'afterSummaryInput', 'comparisons', 'proposalKey', 'callId']
const settled = new Set(['committed', 'completed', 'failed', 'no-useful-range'])
export const actionEventTypes = /** @type {const} */ (['compaction/summary', 'user/message'])

/** Incremental identities/owners only. Replacements, prices and commits remain page-lazy. */
export function createActionIndex() {
  const entries = createDiagnosticIndex(), summaries = new Map(), checkpoints = new Map()
  const byTransaction = new Map(), checkpointGroups = new Map(), groupCheckpoints = new Map()
  const transactionOwners = new Map(), auditOwners = new Map(), groupAudits = new Map(), auditCandidates = new Map()
  const changes = createDiagnosticRecordChanges()
  const ownerDeclarations = createDiagnosticRelations(record => record.kind === 'maintenance' && record.data.operationId
    ? [record.data.compactionId, ...(record.data.summaryTransactions ?? [])].filter(Boolean) : [], compareDiagnosticRecords)
  const transactionMembers = createDiagnosticRelations(record => eligible(record) && record.data.compactionId ? [record.data.compactionId] : [], compareDiagnosticRecords)
  const admissions = createDiagnosticOrder((left, right) => (left.data.logRevision ?? 0) - (right.data.logRevision ?? 0)
    || (left.data.dispatchOrder ?? 0) - (right.data.dispatchOrder ?? 0) || compareDiagnosticRecords(left, right))
  const isAdmission = record => record.kind === 'request' && record.data.purpose === 'conversation' && record.data.budget
  let selectedAdmission, admission
  const groupId = record => record.data.operationId ?? transactionOwners.get(record.data.compactionId) ?? record.data.compactionId ?? record.key
  const eligible = record => record.kind === 'maintenance' && !['rule-evaluation', 'request-rewrite'].includes(record.data.action)
  const members = createDiagnosticRelations(record => eligible(record) ? [groupId(record)] : [], compareDiagnosticRecords)
  const assign = (event, dirty) => {
    const transactionId = event.data.source.compactionId
    const id = auditOwners.get(event.seq) ?? transactionOwners.get(transactionId) ?? transactionId ?? `checkpoint:${event.seq}`
    const previous = checkpointGroups.get(event.seq)
    if (previous !== id) {
      if (previous !== undefined) { groupCheckpoints.get(previous).delete(event.seq); dirty.add(previous) }
      let bucket = groupCheckpoints.get(id)
      if (!bucket) { bucket = new Map(); groupCheckpoints.set(id, bucket) }
      bucket.set(event.seq, event); checkpointGroups.set(event.seq, id)
    }
    dirty.add(id)
  }
  const materialize = (id, records, events, log) => {
    let value
    for (const record of records) {
      const data = record.data, previous = value ?? { id, phases: [], auditKeys: [] }
      const display = Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, data[field]]))
      value = { ...previous, ...display, at: record.at, journalPersisted: previous.journalPersisted === true || record.transient !== true,
        auditStatus: settled.has(data.phase) ? 'complete' : 'partial', auditKeys: [...previous.auditKeys, record.key], phases: [...previous.phases, data.phase] }
    }
    for (const event of events) {
      const transactionId = event.data.source.compactionId, summary = summaries.get(transactionId), previous = value
      const sources = summary?.data.shadowedSeqs ?? (event.sourceEventSeqs ?? []).filter(seq => ['user/message', 'assistant/message', 'tool/result'].includes(log.at(seq)?.type))
      const fact = { compactionId: transactionId, checkpointSeq: event.seq, summarySeq: summary?.seq,
        at: event.time, sourceCommandId: summary?.data.sourceCommandId, shadowedTokenCount: summary?.data.shadowedTokenCount,
        route: summary?.data.llmStreamCall === true ? { provider: summary.data.provider, model: summary.data.model } : undefined, usage: summary?.data.usage,
        sourceSeqs: sources, newSeq: event.seq, oldStartSeq: event.surfaceOp.startSeq, oldEndSeq: event.surfaceOp.endSeq }
      // A failed audit can contain durable replacements; keep its failure/prices.
      const hasAudit = (previous?.auditKeys?.length ?? 0) > 0, complete = hasAudit && previous.auditStatus === 'complete'
      const replacements = [...(previous?.replacements ?? [])]
      if (!replacements.some(replacement => replacement.newSeq === event.seq)) replacements.push({ newSeq: event.seq,
        oldStartSeq: event.surfaceOp.startSeq, oldEndSeq: event.surfaceOp.endSeq, sourceSeqs: sources })
      value = { ...previous, id, action: previous?.action ?? (event.data.source.contextCareTrace?.trigger === 'deep-rest' ? 'deep-rest' : summary?.data.llmStreamCall === true ? 'summary' : 'checkpoint'),
        phase: complete ? previous.phase : 'committed', at: previous?.at ?? event.time, phases: previous?.phases ?? [],
        auditKeys: previous?.auditKeys ?? [], auditStatus: hasAudit ? (complete ? 'complete' : 'partial') : 'session-only',
        journalPersisted: Boolean(complete && previous?.journalPersisted), checkpointSeq: previous?.checkpointSeq ?? event.seq,
        summarySeq: previous?.summarySeq ?? summary?.seq, shadowedSeqs: previous?.shadowedSeqs ?? sources,
        replacements, commits: [...(previous?.commits ?? []), fact] }
    }
    return value
  }
  return (records, added) => {
    const dirty = new Set(), affected = new Set()
    const delta = changes(records)
    if (delta.added.length || delta.removed.length || delta.order) {
      const relationRecords = delta.order ?? delta
      const rekey = new Set()
      transactionMembers.update(relationRecords)
      for (const id of ownerDeclarations.update(relationRecords)) {
        const owner = ownerDeclarations.get(id).at(-1)?.data.operationId
        if (owner === transactionOwners.get(id)) continue
        if (owner === undefined) transactionOwners.delete(id); else transactionOwners.set(id, owner)
        for (const record of transactionMembers.get(id)) rekey.add(record)
        for (const event of byTransaction.get(id)?.values() ?? []) affected.add(event)
      }
      for (const id of members.update(relationRecords)) dirty.add(id)
      for (const id of members.rekey(rekey)) dirty.add(id)
      admissions.update({ added: delta.added.filter(isAdmission), removed: delta.removed.filter(isAdmission) })
      const selected = admissions.last()
      if (selected !== selectedAdmission) {
        selectedAdmission = selected
        const data = selected?.data
        admission = data && { callId: data.callId, at: selected.at, route: data.route, budget: data.budget, dispatched: data.dispatched, phase: data.phase,
          logRevision: data.logRevision, dispatchOrder: data.dispatchOrder ?? 0, rawInput: data.rawInput,
          pricing: data.pricingBasis && { kind: data.pricingBasis.kind, source: data.pricingBasis.source, textScale: data.pricingBasis.textScale, sampleSeq: data.pricingBasis.sampleSeq } }
      }
      // Only changed groups recompute their latest audit scalars. Conflicting
      // explicit seq claims preserve the original earliest-group precedence.
      const changedSeqs = new Set()
      for (const id of dirty) {
        for (const seq of groupAudits.get(id) ?? []) { auditCandidates.get(seq)?.delete(id); changedSeqs.add(seq) }
        const records = members.get(id), meta = {}
        for (const record of records) {
          if (record.data.checkpointSeq !== undefined) meta.checkpointSeq = record.data.checkpointSeq
          if (record.data.replacements !== undefined) meta.replacements = record.data.replacements
        }
        const seqs = new Set([meta.checkpointSeq, ...(meta.replacements ?? []).map(item => item.newSeq)].filter(seq => seq !== undefined))
        if (seqs.size) groupAudits.set(id, seqs); else groupAudits.delete(id)
        for (const seq of seqs) {
          let candidates = auditCandidates.get(seq)
          if (!candidates) { candidates = new Map(); auditCandidates.set(seq, candidates) }
          candidates.set(id, records[0]); changedSeqs.add(seq)
        }
      }
      for (const seq of changedSeqs) {
        let owner, first
        const candidates = auditCandidates.get(seq)
        for (const [id, record] of candidates ?? []) if (!first || compareDiagnosticRecords(record, first) < 0) { first = record; owner = id }
        if (!candidates?.size) auditCandidates.delete(seq)
        if (auditOwners.get(seq) === owner) continue
        if (owner === undefined) auditOwners.delete(seq); else auditOwners.set(seq, owner)
        if (checkpoints.has(seq)) affected.add(checkpoints.get(seq))
      }
    }
    for (const event of added) {
      if (event.type === 'compaction/summary') {
        summaries.set(event.data.compactionId, event)
        for (const checkpoint of byTransaction.get(event.data.compactionId)?.values() ?? []) dirty.add(checkpointGroups.get(checkpoint.seq))
      } else if (event.type === 'user/message' && isCheckpointSource(event.data.source) && event.surfaceOp?.op === 'replace') {
        checkpoints.set(event.seq, event)
        const transactionId = event.data.source.compactionId
        let bucket = byTransaction.get(transactionId)
        if (!bucket) { bucket = new Map(); byTransaction.set(transactionId, bucket) }
        bucket.set(event.seq, event); affected.add(event)
      }
    }
    for (const event of affected) assign(event, dirty)
    for (const id of dirty) {
      const records = members.get(id), events = [...(groupCheckpoints.get(id)?.values() ?? [])].sort((a, b) => a.seq - b.seq)
      if (!records.length && !events.length) { entries.delete(id); continue }
      const at = records.at(-1)?.at ?? events[0].time
      entries.set({ id, order: at ?? 0, materialize: log => materialize(id, records, events, log) })
    }
    return { entries, admission }
  }
}

/** Whole-list query over an explicit shared log; HTTP routes use bounded pages. */
export function contextCareActions(records, session, log) {
  const events = log.select(actionEventTypes)
  const { entries, admission } = createActionIndex()(records, events)
  return { admission, actions: entries.slice(0, entries.size).map(entry => entry.materialize(log)) }
}
