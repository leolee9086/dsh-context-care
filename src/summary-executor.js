import { randomUUID } from 'node:crypto'
import { recordSecondaryFailure } from './secondary-failure.js'
import { runMaintenance } from './maintenance-journal.js'
import { isDeepStrictEqual } from 'node:util'
import { createUserMessage } from './message.js'
import { CHECKPOINT_KIND } from './producer-source.js'
import { inspectSession } from './deep-rest.js'
import { rebaseSummaryRepair } from './summary-repair.js'
import { checkpointCoverage } from './checkpoint-coverage.js'
import { buildSummaryRequest, frameSummary, summaryCandidates, summaryConfig, summaryPricing } from './summary-request.js'

function failure(message, code) { return Object.assign(new Error(message), { code }) }

/** Consume authoritative final blocks; deltas supply text only until block-end arrives. */
async function collectSummary(stream, signal) {
  const blocks = new Map()
  let finish
  let usage
  for await (const chunk of stream) {
    signal.throwIfAborted()
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
      const previous = blocks.get(chunk.index)
      blocks.set(chunk.index, { type, text: (previous?.text ?? '') + chunk.text })
    } else if (chunk.type === 'block-end') blocks.set(chunk.index, chunk.block)
    else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  signal.throwIfAborted()
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    throw Object.assign(failure(finish.failure.message, finish.failure.code), { failure: finish.failure })
  }
  if (finish?.kind === 'max-tokens') throw failure('context-care: summary truncated at its output cap', 'MAX_TOKENS')
  if (finish === undefined) throw failure('context-care: summary stream ended without a terminal finish', 'SUMMARY_INCOMPLETE')
  const rawOutput = [...blocks].sort(([a], [b]) => a - b).map(([, block]) => block)
  if (rawOutput.some(block => !['text', 'reasoning'].includes(block.type))) throw failure('context-care: summary must contain text, without tools or attachments', 'UNSUPPORTED_CONTENT')
  const summary = rawOutput.filter(block => block.type === 'text')
  if (!summary.some(block => block.text.trim())) throw failure('context-care: summary produced no text', 'SUMMARY_EMPTY')
  return { summary, rawOutput, ...(usage === undefined ? {} : { usage }) }
}

/**
 * Serialize summaries by Session and commit only a smaller complete replacement.
 * The public provider configuration supplies routed LLM settings. Providers with
 * no such configuration keep compactRegion unless explicit summary settings exist.
 * @param deps injected services, validated policy and optional explicit settings
 * @returns async compact(service, range, agent, signal, operation, request?) executor
 */
export function createSummaryExecutor({ meter, llm, requests, spec, recover = () => false }) {
  const active = new WeakMap()
  async function run(service, range, agent, signal, operation, envelope, audit = {}) {
    const session = agent.session
    const recordAction = data => requests.recordAction(session, { ...audit, ...data })
    const config = summaryConfig(service, agent, spec.summary)
    if (config === undefined) return runMaintenance({ requests, session, pricing: operation, action: 'summary', reason: audit.reason,
      operationId: audit.operationId, details: audit, run: () => service.compactRegion(range.start, range.end, agent, signal) })
    signal.throwIfAborted()
    const { openTurn, unmatchedCompactionStart } = inspectSession(session)
    if (unmatchedCompactionStart !== undefined) throw failure('context-care: another compaction is already open', 'COMPACTION_BUSY')
    let surface = [...session.surface.nodes]
    let messages = structuredClone(session.deriveMessages())
    const header = structuredClone(session.requestHeader())
    function assertStable() {
      signal.throwIfAborted()
      if (!isDeepStrictEqual(session.surface.nodes, surface) || !isDeepStrictEqual(session.deriveMessages(), messages)
        || !isDeepStrictEqual(session.requestHeader(), header)) throw failure('context-care: summary input changed before commit', 'SUMMARY_SURFACE_CHANGED')
    }
    let measured = operation.measure()
    let candidates = summaryCandidates(session, range, measured, range.minFreshTokens ?? spec.minFreshTokens, 'dsh-context-care')
    const original = envelope ?? { messages, tools: operation.pricingBasis.header?.tools }
    const pending = original.messages.slice(messages.length)
    const before = operation.priceRequest(original)
    const compactionId = randomUUID()
    const start = session.append('compaction/start', { compactionId, turn: openTurn })
    let candidateIndex = 0
    let lastError
    let closed = false
    try {
      await recordAction({ action: 'summary', phase: 'started', compactionId, range, beforeInput: before,
        pricingBasis: operation.pricingBasis, summaryConfig: config })
      let overflowRetries = 0
      let repairs = 0
      let calls = 0
      for (;;) {
        assertStable()
        if (spec.maxSummaryCallsPerAction !== undefined && calls >= spec.maxSummaryCallsPerAction) throw lastError ?? failure('context-care: summary call limit reached', 'SUMMARY_CALL_LIMIT')
        const prepared = await requests.prepareCall({ provider: config.provider, model: config.model, maxTokens: config.maxTokens }, signal)
        let auxiliary
        let seqs
        let request
        try {
          assertStable()
          auxiliary = summaryPricing({ meter, llm, session, prepared, spec, requests })
          for (; candidateIndex < candidates.length; candidateIndex++) {
            seqs = candidates[candidateIndex]
            request = buildSummaryRequest(session, seqs, prepared.config, signal)
            const budget = auxiliary.budgetFor(request)
            if (budget.hardInput === undefined || budget.inputTokens <= budget.hardInput) break
          }
          if (candidateIndex === candidates.length) throw lastError ?? failure('context-care: no balanced fresh prefix fits the complete summary input budget', 'SUMMARY_INPUT_BUDGET')
        } catch (error) {
          // A prepared call rejected locally never reaches stream's release finally.
          requests.release(prepared.callId)
          throw error
        }
        const selectedPrice = auxiliary.pricing.priceRequest(request)
        const repairSnapshot = { seqs, surface: [...surface], header, revision: session.seq,
          outsideMessages: surface.filter(seq => !seqs.includes(seq)).map(seq => structuredClone(session.deriveEventMessage(session.eventAt(seq)))) }
        let result
        try {
          result = await collectSummary(prepared.stream(request), signal)
          const actual = requests.snapshot(prepared.callId)?.ready?.request ?? request
          result = { ...result, provider: actual.provider, model: actual.model, maxTokens: actual.maxTokens }
          await requests.settle(prepared.callId, { outcome: 'completed', usage: result.usage, compactionId })
        } catch (error) {
          try {
            await requests.settle(prepared.callId, { outcome: signal.aborted ? 'interrupted' : 'failed', compactionId,
              failure: { code: error.code, message: error instanceof Error ? error.message : String(error) } })
          } catch (journalError) {
            // flush() retains the storage failure; preserve the stream failure here.
            recordSecondaryFailure(error, journalError, 'summary audit')
          }
          lastError = error
          if (signal.aborted) throw error
          const mayRepair = spec.maxSummaryRepairRetries === undefined || repairs < spec.maxSummaryRepairRetries
          let recovered = false
          if (mayRepair) {
            try { recovered = recover({ session, sourceEventSeqs: seqs, error, signal }) }
            catch (repairError) { recordSecondaryFailure(error, repairError, 'summary repair'); signal.throwIfAborted(); throw error }
          }
          if (recovered) {
            signal.throwIfAborted()
            const rebased = rebaseSummaryRepair(session, repairSnapshot)
            if (rebased === null) throw error
            const repaired = buildSummaryRequest(session, rebased, prepared.config, signal)
            if (auxiliary.pricing.priceRequest(repaired) >= selectedPrice) throw error
            surface = [...session.surface.nodes]
            messages = structuredClone(session.deriveMessages())
            measured = operation.measure()
            candidates = summaryCandidates(session, { start: rebased[0], end: rebased.at(-1) }, measured, 0, 'dsh-context-care')
            candidateIndex = 0
            repairs++
            try {
              await recordAction({ action: 'summary', phase: 'repaired', compactionId,
                oldSourceSeqs: seqs, sourceSeqs: rebased, beforeSummaryInput: selectedPrice, afterSummaryInput: auxiliary.pricing.priceRequest(repaired) })
            } catch (journalError) { recordSecondaryFailure(error, journalError, 'summary audit'); throw error }
            continue
          }
          assertStable()
          if (!['CONTEXT_WINDOW_EXCEEDED', 'REQUEST_BUDGET_EXCEEDED'].includes(error.code) || overflowRetries >= config.maxRetries) throw error
          overflowRetries++
          candidateIndex++
          continue
        } finally {
          // Count actual dispatches, including late provider failures, not local refusals.
          if (requests.snapshot(prepared.callId)?.dispatched === true) calls++
          requests.release(prepared.callId)
        }
        assertStable()
        const replacement = createUserMessage({ content: frameSummary(result.summary), source: { kind: CHECKPOINT_KIND, compactionId,
          contextCareTrace: { producer: 'dsh-context-care', trigger: 'summary', reason: audit.reason, operationId: audit.operationId, sourceSeqs: seqs, callId: prepared.callId } } })
        const from = surface.indexOf(seqs[0])
        const to = surface.indexOf(seqs.at(-1))
        const afterMessages = surface.flatMap((seq, index) => {
          if (index === from) return [replacement]
          if (index > from && index <= to) return []
          const message = session.deriveEventMessage(session.eventAt(seq))
          return message === null ? [] : [message]
        })
        // Pending inputs and one-shot system/tools occur on both sides. Keep them
        // when the caller supplied a fuller final envelope than retained history.
        const after = operation.priceRequest({ ...original, messages: [...afterMessages, ...pending] })
        if (after >= before) throw failure(`context-care: framed summary does not reduce complete input (${after} >= ${before})`, 'SUMMARY_NOT_SMALLER')
        const selected = new Set(seqs)
        const shadowedTokenCount = measured.nodes.filter(node => selected.has(node.seq)).reduce((sum, node) => sum + node.heuristicTokens, 0)
        const shadowedRange = { start: seqs[0], end: seqs.at(-1) }
        await recordAction({ action: 'summary', phase: 'prepared', compactionId, callId: prepared.callId,
          shadowedSeqs: seqs, beforeInput: before, afterInput: after })
        assertStable()
        const summaryEvent = session.append('compaction/summary', { compactionId, ...result, llmStreamCall: true,
          shadowedRange, shadowedSeqs: seqs, shadowedTokenCount })
        const checkpoint = session.append('user/message', replacement, { surfaceOp: { op: 'replace', startSeq: shadowedRange.start, endSeq: shadowedRange.end },
          sourceEventSeqs: [start.seq, summaryEvent.seq, ...seqs] })
        const end = session.append('compaction/end', { compactionId, turn: openTurn })
        closed = true
        await recordAction({ action: 'summary', phase: 'committed', compactionId, summarySeq: summaryEvent.seq,
          endSeq: end.seq, checkpointSeq: checkpoint.seq, coverage: checkpointCoverage(session, checkpoint.seq),
          shadowedSeqs: seqs, beforeInput: before, afterInput: after })
        return { compactionId, startSeq: start.seq, summarySeq: summaryEvent.seq, endSeq: end.seq,
          summary: result.summary, shadowedRange, shadowedSeqs: seqs, shadowedTokenCount, beforeInput: before, afterInput: after }
      }
    } catch (error) {
      if (!closed) {
        try { session.append('compaction/end', { compactionId, turn: openTurn, error: error instanceof Error ? error.message : String(error) }) }
        catch (closeError) {
          // The unmatched durable start remains visible; preserve the primary failure.
          recordSecondaryFailure(error, closeError, 'summary transaction close')
        }
      }
      try {
        await recordAction({ action: 'summary', phase: closed ? 'commit-record-failed' : 'failed', compactionId,
          error: error instanceof Error ? error.message : String(error), secondaryFailures: error.secondaryFailures })
      } catch (journalError) {
        // Audit ACK failures remain observable through flush, without masking this error.
        recordSecondaryFailure(error, journalError, 'summary audit')
      }
      throw error
    }
  }
  return async function compact(service, range, agent, signal, operation, envelope, audit) {
    const previous = active.get(agent.session) ?? Promise.resolve()
    // The previous caller receives its failure. Its settled transaction releases
    // this session for the next independent operation, including after failure.
    const task = previous.catch(error => { void error }).then(() => run(service, range, agent, signal, operation, envelope, audit))
    active.set(agent.session, task)
    try { return await task } finally { if (active.get(agent.session) === task) active.delete(agent.session) }
  }
}
