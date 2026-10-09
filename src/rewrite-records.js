import { httpFailure } from './http-failure.js'

/** Fetch only retained sessions; failures and retry schedules belong to that same session. */
export function createRewriteRecords({ fetcher = fetch, pollMs = 2000, setTimer = setInterval, clearTimer = clearInterval,
  report = error => console.error('context-care: rewrite journal unavailable', error), now = Date.now } = {}) {
  let records = new Map(); let health = new Map(); let disposed = false
  const watches = new Map(); const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener() }
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
  const live = watch => !disposed && !watch.controller.signal.aborted && watches.get(watch.sessionId) === watch
  function status(id, value) { health = new Map(health).set(id, value) }
  async function load(watch) {
    if (!live(watch) || watch.loading || now() < watch.retryAt) return
    watch.loading = true
    try {
      const response = await fetcher(`/context-care/rewrite-journal?sessionId=${encodeURIComponent(watch.sessionId)}`, {
        signal: watch.controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) throw await httpFailure(response, '/context-care/rewrite-journal')
      const body = await response.json()
      if (!live(watch)) return
      if (!Array.isArray(body?.records)) throw new Error('/context-care/rewrite-journal: invalid records response')
      for (const record of body.records) {
        if (typeof record?.hash !== 'string' || !record.hash || record.sessionId !== watch.sessionId)
          throw new Error('/context-care/rewrite-journal: invalid or cross-session record')
      }
      const signature = JSON.stringify(body.records)
      const changed = signature !== watch.signature || health.get(watch.sessionId)?.status !== 'ready'
      if (signature !== watch.signature) {
        records = new Map([...records].filter(([, record]) => record.sessionId !== watch.sessionId))
        for (const record of body.records) records.set(record.sessionId + ':' + record.hash, record)
        watch.signature = signature
      }
      watch.failures = 0; watch.retryAt = 0; status(watch.sessionId, { status: 'ready' })
      if (changed) notify()
    } catch (error) {
      if (!live(watch)) return
      const message = error instanceof Error ? error.message : String(error)
      if (health.get(watch.sessionId)?.error !== message) report(error)
      status(watch.sessionId, { status: 'error', error: message })
      watch.failures++; watch.retryAt = now() + pollMs * 2 ** Math.min(watch.failures, 4)
      notify()
    } finally { watch.loading = false }
  }
  const timer = setTimer(() => { for (const watch of watches.values()) void load(watch) }, pollMs)
  return {
    records: { getSnapshot: () => records, subscribe },
    health: { getSnapshot: () => health, subscribe },
    watch(sessionId) {
      if (disposed || !sessionId) return () => {}
      let watch = watches.get(sessionId)
      if (!watch) {
        watch = { sessionId, count: 0, controller: new AbortController(), loading: false, failures: 0, retryAt: 0, signature: '' }
        watches.set(sessionId, watch); status(sessionId, { status: 'loading' }); notify(); void load(watch)
      }
      watch.count++
      let released = false
      return () => {
        if (released) return
        released = true
        if (--watch.count > 0 || disposed) return
        watches.delete(sessionId); watch.controller.abort()
        records = new Map([...records].filter(([, record]) => record.sessionId !== sessionId))
        health = new Map(health); health.delete(sessionId); notify()
      }
    },
    dispose() {
      disposed = true; clearTimer(timer)
      for (const watch of watches.values()) watch.controller.abort()
      watches.clear(); listeners.clear(); records = new Map(); health = new Map()
    },
  }
}
