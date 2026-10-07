/**
 * Own maintenance occupancy and cancellation for one installed contribution.
 * Each Session admits one complete planning/execution/measurement operation;
 * disposal aborts queued and running work and waits for their settlement.
 * @returns run(session, signal, callback) and dispose() lifecycle controller
 */
export function createMaintenanceOperations() {
  const lifetime = new AbortController()
  const tails = new WeakMap()
  const active = new Set()
  return {
    async run(session, signal, callback) {
      const combined = AbortSignal.any([signal, lifetime.signal])
      combined.throwIfAborted()
      const previous = tails.get(session) ?? Promise.resolve()
      const task = previous.catch(error => { void error }).then(() => {
        combined.throwIfAborted()
        return callback(combined)
      })
      tails.set(session, task)
      active.add(task)
      try { return await task }
      finally {
        active.delete(task)
        if (tails.get(session) === task) tails.delete(session)
      }
    },
    async dispose() {
      lifetime.abort(new DOMException('context-care maintenance unloaded', 'AbortError'))
      await Promise.allSettled([...active])
    },
  }
}
