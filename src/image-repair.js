/**
 * Adapt structured stream failures after the public recovery listeners delegate.
 * The installed image projection owns validation and replay; this adapter only
 * selects oldest retained input occurrences inside this failed summary span.
 * @param sessions public sessions service with installed message projections
 * @param payload public summary-error payload
 * @returns true only after recording a new selected-span image omission
 */
export function repairSummaryImages(sessions, { session, sourceEventSeqs, error, signal }) {
  const failure = error?.failure
  if (failure?.code !== 'IMAGE_OFFLOAD_REQUIRED' || error.code !== failure.code
    || !Number.isSafeInteger(failure.offloadImages) || failure.offloadImages <= 0
    || !sessions.messageProjections.some(projection => projection.type === 'image/offload')) return false
  signal?.throwIfAborted()
  let remaining = failure.offloadImages
  const targets = []
  for (const seq of sourceEventSeqs) {
    if (remaining === 0) break
    const event = session.eventAt(seq)
    if (!['user/message', 'tool/result'].includes(event.type)) continue
    const message = session.deriveEventMessage(event)
    const imageIndexes = []
    let index = 0
    for (const block of message.content) {
      if (block.type !== 'image') continue
      if (remaining > 0 && block.offloaded !== true) { imageIndexes.push(index); remaining-- }
      index++
    }
    if (imageIndexes.length) targets.push({ seq, imageIndexes })
  }
  if (!targets.length) return false
  session.append('image/offload', { targets })
  return true
}
