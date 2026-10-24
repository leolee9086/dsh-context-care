import { z } from 'zod'
import type { CareTopic } from './care-changes.js'
const Change = z.object({ sessionId: z.string(), topics: z.array(z.enum(['actions', 'prompts', 'rewrites', 'controls', 'runtime'])) })

/** One connection for all retained Sessions; no heartbeat or timed reconnect. */
export function createClientChanges({ fetcher = fetch, report = (error: unknown) => console.error('context-care: change stream failed', error) } = {}) {
  const sessions = new Map<string, Set<(topics: readonly CareTopic[]) => void>>()
  let controller: AbortController | undefined
  let disposed = false
  let scheduled = false
  let failed = false
  async function open(owned: AbortController, ids: readonly string[]) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const query = new URLSearchParams(ids.map(id => ['sessionId', id]))
      const response = await fetcher(`/context-care/changes?${query}`, { signal: owned.signal, headers: { accept: 'application/x-ndjson' } })
      if (!response.ok || !response.body) throw new Error(`context-care: change stream HTTP ${response.status}`)
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        buffered += decoder.decode(part.value, { stream: true })
        let end: number
        while ((end = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, end); buffered = buffered.slice(end + 1)
          if (!line) continue
          const change = Change.parse(JSON.parse(line))
          if (!ids.includes(change.sessionId)) throw new Error('context-care: change stream session mismatch')
          if (controller === owned && !owned.signal.aborted) {
            for (const listener of sessions.get(change.sessionId) ?? []) listener(change.topics)
          }
        }
        if (buffered.length > 4096) throw new Error('context-care: oversized change frame')
      }
      if (!owned.signal.aborted) throw new Error('context-care: change stream closed')
    } catch (error) { if (!owned.signal.aborted && !disposed) { failed = true; report(error) } }
    finally { await reader?.cancel().catch(() => {}); reader?.releaseLock() }
  }
  function schedule() {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      controller?.abort(); controller = undefined
      if (disposed || !sessions.size) return
      controller = new AbortController(); failed = false
      // Subscribe before the first read: the Host sends a new cut for every
      // retained Session, covering changes during connection replacement.
      void open(controller, [...sessions.keys()])
    })
  }
  return {
    subscribe(id: string, listener: (topics: readonly CareTopic[]) => void) {
      if (disposed) return () => {}
      let listeners = sessions.get(id)
      if (!listeners) { listeners = new Set(); sessions.set(id, listeners); schedule() }
      listeners.add(listener)
      const owned = listeners
      let released = false
      return () => {
        if (released) return
        released = true; owned.delete(listener)
        if (!owned.size && sessions.get(id) === owned) {
          sessions.delete(id)
          // Final release closes immediately, including on plugin unload.
          if (!sessions.size) { controller?.abort(); controller = undefined }
          else schedule()
        }
      }
    },
    reset: schedule,
    retry() { if (failed) schedule() },
    dispose() { disposed = true; controller?.abort(); controller = undefined; sessions.clear() },
  }
}
