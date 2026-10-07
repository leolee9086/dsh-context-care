import { isCheckpointSource } from './producer-source.js'

/**
 * Derive content leaves and checkpoint depth from the durable event graph.
 * Log-only transaction references are not leaves; prune replacements follow
 * their original content references. The local cache lasts for this read.
 * @param session Session containing original and replacement events
 * @param seq checkpoint or ordinary content event sequence
 * @returns ordered unique leaves, direct checkpoint parents and processing depth
 */
export function checkpointCoverage(session, seq) {
  const events = new Map(session.snapshotEvents().map(event => [event.seq, event]))
  const summaries = new Map([...events.values()].filter(event => event.type === 'compaction/summary').map(event => [event.data.compactionId, event]))
  const cache = new Map()
  function visit(source, visiting = new Set()) {
    if (cache.has(source)) return cache.get(source)
    const event = events.get(source)
    if (!event || visiting.has(source)) return { leafSeqs: [], parentCheckpointSeqs: [], depth: 0 }
    const checkpoint = event.type === 'user/message' && isCheckpointSource(event.data.source)
    const summary = checkpoint ? summaries.get(event.data.source.compactionId) : undefined
    const sources = summary?.data.shadowedSeqs ?? (event.surfaceOp?.op === 'replace' ? event.sourceEventSeqs ?? [] : [])
    const contents = sources.filter(id => ['user/message', 'assistant/message', 'tool/result', 'system/message'].includes(events.get(id)?.type))
    const next = new Set([...visiting, source])
    const parents = contents.filter(id => {
      const parent = events.get(id)
      return parent.type === 'user/message' && isCheckpointSource(parent.data.source)
    })
    const children = contents.map(id => visit(id, next))
    const result = { leafSeqs: contents.length ? [...new Set(children.flatMap(child => child.leafSeqs))] : [source],
      parentCheckpointSeqs: parents, depth: checkpoint ? 1 + Math.max(0, ...children.map(child => child.depth)) : Math.max(0, ...children.map(child => child.depth)) }
    cache.set(source, result)
    return result
  }
  return visit(seq)
}
