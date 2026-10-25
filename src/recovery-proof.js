/** Durable replacement coverage and frozen-price progress for one failed request. */
export function recoveryProof(session, failed, priceMessages, log, messages) {
  const failedSources = new Set(failed.sourceSeqs)
  const current = new Set(session.surface.nodes)
  const events = [...log.range(failed.logRevision)]
  const bySeq = { get: seq => log.at(seq) }
  function coversFailedSource(event) {
    const pending = [...(event.sourceEventSeqs ?? [])]
    const visited = new Set()
    while (pending.length) {
      const seq = pending.pop()
      if (visited.has(seq)) continue
      visited.add(seq)
      if (failedSources.has(seq) && !current.has(seq)) return true
      pending.push(...(bySeq.get(seq)?.sourceEventSeqs ?? []))
    }
    return false
  }
  const replacements = events.filter(event => event.seq >= failed.logRevision
    && event.surfaceOp?.op === 'replace' && current.has(event.seq) && coversFailedSource(event))
  const before = priceMessages(failed.sourceMessages)
  const after = priceMessages(messages)
  return { progressed: replacements.length > 0 && after < before, before, after,
    replacementSeqs: replacements.map(event => event.seq) }
}
