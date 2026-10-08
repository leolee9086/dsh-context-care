import { createHash, randomUUID } from 'node:crypto'
import { recordSecondaryFailure } from './secondary-failure.js'
import { producedUnder } from './producer-source.js'

/**
 * Suppress a proven non-shrinking proposal until its selected task material,
 * effective prices or route policy changes. Durable failed decisions survive
 * reload; status and log-only growth cannot reset them.
 * @param requests request journal service
 * @param compact summary executor
 * @returns proposal execution returning null for an unchanged useless proposal
 */
export function createProposalExecutor(requests, compact) {
  return async function execute(service, proposal, agent, signal, operation, spec, reason) {
    const session = agent.session
    const seqs = proposal.sourceSeqs.filter(seq => {
      const event = session.eventAt(seq)
      return !(event.type === 'user/message' && producedUnder(event.data.source, 'dsh-context-care:'))
    })
    const messages = seqs.map(seq => session.deriveEventMessage(session.eventAt(seq)))
    const key = createHash('sha256').update(JSON.stringify({ sources: seqs, messages,
      prices: messages.map(message => operation.priceMessages([message])), header: operation.pricingBasis.header,
      summary: spec.summary ?? service.config, prompts: spec.modelScopedPrompts })).digest('hex')
    if (requests.list(session.id).some(record => record.kind === 'maintenance'
      && record.data.proposalKey === key && record.data.phase === 'no-useful-range')) return null
    const audit = { operationId: randomUUID(), reason, proposalKey: key, rule: proposal.rule, comparisons: proposal.comparisons }
    await requests.recordAction(session, { ...audit, action: 'selection', phase: 'planning', sourceSeqs: proposal.sourceSeqs })
    try { return await compact(service, proposal, agent, signal, operation, undefined, audit) }
    catch (error) {
      if (['SUMMARY_NOT_SMALLER', 'SUMMARY_INPUT_BUDGET', 'SUMMARY_EMPTY'].includes(error.code)) {
        try {
          await requests.recordAction(session, { ...audit, action: 'summary', phase: 'no-useful-range', proposalKey: key,
            rule: proposal.rule, sourceSeqs: proposal.sourceSeqs, failure: { code: error.code, message: error.message } })
        } catch (journalError) {
          // The journal flush reports this error; the original summary failure wins.
          recordSecondaryFailure(error, journalError, 'selection audit')
        }
      } else {
        try {
          await requests.recordAction(session, { ...audit, action: 'summary', phase: 'failed', sourceSeqs: proposal.sourceSeqs,
            failure: { code: error.code, message: error instanceof Error ? error.message : String(error) } })
        } catch (journalError) { recordSecondaryFailure(error, journalError, 'selection audit') }
      }
      throw error
    }
  }
}
