import { isCheckpointSource, producedUnder } from './producer-source.js'
import { summaryCandidates } from './summary-request.js'

/**
 * Rank balanced prefixes by fresh work, adjacent checkpoint merge, then the
 * pressure fallback. target-prefix selects the smallest predicted covering span.
 * @param session current Session
 * @param measurement operation-frozen node prices
 * @param policy retention, freshness, deficit and checkpoint prediction
 * @returns selected proposal with comparison records, or null without a prefix
 */
export function selectMaintenanceRange(session, measurement, policy) {
  const range = selectRestRange(session, measurement, policy.retainTokens, 0, policy.pluginName)
  if (range === null) return null
  const tokens = new Map(measurement.nodes.map(node => [node.seq, node.tokens]))
  const proposals = summaryCandidates(session, range, measurement, 0, policy.pluginName).map(seqs => {
    let freshTokens = 0
    let checkpoints = 0
    let onlyCheckpoints = true
    for (const seq of seqs) {
      const event = session.eventAt(seq)
      if (event.type === 'user/message' && isCheckpointSource(event.data.source)) { checkpoints++; continue }
      if (event.type === 'system/message' || (event.type === 'user/message' && producedUnder(event.data.source, `${policy.pluginName}:`))) continue
      onlyCheckpoints = false
      freshTokens += tokens.get(seq)
    }
    const rule = freshTokens >= policy.minFreshTokens ? 'fresh-summary' : onlyCheckpoints && checkpoints >= 2 ? 'checkpoint-merge' : 'basic-prefix'
    const rangeCost = seqs.reduce((sum, seq) => sum + tokens.get(seq), 0)
    const expectedSaving = rangeCost - (policy.expectedCheckpointTokens ?? 0)
    return { start: seqs[0], end: seqs.at(-1), sourceSeqs: seqs, rule, freshTokens, checkpoints, rangeCost,
      expectedSaving, coversDeficit: expectedSaving >= (policy.deficitTokens ?? 0), summaryCallCount: 1,
      stableKey: `${rule}:${seqs[0]}:${seqs.at(-1)}`, minFreshTokens: rule === 'fresh-summary' ? policy.minFreshTokens : 0 }
  })
  const loss = { 'fresh-summary': 1, 'checkpoint-merge': 2, 'basic-prefix': 3 }
  proposals.sort((a, b) => loss[a.rule] - loss[b.rule] || (policy.rangeStrategy === 'target-prefix'
    ? Number(b.coversDeficit) - Number(a.coversDeficit) || (a.coversDeficit ? a.rangeCost - b.rangeCost : b.expectedSaving - a.expectedSaving)
    : b.rangeCost - a.rangeCost) || a.summaryCallCount - b.summaryCallCount || a.stableKey.localeCompare(b.stableKey))
  // Pure status prefixes have no task material or mergeable checkpoints.
  const useful = proposals.filter(proposal => (proposal.freshTokens > 0 || proposal.checkpoints > 0)
    && (policy.allowFallback !== false || proposal.rule !== 'basic-prefix'))
  if (useful.length === 0) return null
  return { ...useful[0], comparisons: useful }
}

/** Select a balanced prefix, retaining a recent tail and refusing summary-only recompression. */
export function selectRestRange(session, measurement, retainTokens, minFreshTokens, pluginName) {
  const nodes = measurement.nodes
  const surface = session.surface.nodes
  if (nodes.length !== surface.length || nodes.some((node, index) => node.seq !== surface[index])) {
    throw new Error('context-care: token measurement does not match the current history')
  }
  let keep = nodes.length
  let retained = 0
  for (let index = nodes.length - 1; index >= 0; index--) {
    keep = index
    retained += nodes[index].tokens
    if (retained >= retainTokens) break
  }
  // Select a cut only after a complete tool batch in the injected history view.
  // This is the plugin's range policy; the injected compaction service owns execution.
  let pending = 0
  let balancedKeep = 0
  for (let index = 0; index < keep; index++) {
    const event = session.eventAt(surface[index])
    if (!event) throw new Error('context-care: missing history event')
    if (event.type === 'assistant/message') pending += event.data.message.content.filter(block => block.type === 'tool-call').length
    if (event.type === 'tool/result') pending--
    if (pending < 0) throw new Error('context-care: tool result without a preceding call')
    if (pending === 0) balancedKeep = index + 1
  }
  keep = balancedKeep
  if (keep === 0) return null

  // The protected system head is not part of the candidate. Later system
  // occurrences still cost input tokens, but none count as fresh task work.
  const head = session.eventAt(surface[0])
  const from = head?.type === 'system/message' ? 1 : 0
  if (from >= keep) return null
  let fresh = 0
  for (let index = from; index < keep; index++) {
    const event = session.eventAt(nodes[index].seq)
    if (!event) throw new Error('context-care: missing history event')
    if (event.type === 'system/message') continue
    if (event.type === 'user/message' && (isCheckpointSource(event.data.source)
      || producedUnder(event.data.source, `${pluginName}:`))) continue
    fresh += nodes[index].tokens
  }
  if (fresh < minFreshTokens) return null

  return { start: surface[from], end: surface[keep - 1] }
}

/**
 * Select a whole span to clear, keeping only the system head.
 *
 * Deep rest retains no tail and applies no fresh-content threshold. Its executor
 * prices the complete handoff and rejects replacements no smaller than the selected
 * span before opening the transaction. The cut includes only complete tool batches.
 *
 * @param session - session whose current surface is being cleared.
 * @returns inclusive surface seq span and its complete node list, or `null`.
 */
export function selectClearRange(session) {
  const surface = session.surface.nodes
  if (surface.length === 0) return null
  // The system prompt lives at surface node 0 and is the one node a replacement
  // may not shadow: `assertSystemHeadRewrite` in core/session/src/surface.ts
  // rejects any replace whose startIdx is 0 while that node is a `system/message`.
  // Starting at 1 keeps the prompt — clearing the history must not clear the rules.
  // Later system nodes carry no such protection, so they are clearable like any other.
  const head = session.eventAt(surface[0])
  const from = head?.type === 'system/message' ? 1 : 0
  let pending = 0
  let balancedEnd = -1
  for (let index = from; index < surface.length; index++) {
    const event = session.eventAt(surface[index])
    if (!event) throw new Error('context-care: missing history event')
    if (event.type === 'assistant/message') {
      pending += event.data.message.content.filter(block => block.type === 'tool-call').length
    }
    if (event.type === 'tool/result') pending--
    if (pending < 0) throw new Error('context-care: tool result without a preceding call')
    if (pending === 0) balancedEnd = index
  }
  if (balancedEnd < from) return null
  return {
    start: surface[from],
    end: surface[balancedEnd],
    shadowedSeqs: surface.slice(from, balancedEnd + 1),
  }
}
