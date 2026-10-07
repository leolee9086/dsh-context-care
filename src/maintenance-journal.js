import { randomUUID } from 'node:crypto'
import { recordSecondaryFailure } from './secondary-failure.js'

/**
 * A failed maintenance call may leave an earlier replacement committed. Measure
 * both outcomes with the caller's frozen prices and retain that partial progress.
 * Recording an error never replaces the operation's original error; journal
 * failures remain observable through the Host service's flush acknowledgement.
 */
export async function runMaintenance({ requests, session, pricing, action, reason, run }) {
  const operationId = randomUUID()
  const beforeInput = pricing.measure().inputTokens
  const beforeSeq = session.seq
  const sourceSeqs = [...session.surface.nodes]
  const generation = session.surface.replaceGeneration
  const beforeHeuristic = pricing.measure().nodes.reduce((sum, node) => sum + node.heuristicTokens, 0)
  const facts = () => {
    const measured = pricing.measure()
    const events = session.snapshotEvents().filter(event => event.seq >= beforeSeq)
    const replacements = events.filter(event => event.surfaceOp?.op === 'replace').map(event => ({
      newSeq: event.seq, oldStartSeq: event.surfaceOp.startSeq, oldEndSeq: event.surfaceOp.endSeq, sourceSeqs: event.sourceEventSeqs ?? [],
    }))
    const afterInput = measured.inputTokens
    return { afterInput, afterSeq: session.seq, afterGeneration: session.surface.replaceGeneration, replacements,
      summaryTransactions: events.filter(event => event.type === 'compaction/start').map(event => event.data.compactionId),
      routeSaving: beforeInput - afterInput, heuristicSaving: beforeHeuristic - measured.nodes.reduce((sum, node) => sum + node.heuristicTokens, 0),
      progressed: replacements.length > 0 && afterInput < beforeInput }
  }
  const record = data => requests.recordAction(session, { operationId, action, reason, beforeSeq, beforeInput, sourceSeqs,
    beforeGeneration: generation, journalPersisted: true, ...data })
  await record({ phase: 'started', pricingBasis: pricing.pricingBasis })
  let result
  try { result = await run() }
  catch (error) {
    try {
      const result = facts()
      await record({ phase: 'failed', ...result, outcome: result.progressed ? 'partial' : 'failed',
        error: error instanceof Error ? error.message : String(error), secondaryFailures: error.secondaryFailures })
    } catch (journalError) {
      // The journal already reports and retains this failure for flush(). The
      // originating maintenance exception remains the caller's primary result.
      recordSecondaryFailure(error, journalError, 'maintenance audit')
    }
    throw error
  }
  const settled = facts()
  await record({ phase: 'completed', ...settled, outcome: settled.progressed ? 'committed' : 'noop',
    ...(result?.compactionId === undefined ? {} : { compactionId: result.compactionId }) })
  return result
}
