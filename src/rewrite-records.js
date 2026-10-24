/** Retain rewrite snapshots and committed deltas from the shared subscription. */
export function createRewriteRecords({ changes,
  report = error => console.error('context-care: rewrite journal unavailable', error) }) {
  let records = new Map(); let health = new Map(); let disposed = false
  const watches = new Map(); const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener() }
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
  function status(id, value) { health = new Map(health).set(id, value) }
  return {
    records: { getSnapshot: () => records, subscribe },
    health: { getSnapshot: () => health, subscribe },
    watch(sessionId) {
      if (disposed || !sessionId) return () => {}
      let watch = watches.get(sessionId)
      if (!watch) {
        watch = { count: 0 }; watches.set(sessionId, watch)
        status(sessionId, { status: 'loading' }); notify()
        watch.unsubscribe = changes.subscribe({ sessionId, topic: 'rewrites' }, update => {
          if (disposed || !watches.has(sessionId)) return
          try {
            if (update.type === 'error') throw new Error(`${update.error.name}: ${update.error.message}`)
            const body = update.value
            if (!Array.isArray(body.records)) throw new Error('rewrite subscription: invalid records')
            for (const record of body.records) {
              if (typeof record?.hash !== 'string' || !record.hash || record.sessionId !== sessionId)
                throw new Error('rewrite subscription: invalid or cross-session record')
            }
            records = update.type === 'snapshot'
              ? new Map([...records].filter(([, record]) => record.sessionId !== sessionId)) : new Map(records)
            for (const record of body.records) records.set(`${sessionId}:${record.hash}`, record)
            if (update.type === 'delta') for (const hash of body.removed) records.delete(`${sessionId}:${hash}`)
            status(sessionId, { status: 'ready' }); notify()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (health.get(sessionId)?.error !== message) report(error)
            status(sessionId, { status: 'error', error: message }); notify()
          }
        })
      }
      watch.count++
      let released = false
      return () => {
        if (released) return
        released = true
        if (--watch.count > 0 || disposed) return
        watches.delete(sessionId); watch.unsubscribe?.()
        records = new Map([...records].filter(([, record]) => record.sessionId !== sessionId))
        health = new Map(health); health.delete(sessionId); notify()
      }
    },
    refresh() { changes.refresh() },
    dispose() {
      disposed = true
      for (const watch of watches.values()) watch.unsubscribe?.()
      watches.clear(); listeners.clear(); records = new Map(); health = new Map()
    },
  }
}
