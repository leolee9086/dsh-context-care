import { httpFailure } from './http-failure.js'

/** Fetch retained Sessions on first watch, committed changes, and explicit retry. */
export function createRewriteRecords({ fetcher = fetch, changes,
  report = error => console.error('context-care: rewrite journal unavailable', error) } = {}) {
  let records = new Map(); let health = new Map(); let disposed = false
  const watches = new Map(); const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener() }
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
  const live = watch => !disposed && !watch.controller.signal.aborted && watches.get(watch.sessionId) === watch
  function status(id, value) { health = new Map(health).set(id, value) }
  async function load(watch) {
    if (!live(watch)) return
    if (watch.loading) { watch.dirty = true; return }
    watch.loading = true; watch.dirty = false
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
      status(watch.sessionId, { status: 'ready' })
      if (changed) notify()
    } catch (error) {
      if (!live(watch)) return
      const message = error instanceof Error ? error.message : String(error)
      if (health.get(watch.sessionId)?.error !== message) report(error)
      status(watch.sessionId, { status: 'error', error: message })
      notify()
    } finally { watch.loading = false; if (watch.dirty && live(watch)) void load(watch) }
  }
  return {
    records: { getSnapshot: () => records, subscribe },
    health: { getSnapshot: () => health, subscribe },
    watch(sessionId) {
      if (disposed || !sessionId) return () => {}
      let watch = watches.get(sessionId)
      if (!watch) {
        watch = { sessionId, count: 0, controller: new AbortController(), loading: false, signature: '' }
        watches.set(sessionId, watch)
        watch.unsubscribe = changes?.subscribe(sessionId, topics => { if (topics.includes('rewrites')) void load(watch) })
        status(sessionId, { status: 'loading' }); notify(); void load(watch)
      }
      watch.count++
      let released = false
      return () => {
        if (released) return
        released = true
        if (--watch.count > 0 || disposed) return
        watches.delete(sessionId); watch.controller.abort(); watch.unsubscribe?.()
        records = new Map([...records].filter(([, record]) => record.sessionId !== sessionId))
        health = new Map(health); health.delete(sessionId); notify()
      }
    },
    refresh(sessionId) { changes?.retry?.(); const watch = watches.get(sessionId); if (watch) void load(watch) },
    dispose() {
      disposed = true
      for (const watch of watches.values()) { watch.controller.abort(); watch.unsubscribe?.() }
      watches.clear(); listeners.clear(); records = new Map(); health = new Map()
    },
  }
}
