/** Retain a subscribed page; the shared stream supplies both its initial value and updates. */
export function createActionRecords({ changes, collection = 'actions', parse = body => body }) {
  let snapshot = new Map()
  const listeners = new Set()
  const watches = new Map()
  let disposed = false
  const publish = (key, value) => {
    if (disposed) return
    snapshot = new Map(snapshot).set(key, value)
    for (const listener of listeners) listener()
  }
  return {
    source: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    watch(sessionId, offset = 0, seq) {
      if (disposed) return () => {}
      const key = `${sessionId}:${offset}${seq === undefined ? '' : `:${seq}`}`
      let watch = watches.get(key)
      if (!watch) {
        watch = { count: 0 }; watches.set(key, watch)
        publish(key, { status: 'loading' })
        watch.unsubscribe = changes.subscribe({ sessionId, topic: collection, offset, ...(seq === undefined ? {} : { seq }) }, update => {
          if (disposed || !watches.has(key)) return
          if (update.type === 'error') {
            publish(key, { ...snapshot.get(key), status: 'error', error: `${update.error.name}: ${update.error.message}` })
            return
          }
          try {
            if (update.type !== 'snapshot') throw new Error(`Unexpected ${collection} delta`)
            const body = parse(update.value, { sessionId, seq })
            if (collection !== 'status' && !Array.isArray(body?.[collection])) throw new Error(`Invalid ${collection} response`)
            publish(key, { ...body, status: 'ready' })
          } catch (error) {
            publish(key, { ...snapshot.get(key), status: 'error', error: String(error) })
          }
        })
      }
      watch.count++
      let released = false
      return () => {
        if (released) return
        released = true
        if (--watch.count > 0) return
        watches.delete(key); watch.unsubscribe?.()
        snapshot = new Map(snapshot); snapshot.delete(key)
        for (const listener of listeners) listener()
      }
    },
    refresh() { changes.refresh() },
    dispose() { disposed = true; for (const watch of watches.values()) watch.unsubscribe?.(); watches.clear(); listeners.clear(); snapshot = new Map() },
  }
}
