/** Bounded, request-local text evidence. No stream identity pretends to be a committed seq/path. */
export function createDeltaProjection({ sessionId, requestId, attemptId, turnId, maxChars = 32768, maxBlocks = 128 }) {
  const blocks = new Map(); const fired = new Set(); let policy; let ended = false
  const identity = index => JSON.stringify([sessionId, requestId, attemptId, index])
  return {
    feed(chunk, currentPolicy) {
      if (ended) throw new Error('delta-projection-ended')
      // A preference/source/variable change starts a new detection boundary. Text
      // received while disabled cannot complete a match after re-enabling.
      if (policy !== currentPolicy) { blocks.clear(); policy = currentPolicy }
      if (chunk.type === 'finish') { blocks.clear(); ended = true; return [] }
      if (chunk.type === 'block-end') { blocks.delete(chunk.index); return [] }
      if (!['text-delta', 'reasoning-delta'].includes(chunk.type)) return []
      if (!Number.isSafeInteger(chunk.index) || chunk.index < 0 || typeof chunk.text !== 'string') throw new Error('delta-chunk-invalid')
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
      const previous = blocks.get(chunk.index)
      if (previous && previous.type !== type) throw new Error('delta-block-type-changed')
      if (!previous && blocks.size >= maxBlocks) throw new Error('delta-block-budget-exceeded')
      const text = (previous?.text ?? '') + chunk.text
      // Fail explicitly rather than dropping a prefix and changing regex anchors.
      if (text.length > maxChars) throw new Error('delta-text-budget-exceeded')
      blocks.set(chunk.index, { text, type })
      return ['original', 'model'].map(view => ({ id: JSON.stringify([identity(chunk.index), view]),
        sessionId, requestId, attemptId, blockKey: chunk.index, messageId: JSON.stringify([requestId, attemptId]), turnId,
        role: 'assistant', view, type, text, raw: { type, text } }))
    },
    finalize(index) {
      if (ended) return []
      return [...blocks].filter(([key]) => index === undefined || key === index).flatMap(([key, value]) => ['original', 'model'].map(view => ({
        id: JSON.stringify([identity(key), view]), sessionId, requestId, attemptId, blockKey: key,
        messageId: JSON.stringify([requestId, attemptId]), turnId, role: 'assistant', view,
        ...value, raw: { type: value.type, text: value.text }, detectorPhase: 'finalize',
      })))
    },
    unseen(events) {
      // One rule occurrence per stream block. Growing captures must not enqueue
      // another abort/notice on every token, including dedupe:none declarations.
      return events.filter(event => !fired.has(JSON.stringify([event.sourceId, event.ruleId, event.ruleRevision, event.blockId])))
    },
    acknowledge(events) {
      for (const event of events) fired.add(JSON.stringify([event.sourceId, event.ruleId, event.ruleRevision, event.blockId]))
    },
    close() { blocks.clear(); fired.clear(); ended = true },
  }
}
