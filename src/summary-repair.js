import { isDeepStrictEqual } from 'node:util'

/**
 * Rebase a selected span through new durable replacements. Repairs cannot touch
 * outside nodes, alter the header, append task input, or reuse an old rewrite.
 * @param session live Session after the synchronous repair waterfall
 * @param before selected sources, complete surface/messages/header and log revision
 * @returns rebased contiguous selected sequences, or null without valid progress
 */
export function rebaseSummaryRepair(session, before) {
  const selected = new Set(before.seqs)
  const from = before.surface.indexOf(before.seqs[0])
  const to = before.surface.indexOf(before.seqs.at(-1))
  const current = session.surface.nodes
  const prefix = before.surface.slice(0, from)
  const suffix = before.surface.slice(to + 1)
  if (!isDeepStrictEqual(session.requestHeader(), before.header)
    || !isDeepStrictEqual(current.slice(0, prefix.length), prefix)
    || !isDeepStrictEqual(suffix.length === 0 ? [] : current.slice(-suffix.length), suffix)) return null
  const rebased = current.slice(prefix.length, current.length - suffix.length)
  if (rebased.length === 0) return null
  const events = new Map(session.snapshotEvents().map(event => [event.seq, event]))
  function leaves(seq, visiting = new Set()) {
    if (selected.has(seq)) return [seq]
    const event = events.get(seq)
    if (!event || event.seq < before.revision || event.surfaceOp?.op !== 'replace' || visiting.has(seq)) return []
    const next = new Set([...visiting, seq])
    return (event.sourceEventSeqs ?? []).flatMap(source => leaves(source, next))
  }
  const covered = new Set()
  let replaced = false
  for (const seq of rebased) {
    const sources = leaves(seq)
    if (sources.length === 0) return null
    if (!selected.has(seq)) replaced = true
    for (const source of sources) covered.add(source)
  }
  const projectionRepairs = [...events.values()].filter(event => event.seq >= before.revision && event.type === 'image/offload')
  const selectedProjection = projectionRepairs.length > 0 && projectionRepairs.every(event => event.data.targets.length > 0
    && event.data.targets.every(target => selected.has(target.seq)))
  if ((!replaced && !selectedProjection) || before.seqs.some(seq => !covered.has(seq))) return null
  // Projections can change message text without replacing its surface node.
  // Such changes outside the selected span still invalidate this region.
  const outside = [...prefix, ...suffix].map(seq => session.deriveEventMessage(session.eventAt(seq)))
  if (!isDeepStrictEqual(outside, before.outsideMessages)) return null
  return rebased
}
