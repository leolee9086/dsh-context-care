

/** 从原生 turn/start 取得持久轮次序号。 */
export function entryTurn(session, log) {
  const event = log.last('turn/start')
  if (!event) return 0
  if (!Number.isSafeInteger(event.data.turn) || event.data.turn < 0) throw new Error('entry-turn-unavailable')
  return event.data.turn
}
