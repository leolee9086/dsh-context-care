import { toolPairingBalancedBefore, isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'

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
  while (keep > 0 && !toolPairingBalancedBefore(session, surface[keep])) keep--
  if (keep === 0) return null

  // A checkpoint plus status messages is not fresh work worth summarizing again.
  let fresh = 0
  for (let index = 0; index < keep; index++) {
    const event = session.eventAt(nodes[index].seq)
    if (!event) throw new Error('context-care: missing history event')
    if (event.type === 'user/message' && (isCompactCheckpointSource(event.data.source)
      || (event.data.source.kind === 'plugin' && (event.data.source.plugin === pluginName
        || event.data.source.plugin.startsWith(`${pluginName}:`))))) continue
    fresh += nodes[index].tokens
  }
  if (fresh < minFreshTokens) return null
  return { start: surface[0], end: surface[keep - 1] }
}
