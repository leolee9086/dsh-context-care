import { z } from 'zod'
import { createHash } from 'node:crypto'

/** Durable request and maintenance records belong to the Host plugin, not Session types. */
export const REQUEST_JOURNAL_DOMAIN = {
  name: 'context_care_requests', version: 1, layout: 'per-record',
  tables: { records: { valueSchema: z.object({ version: z.literal(1), sessionId: z.string(), kind: z.enum(['request', 'maintenance']),
    at: z.number().int().nonnegative(), data: z.json() }).strict() } },
}

/** Hash the JSON-visible request projection; process-local functions and signals are excluded by callers. */
export function requestFingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

/**
 * Open a Host-owned journal. Per-session writes serialize, and flush reports
 * the original storage failure even when an emitted event cannot await it.
 * @param options storage-domain provider, clock and write-failure reporter
 * @returns durable put/list/flush/close methods after opening acknowledgement
 */
export async function openRequestJournal({ storageDomain, now = () => Date.now(), report = () => {} }) {
  const handle = await storageDomain.open(REQUEST_JOURNAL_DOMAIN)
  const table = handle.table('records')
  // Storage tables may mutate their in-memory entries before the durable ACK.
  // Readers see detached acknowledged records, never a pending or rejected put.
  const acknowledged = new Map([...table.entries()].map(([key, value]) => [key, structuredClone(value)]))
  const chains = new Map()
  const errors = new Map()
  function put(key, sessionId, kind, data) {
    // Detach all records from mutable request callbacks before queuing an ACK.
    const value = JSON.parse(JSON.stringify({ version: 1, sessionId: String(sessionId), kind, at: now(), data }))
    const task = (chains.get(value.sessionId) ?? Promise.resolve()).then(async () => {
      await table.put(key, structuredClone(value))
      acknowledged.set(key, value)
    })
    chains.set(value.sessionId, task)
    task.catch(error => { errors.set(value.sessionId, error); report(error) })
    return task
  }
  async function flush(sessionId) {
    await Promise.all([...chains].filter(([id]) => sessionId === undefined || id === String(sessionId)).map(([, task]) => task))
    for (const [id, error] of errors) if (sessionId === undefined || id === String(sessionId)) throw error
  }
  return {
    put, flush,
    list: sessionId => [...acknowledged].filter(([, value]) => sessionId === undefined || value.sessionId === String(sessionId)).map(([key, value]) => ({ key, ...structuredClone(value) }))
      .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    async close() { try { await flush() } finally { await handle.close() } },
  }
}
