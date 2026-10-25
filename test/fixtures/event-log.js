/**
 * Explicit immutable test data for pure event consumers, not a Session service.
 * Native integration cases use ensureSessionLog on the real Loader context.
 * @template {{seq: number, type: string}} T
 * @param {readonly T[]} events
 * @param {number} inheritedEventCount
 */
export function eventLog(events, inheritedEventCount = 0) {
  const bySeq = new Map(events.map(event => [event.seq, event]))
  const length = events.reduce((end, event) => Math.max(end, event.seq + 1), 0)
  return { owner: events, inheritedEventCount, length,
    all: async () => events,
    at: (/** @type {number} */ seq) => bySeq.get(seq),
    range: (from = 0, to = length) => events.filter(event => event.seq >= from && event.seq < to),
    last: (/** @type {string | readonly string[]} */ type, before = length) => events.findLast(event => (typeof type === 'string' ? event.type === type : type.includes(event.type)) && event.seq < before),
    select: (/** @type {readonly string[]} */ types, from = 0, to = length) => events.filter(event => types.includes(event.type) && event.seq >= from && event.seq < to),
  }
}
