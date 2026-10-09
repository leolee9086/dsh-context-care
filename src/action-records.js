import { httpFailure } from './http-failure.js'

/**
 * Own session-scoped HTTP snapshots for the framework's injected observable hook.
 * The component receives plain watch callbacks; no subscription logic lives in it.
 * @param options fetch function, polling interval and timer providers
 * @returns stable source, watch(sessionId, offset) disposer and unload disposer
 */
export function createActionRecords({ fetcher = fetch, pollMs = 2000, setTimer = setInterval, clearTimer = clearInterval,
  endpoint = '/context-care/actions', collection = 'actions', parse = body => body } = {}) {
  let snapshot = new Map()
  const listeners = new Set()
  const watches = new Map()
  let disposed = false
  const publish = (key, value) => {
    if (disposed) return
    snapshot = new Map(snapshot).set(key, value)
    for (const listener of listeners) listener()
  }
  async function load(watch) {
    if (disposed || watch.loading) return
    watch.loading = true
    try {
      const response = await fetcher(`${endpoint}?sessionId=${encodeURIComponent(watch.sessionId)}&limit=20&offset=${watch.offset}${watch.seq === undefined ? '' : `&seq=${watch.seq}`}`, { signal: watch.controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) throw await httpFailure(response, endpoint)
      const body = parse(await response.json(), { sessionId: watch.sessionId, seq: watch.seq })
      if (!Array.isArray(body?.[collection])) throw new Error(`Invalid ${collection} response`)
      if (!watch.controller.signal.aborted) publish(watch.key, { status: 'ready', ...body })
    } catch (error) {
      if (!watch.controller.signal.aborted) publish(watch.key, { status: 'error', error: String(error) })
    } finally { watch.loading = false }
  }
  const timer = setTimer(() => { for (const watch of watches.values()) void load(watch) }, pollMs)
  return {
    source: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    watch(sessionId, offset = 0, seq) {
      if (disposed) return () => {}
      const key = `${sessionId}:${offset}${seq === undefined ? '' : `:${seq}`}`
      let watch = watches.get(key)
      if (!watch) {
        watch = { key, sessionId, offset, seq, count: 0, controller: new AbortController(), loading: false }
        watches.set(key, watch)
        publish(key, { status: 'loading' })
        void load(watch)
      }
      watch.count++
      return () => {
        if (--watch.count > 0) return
        watches.delete(key)
        watch.controller.abort()
        snapshot = new Map(snapshot)
        snapshot.delete(key)
        for (const listener of listeners) listener()
      }
    },
    refresh(sessionId, offset = 0, seq) {
      const watch = watches.get(`${sessionId}:${offset}${seq === undefined ? '' : `:${seq}`}`)
      if (watch) void load(watch)
    },
    dispose() { disposed = true; clearTimer(timer); for (const watch of watches.values()) watch.controller.abort(); watches.clear(); listeners.clear(); snapshot = new Map() },
  }
}
