import { parseDisplayResponse } from './display-response.js'
import { httpFailure } from './http-failure.js'
export { parseDisplayResponse } from './display-response.js'

/** On-demand detail reads: no timer, no per-message subscription, no implicit retry. */
export function createDisplayRecords({ fetcher = fetch } = {}) {
  let snapshot = new Map(); let disposed = false
  const listeners = new Set(); const pending = new Map()
  const keyFor = (sessionId, seq) => `${sessionId}:0:${seq}`
  const publish = (key, value) => {
    if (disposed) return
    snapshot = new Map(snapshot).set(key, value)
    for (const listener of listeners) listener()
  }
  async function read(sessionId, seq, { refresh = false } = {}) {
    const key = keyFor(sessionId, seq)
    if (disposed) return
    if (pending.has(key)) return pending.get(key).done
    if (!refresh && snapshot.get(key)?.status === 'ready') return snapshot.get(key)
    const controller = new AbortController()
    publish(key, { status: 'loading' })
    const operation = { controller, done: undefined }; pending.set(key, operation)
    operation.done = (async () => {
      const route = `/context-care/display?sessionId=${encodeURIComponent(sessionId)}&seq=${seq}`
      let phase = 'fetch'; let httpStatus
      try {
        const response = await fetcher(route, { signal: controller.signal, headers: { accept: 'application/json' } })
        httpStatus = response.status
        // Electron can report the same Failed to fetch while reading a body after headers arrived.
        // Keep that phase and status distinct from a request that never received headers.
        phase = 'body'
        if (!response.ok) {
          const failure = await httpFailure(response, route)
          phase = 'http'
          throw failure
        }
        const text = await response.text()
        phase = 'json'
        const body = JSON.parse(text)
        phase = 'validation'
        const value = { status: 'ready', ...parseDisplayResponse(body, { seq }) }
        if (!controller.signal.aborted) publish(key, value)
        return value
      } catch (error) {
        if (!controller.signal.aborted) publish(key, { status: 'error', error: String(error), route, phase, httpStatus })
      } finally { if (pending.get(key) === operation) pending.delete(key) }
    })()
    return operation.done
  }
  return {
    source: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    read, refresh: (sessionId, _offset, seq) => read(sessionId, seq, { refresh: true }),
    watch(sessionId, _offset, seq) { void read(sessionId, seq); return () => pending.get(keyFor(sessionId, seq))?.controller.abort() },
    dispose() { disposed = true; for (const operation of pending.values()) operation.controller.abort(); pending.clear(); listeners.clear(); snapshot = new Map() },
  }
}
