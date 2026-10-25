import { extractRawBlocks, walkContentBlocks, parseToolArguments } from '@leolee9086/dsh-session-blocks'

/** Durable turn identities come from turn/start events, including inherited events after forks. */
export function sessionTurn(session, log) {
  const event = log ? log.last('turn/start') : session.snapshotEvents().findLast(event => event.type === 'turn/start')
  return event ? `${session.id}:turn:${event.data.turn ?? event.seq}` : `${session.id}:seed`
}
function surfaceEvents(session, log) {
  if (!log) {
    const active = new Set(session.surface.nodes)
    return session.snapshotEvents().filter(event => event.type === 'turn/start' || active.has(event.seq))
  }
  return [...log.select(['turn/start']), ...session.surface.nodes.map(seq => log.at(seq))]
    .sort((a, b) => a.seq - b.seq)
}
export function originalSessionBlocks(session, log) {
  let turnId = `${session.id}:seed`
  const blocks = []
  for (const event of surfaceEvents(session, log)) {
    if (event.type === 'turn/start') { turnId = `${session.id}:turn:${event.data.turn ?? event.seq}`; continue }
    blocks.push(...extractRawBlocks(event, { sessionId: String(session.id), turnId }))
  }
  return blocks
}
/** Associate model messages by their public message id; transient request-only input never receives an invented committed seq. */
export function modelRequestBlocks(session, request, requestId, log) {
  const origins = new Map()
  let turnId = `${session.id}:seed`
  for (const event of surfaceEvents(session, log)) {
    if (event.type === 'turn/start') { turnId = `${session.id}:turn:${event.data.turn ?? event.seq}`; continue }
    const message = session.deriveEventMessage(event)
    if (message) origins.set(message.id, { event, turnId, message })
  }
  const blocks = []
  const currentTurn = sessionTurn(session, log)
  function append(message, messageIndex, origin) {
    const appendBlock = (raw, ref) => {
      const text = ['text', 'reasoning'].includes(ref.type) && typeof raw.text === 'string' ? raw.text : undefined
      blocks.push({ ...ref, id: origin ? `${session.id}#${origin.event.seq}#${ref.path}` : `${session.id}#request:${requestId}#${messageIndex}#${ref.path}`,
        sessionId: String(session.id), seq: origin?.event.seq, messageId: message.id ?? `request:${requestId}:${messageIndex}`,
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
    const origin = [...origins.values()].find(value => value.message.role === 'system')
    append({ role: 'system', id: 'request-system', content: [{ type: 'text', text: request.system }] }, -1, origin)
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
