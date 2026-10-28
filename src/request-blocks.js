import { ownRequestMessageBody } from '@leolee9086/dsh-rule-engine'
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
/** Copy only message-owned JSON; ids, positions and native origins are added per view. */
export function projectRequestMessage(message) {
  const blocks = [], { content, source } = ownRequestMessageBody(message)
  const appendBlock = (raw, ref) => {
    const text = ['text', 'reasoning'].includes(ref.type) && typeof raw.text === 'string' ? raw.text : undefined
    blocks.push({ ...ref, text, raw,
      ...(ref.type === 'tool-call' ? parseToolArguments(raw.arguments) : {}),
      signed: ref.type === 'reasoning' && (raw.signature !== undefined || raw.opaque !== undefined || raw.encrypted !== undefined || source?.replayState !== undefined), source })
  }
  if (message.role === 'tool') appendBlock({ type: 'tool-result', callId: message.toolCallId, content, isError: message.isError },
    { path: '$result', parentPath: null, type: 'tool-result', callId: message.toolCallId })
  walkContentBlocks(content, appendBlock, '', message.toolCallId)
  return blocks
}
/** Traverse request data using indexed origins; cached owned bodies never contain request ids or positions. */
export function modelRequestBlocks(sessionId, request, requestId, shared, currentTurn, projection) {
  const blocks = []
  function append(message, messageIndex, origin, body) {
    for (const ref of body) blocks.push({ ...ref,
      id: origin ? `${sessionId}#${origin.event.seq}#${ref.path}` : `${sessionId}#request:${requestId}#${messageIndex}#${ref.path}`,
      sessionId: String(sessionId), seq: origin?.event.seq, messageId: message.id ?? `request:${requestId}:${messageIndex}`,
      turnId: origin?.turnId ?? currentTurn, role: message.role, view: 'model', messageIndex })
  }
  if (typeof request.system === 'string' && request.system.length) {
    const message = { role: 'system', id: 'request-system', content: [{ type: 'text', text: request.system }] }
    append(message, -1, shared.system, projection ? projection.system(request.system, message) : projectRequestMessage(message))
  }
  request.messages.forEach((message, i) => append(message, i, shared.byId.get(message.id), projection ? projection.read(message) : projectRequestMessage(message)))
  return blocks
}
