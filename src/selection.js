import { isCheckpointSource, producedUnder } from './producer-source.js'

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
    if (event.type === 'user/message' && (isCheckpointSource(event.data.source)
      || producedUnder(event.data.source, `${pluginName}:`))) continue
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

/**
 * Select a whole span to clear, keeping only the system head.
 *
 * This is the deep-rest counterpart of {@link selectRestRange}, and it drops
 * that function's two judgments on purpose. There is no retained tail: clearing
 * does not need recent context to survive, because the replacement is the
 * model's own handoff rather than a summary that has to stay under the span's
 * price. There is likewise no `minFreshTokens` gate — a span is worth clearing
 * whenever it exists, since the replacement is always smaller than what it
 * replaces. What both share is the tool-batch edge rule: the cut has to land
 * where every tool call is answered.
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
