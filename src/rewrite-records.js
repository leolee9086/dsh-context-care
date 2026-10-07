import { httpFailure } from './http-failure.js'

/** Fetch rewrite facts and publish failures through the same client data owner. */
export function createRewriteRecords({ fetcher = fetch, pollMs = 2000, setTimer = setInterval, clearTimer = clearInterval,
  report = error => console.error('context-care: rewrite journal unavailable', error), now = Date.now } = {}) {
  let records = new Map()
  let health = { status: 'loading' }
  let signature = ''
  let disposed = false
  let loading = false
  let failures = 0
  let retryAt = 0
  const controller = new AbortController()
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener() }
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
  async function load() {
    if (disposed || loading || now() < retryAt) return
    loading = true
    try {
      const response = await fetcher('/context-care/rewrite-journal', { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) throw await httpFailure(response, '/context-care/rewrite-journal')
      const body = await response.json()
      if (!Array.isArray(body?.records)) throw new Error('/context-care/rewrite-journal: invalid records response')
      if (disposed) return
      const nextSignature = JSON.stringify(body.records)
      const changed = nextSignature !== signature || health.status !== 'ready'
      if (nextSignature !== signature) {
        const next = new Map()
        for (const record of body.records) {
          if (typeof record?.hash !== 'string' || !record.hash || typeof record.sessionId !== 'string') throw new Error('/context-care/rewrite-journal: invalid record')
          next.set(record.sessionId + ':' + record.hash, record)
        }
        signature = nextSignature
        records = next
      }
      failures = 0
      retryAt = 0
      health = { status: 'ready' }
      if (changed) notify()
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      if (health.error !== message) report(error)
      health = { status: 'error', error: message }
      failures++
      retryAt = now() + pollMs * 2 ** Math.min(failures, 4)
      notify()
    } finally { loading = false }
  }
  void load()
  const timer = setTimer(() => { void load() }, pollMs)
  return {
    records: { getSnapshot: () => records, subscribe },
    health: { getSnapshot: () => health, subscribe },
    dispose() { disposed = true; controller.abort(); clearTimer(timer); listeners.clear() },
  }
}
