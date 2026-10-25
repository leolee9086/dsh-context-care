import { extractRawBlocks, walkContentBlocks, parseToolArguments } from '@leolee9086/dsh-session-blocks'

/** Durable turn identities come from turn/start events, including inherited events after forks. */
export function sessionTurn(session, log) {
  const event = log.last('turn/start')
  return event ? `${session.id}:turn:${event.data.turn ?? event.seq}` : `${session.id}:seed`
}
/** Borrow chronological raw blocks from the Host's shared surface projection. */
export function originalSessionBlocks(session, history) {
  return history.projectSurface(session, originalSessionBlocks, ({ event, turnId }) =>
    event.type === 'turn/start' ? [] : extractRawBlocks(event, { sessionId: String(session.id), turnId }))
}
/** Traverse request data using already indexed native origins; never interpret a Session here. */
export function modelRequestBlocks(sessionId, request, requestId, shared, currentTurn) {
  const origins = shared.byId
  const blocks = []
  function append(message, messageIndex, origin) {
    const appendBlock = (raw, ref) => {
      const text = ['text', 'reasoning'].includes(ref.type) && typeof raw.text === 'string' ? raw.text : undefined
      blocks.push({ ...ref, id: origin ? `${sessionId}#${origin.event.seq}#${ref.path}` : `${sessionId}#request:${requestId}#${messageIndex}#${ref.path}`,
        sessionId: String(sessionId), seq: origin?.event.seq, messageId: message.id ?? `request:${requestId}:${messageIndex}`,
        turnId: origin?.turnId ?? currentTurn, role: message.role, view: 'model', text, raw: structuredClone(raw),
        ...(ref.type === 'tool-call' ? parseToolArguments(raw.arguments) : {}),
        signed: ref.type === 'reasoning' && (raw.signature !== undefined || raw.opaque !== undefined || raw.encrypted !== undefined || message.source?.replayState !== undefined),
        path: ref.path, messageIndex, source: message.source ? structuredClone(message.source) : undefined })
    }
    if (message.role === 'tool') appendBlock({ type: 'tool-result', callId: message.toolCallId, content: structuredClone(message.content), isError: message.isError },
      { path: '$result', parentPath: null, type: 'tool-result', callId: message.toolCallId })
    walkContentBlocks(message.content, appendBlock, '', message.toolCallId)
  }
  if (typeof request.system === 'string' && request.system.length) {
    append({ role: 'system', id: 'request-system', content: [{ type: 'text', text: request.system }] }, -1, shared.system)
  }
  request.messages.forEach((message, i) => append(message, i, origins.get(message.id)))
  return blocks
}
/** Set a content path on an owned request copy. */
export function setRequestBlock(request, block, value) {
  if (block.messageIndex === -1) { if (value === undefined) throw new Error('request-system-filter-denied'); request.system = value.text; return }
  let content = request.messages[block.messageIndex].content
  const indices = block.path.split('.').map(Number)
  for (const index of indices.slice(0, -1)) content = content[index].content
  const index = indices.at(-1)
  if (value === undefined) content.splice(index, 1)
  else content[index] = value
}
