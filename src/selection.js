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

  // A checkpoint plus status messages is not fresh work worth summarizing again.
  let fresh = 0
  for (let index = 0; index < keep; index++) {
    const event = session.eventAt(nodes[index].seq)
    if (!event) throw new Error('context-care: missing history event')
    if (event.type === 'user/message' && ((event.data.source.kind === 'plugin' && event.data.source.plugin === 'compact')
      || (event.data.source.kind === 'plugin' && (event.data.source.plugin === pluginName
        || event.data.source.plugin.startsWith(`${pluginName}:`))))) continue
    fresh += nodes[index].tokens
  }
  if (fresh < minFreshTokens) return null

  // node 0 may hold the system prompt, and the session surface protects that node: only a
  // `system/message` over exactly that node may rewrite it, so a compaction range starting
  // there is always rejected (see assertSystemHeadRewrite in core/session/src/surface.ts).
  // Start after it instead; later system nodes carry no such protection.
  const head = session.eventAt(surface[0])
  const from = head?.type === 'system/message' ? 1 : 0
  if (from >= keep) return null
  return { start: surface[from], end: surface[keep - 1] }
}
