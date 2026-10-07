import { z } from 'zod'
import { requestFingerprint } from './request-journal.js'

/** Completion wording observations are distinct from verified task completion. */
export const COMPLETION_NOTICES_DOMAIN = {
  name: 'context_care_completion_notices', version: 1, layout: 'per-record',
  tables: { notices: { valueSchema: z.object({ sessionId: z.string(), eventSeq: z.number().int().nonnegative(),
    route: z.object({ provider: z.string(), model: z.string() }).strict(), label: z.string(), line: z.string(),
    deliveries: z.number().int().nonnegative(), maxDeliveries: z.number().int().positive(),
    status: z.enum(['pending', 'delivery-unknown', 'dispatched', 'superseded']), callId: z.string().optional(),
  }).strict() }, processed: { valueSchema: z.number().int().nonnegative() } },
}

/** Open a replayable, bounded-delivery notice outbox. The caller serializes writes. */
export async function openCompletionNotices(storageDomain) {
  const handle = await storageDomain.open(COMPLETION_NOTICES_DOMAIN)
  const table = handle.table('notices')
  const values = new Map(table.entries())
  async function save(key, value) { await table.put(key, value); values.set(key, value) }
  async function publish(session, eventSeq, route, candidate, maxDeliveries) {
    const key = requestFingerprint({ sessionId: session.id, eventSeq })
    if (values.has(key)) return
    await save(key, { sessionId: String(session.id), eventSeq, route: { provider: route.provider, model: route.model },
      ...candidate, deliveries: 0, maxDeliveries, status: 'pending' })
  }
  function collect(session, request) {
    if ((request.purpose ?? 'conversation') !== 'conversation') return []
    return [...values].filter(([, value]) => value.sessionId === String(session.id)
      && ['pending', 'delivery-unknown'].includes(value.status) && value.deliveries < value.maxDeliveries
      && value.route.provider === request.provider && value.route.model === request.model)
      .sort((a, b) => b[1].eventSeq - a[1].eventSeq).slice(0, 1).map(([key, value]) => ({
      ruleId: 'completion-observation', version: '1', trigger: 'completion', provider: request.provider, model: request.model,
      purpose: 'conversation', sourceSeqs: [value.eventSeq], completionKey: key,
      text: `上一份输出使用了“${value.label}”等完成表述。它是输出措辞的观察结果。请依据实际请求、交付内容和验证记录核对完成范围；若仍有已授权工作，继续完成。`,
    }))
  }
  async function reserve(session, segments, callId) {
    for (const segment of segments.filter(value => value.completionKey !== undefined)) {
      const old = values.get(segment.completionKey)
      await save(segment.completionKey, { ...old, deliveries: old.deliveries + 1, status: 'delivery-unknown', callId })
    }
  }
  async function dispatched(session, segments, callId, request) {
    if ((request.purpose ?? 'conversation') !== 'conversation') return
    const sent = new Set(segments.map(segment => segment.completionKey))
    for (const [key, old] of values) {
      if (old.sessionId !== String(session.id) || !['pending', 'delivery-unknown'].includes(old.status)) continue
      // Only the most recent notice is useful on this natural request. Older
      // notices must not reappear on successive turns after this one dispatches.
      await save(key, { ...old, callId, status: sent.has(key) ? 'dispatched' : 'superseded' })
    }
  }
  const processed = handle.table('processed')
  return { publish, collect, reserve, dispatched,
    seen: (session, seq) => (processed.get(requestFingerprint(String(session.id))) ?? -1) >= seq,
    async mark(session, seq) { await processed.put(requestFingerprint(String(session.id)), seq) },
    list: () => [...values.values()], close: () => handle.close() }
}
