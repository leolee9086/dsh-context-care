import { extractRawBlocks, walkContentBlocks, parseToolArguments } from './vendor/session-query/blocks.js'

/** Durable turn identities come from turn/start events, including inherited events after forks. */
export function sessionTurn(session) {
  const event = session.snapshotEvents().findLast(event => event.type === 'turn/start')
  return event ? `${session.id}:turn:${event.data.turn ?? event.seq}` : `${session.id}:seed`
}
export function originalSessionBlocks(session) {
  const events = session.snapshotEvents()
  const active = new Set(session.surface.nodes)
  let turnId = `${session.id}:seed`
  const blocks = []
  for (const event of events) {
    if (event.type === 'turn/start') turnId = `${session.id}:turn:${event.data.turn ?? event.seq}`
    if (active.has(event.seq)) blocks.push(...extractRawBlocks(event, { sessionId: String(session.id), turnId }))
  }
  return blocks
}
/** Associate model messages by their public message id; transient request-only input never receives an invented committed seq. */
export function modelRequestBlocks(session, request, requestId) {
  const origins = new Map()
  let turnId = `${session.id}:seed`
  for (const event of session.snapshotEvents()) {
    if (event.type === 'turn/start') turnId = `${session.id}:turn:${event.data.turn ?? event.seq}`
    if (!session.surface.nodes.includes(event.seq)) continue
    const message = session.deriveEventMessage(event)
    if (message) origins.set(message.id, { event, turnId, message })
  }
  const blocks = []
  const currentTurn = sessionTurn(session)
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
