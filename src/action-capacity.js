/** Bound simultaneous rule executions across sessions; aborted waiters never acquire capacity. */
export function createActionCapacity(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid-action-concurrency')
  let active = 0
  const waiting = []
  function permit() {
    active++
    let released = false
    return () => {
      if (released) return
      released = true; active--
      const next = waiting.shift()
      if (next) { next.signal.removeEventListener('abort', next.abort); next.resolve(permit()) }
    }
  }
  return signal => {
    if (signal.aborted) return Promise.reject(signal.reason)
    if (active < limit) return Promise.resolve(permit())
    return new Promise((resolve, reject) => {
      const item = { signal, resolve, abort() {
        const index = waiting.indexOf(item)
        if (index >= 0) waiting.splice(index, 1)
        reject(signal.reason)
      } }
      waiting.push(item); signal.addEventListener('abort', item.abort, { once: true })
    })
  }
}

/** Await cooperative approval with a bounded cancellation path, observing late rejection. */
export function awaitApproval(request, signal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return request() }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}
