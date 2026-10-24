/** Process-local invalidations; Session and the owning services retain all facts. */
export type CareTopic = 'actions' | 'prompts' | 'rewrites' | 'controls' | 'runtime'
export interface CareChange { sessionId?: string; topics: readonly CareTopic[] }
export function createCareChanges() {
  const listeners = new Set<(change: CareChange) => void>()
  const pending = new Map<string | undefined, Set<CareTopic>>()
  let queued = false
  let closed = false
  return {
    changed(sessionId?: string, topics: readonly CareTopic[] = ['actions', 'prompts', 'rewrites', 'controls', 'runtime']) {
      if (closed) return
      let selected = pending.get(sessionId)
      if (!selected) { selected = new Set(); pending.set(sessionId, selected) }
      for (const topic of topics) selected.add(topic)
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        const changes = [...pending].map(([id, values]) => ({ sessionId: id, topics: [...values] }))
        pending.clear()
        for (const change of changes) for (const listener of listeners) listener(change)
      })
    },
    subscribe(listener: (change: CareChange) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    close() { closed = true; pending.clear(); listeners.clear() },
  }
}
