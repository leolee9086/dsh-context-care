import { Worker } from 'node:worker_threads'
/** Reuse successful workers; timeout/cancellation still terminates the thread before rejection. */
export function createBoundedMatcher({ timeoutMs = 250, startupMs = 10000, maxBytes = 4194304, maxPending = 16, maxIdle = 2 } = {}) {
  let closed = false
  const active = new Set(); const idle = []
  function createWorker() {
    const worker = new Worker(new URL('./match-worker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--test')) })
    const entry = { worker, ready: false, dead: false, receive: undefined, fail: undefined }
    worker.on('message', message => {
      if (message.ready) entry.ready = true
      entry.receive?.(message)
    })
    worker.on('error', error => { entry.dead = true; entry.fail?.(error) })
    worker.on('exit', code => {
      entry.dead = true; entry.fail?.(new Error(`matcher-worker-exited:${code}`))
      const index = idle.indexOf(entry); if (index >= 0) idle.splice(index, 1)
    })
    return entry
  }
  return {
    async detect(input, signal) {
      if (closed) throw new Error('matcher-closed')
      if (signal?.aborted) throw signal.reason ?? new Error('matcher-cancelled')
      if (active.size >= maxPending) throw new Error('matcher-capacity-exceeded')
      if (Buffer.byteLength(JSON.stringify(input), 'utf8') > maxBytes) throw new Error('matcher-input-budget-exceeded')
      const entry = idle.pop() ?? createWorker(); const { worker } = entry
      worker.ref()
      let finish; let healthy = false
      const result = new Promise((resolve, reject) => {
        let settled = false; let timer
        finish = (error, value) => {
          if (settled) return
          settled = true; clearTimeout(timer); healthy = !error
          error ? reject(error) : resolve(value)
        }
        const start = () => {
          clearTimeout(timer); timer = setTimeout(() => finish(new Error('matcher-work-timeout')), timeoutMs)
          try { worker.postMessage(input) } catch (error) { finish(error) }
        }
        entry.fail = error => finish(error)
        entry.receive = message => {
          if (message.ready) start()
          else if (message.error) finish(Object.assign(new Error(message.error.message), { name: message.error.name }))
          else finish(undefined, message.result)
        }
        if (entry.ready) start()
        else timer = setTimeout(() => finish(new Error('matcher-startup-timeout')), startupMs)
      })
      const run = { stop: () => finish(new Error('matcher-closed')), done: undefined }
      active.add(run)
      const abort = () => finish(signal.reason ?? new Error('matcher-cancelled'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      run.done = (async () => {
        try { return await result }
        finally {
          signal?.removeEventListener('abort', abort); entry.receive = undefined; entry.fail = undefined
          if (healthy && !closed && !entry.dead && idle.length < maxIdle) { idle.push(entry); worker.unref() }
          else await worker.terminate()
          active.delete(run)
        }
      })()
      return run.done
    },
    async close() {
      closed = true
      for (const run of active) run.stop()
      await Promise.allSettled([...active].map(run => run.done).concat(idle.splice(0).map(entry => entry.worker.terminate())))
    },
  }
}
