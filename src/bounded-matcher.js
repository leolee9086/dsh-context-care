import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

/** A matching operation failed; its diagnostic contains identities and sizes, never message text. */
export class MatcherFailure extends Error {
  constructor(message, diagnostic, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'MatcherFailure'
    this.code = 'CONTEXT_CARE_MATCH_FAILED'
    this.diagnostic = diagnostic
  }
}

/** Reuse successful workers; failed workers terminate before rejection reaches the caller. */
export function createBoundedMatcher({ timeoutMs = 250, startupMs = 10000, maxBytes = 4194304, maxPending = 16, maxIdle = 2 } = {}) {
  let closed = false; let workersStarted = 0; let completed = 0; let failed = 0
  const active = new Set(); const idle = []
  function createWorker() {
    const worker = new Worker(new URL('./match-worker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      // Published JavaScript needs no parent loaders, test flags or process-only V8 options.
      execArgv: [] })
    workersStarted++
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
    getStats() { return { active: active.size, idle: idle.length, workersStarted, completed, failed, closed } },
    async detect(input, signal) {
      if (closed) throw new Error('matcher-closed')
      if (signal?.aborted) throw signal.reason ?? new Error('matcher-cancelled')
      // Reset operations still have work even without rules. Other empty stages need no thread or copy.
      if (!input.detectorReset && Array.isArray(input.rules)) {
        const rules = input.rules.filter(rule => !Array.isArray(rule.on) || rule.on.includes(input.stage))
        if (!rules.length) return input.detectorSpecifications ? { events: [], states: {} } : []
        input = { ...input, rules }
      }
      const began = performance.now(); let dispatchedAt; let processingAt; let phase = 'admission'
      const inputBytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
      const operationId = randomUUID()
      const failure = error => new MatcherFailure(error.message, {
        operationId, stage: input.stage ?? 'detector.reset', phase,
        rules: (input.rules ?? []).map(rule => ({ sourceId: rule.sourceId ?? '', ruleId: rule.id ?? '', revision: rule.revision ?? null })),
        inputBytes, blockCount: input.blocks?.length ?? 0, elapsedMs: performance.now() - began,
        startupMs: (dispatchedAt ?? performance.now()) - began,
        roundTripMs: dispatchedAt === undefined ? null : performance.now() - dispatchedAt,
        processingElapsedMs: processingAt === undefined ? null : performance.now() - processingAt,
        timeoutMs, activeOperations: active.size,
      }, error)
      if (active.size >= maxPending) throw failure(new Error('matcher-capacity-exceeded'))
      if (inputBytes > maxBytes) throw failure(new Error('matcher-input-budget-exceeded'))
      const entry = idle.pop() ?? createWorker(); const { worker } = entry
      worker.ref()
      let finish; let healthy = false
      const result = new Promise((resolve, reject) => {
        let settled = false; let timer
        finish = (error, value, cancelled = false) => {
          if (settled) return
          settled = true; clearTimeout(timer); healthy = !error
          if (error) { if (!cancelled) failed++; reject(cancelled ? error : failure(error)) }
          else { completed++; resolve(value) }
        }
        const start = () => {
          phase = 'round-trip'; dispatchedAt = performance.now()
          clearTimeout(timer); timer = setTimeout(() => finish(new Error('matcher-work-timeout')), timeoutMs)
          try { worker.postMessage(input) } catch (error) { finish(error) }
        }
        entry.fail = error => finish(error)
        entry.receive = message => {
          if (message.ready) start()
          else if (message.started) { phase = 'processing'; processingAt = performance.now() }
          else if (message.error) finish(Object.assign(new Error(message.error.message), { name: message.error.name }))
          else finish(undefined, message.result)
        }
        if (entry.ready) start()
        else { phase = 'startup'; timer = setTimeout(() => finish(new Error('matcher-startup-timeout')), startupMs) }
      })
      const run = { stop: () => finish(new Error('matcher-closed'), undefined, true), done: undefined }
      active.add(run)
      const abort = () => finish(signal.reason ?? new Error('matcher-cancelled'), undefined, true)
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
