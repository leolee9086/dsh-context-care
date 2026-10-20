import { Worker } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'

/** A matching operation failed; its diagnostic contains identities and sizes, never message text. */
export class MatcherFailure extends Error {
  constructor(message, diagnostic, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'MatcherFailure'
    this.code = 'CONTEXT_CARE_MATCH_FAILED'
    this.diagnostic = diagnostic
  }
}

/**
 * 任务与线程是分开的两件事。
 *
 * 线程是执行资源，任务才是失败的单位：每个任务有自己的 id、自己的超时、自己的结局，
 * 响应按 id 回到发起它的那个任务上。线程从不被某个任务独占，所以从来没有"一批任务"
 * 这种对象存在，也就不可能出现"一条失败导致整批失败"。
 *
 * `maxPending` 是背压（同时在途多少个任务），和线程数没有任何关系：线程少只意味着
 * 排队更久，不意味着队列该更短。真正的并发控制在调用方那层（轮次与队列）。
 *
 * 唯一不可分割的边界是线程本身：同步死循环只能靠 terminate 结束，而 terminate 会连带
 * 这个线程上排队的任务。那些任务一行代码都没执行过，所以它们按「没开始」处理——
 * 标成可重试，由调用方换一个线程重投；只有正在执行的那一条才算真的超时。
 */
export function createBoundedMatcher({ timeoutMs = 250, startupMs = 10000, maxBytes = 4194304,
  maxPending = 256, maxIdle = 2 } = {}) {
  let closed = false; let workersStarted = 0; let completed = 0; let failed = 0
  const entries = new Set(); const preparing = new Map(); const active = new Set()
  // 正在退出的线程：terminate() 是异步的，必须有人等它，否则进程会被一个
  // 已经没人管的 MessagePort 拴住，测试跑完了也退不出来。
  const terminating = new Set()
  let warmTarget = 0; let warming; let refillTimer

  // Only explicitly warmed pools keep a hot reserve. Back off after startup failure so a
  // broken worker module cannot turn pool maintenance into an unbounded restart loop.
  const scheduleRefill = (delay = 0) => {
    if (closed || warming || refillTimer || entries.size >= Math.min(maxIdle, maxPending)) return
    refillTimer = setTimeout(() => {
      refillTimer = undefined
      void warmup().catch(() => {})
    }, delay)
    refillTimer.unref()
  }

  function terminate(entry) {
    entry.dead = true
    entries.delete(entry)
    const done = entry.worker.terminate().catch(() => {})
    terminating.add(done)
    void done.finally(() => terminating.delete(done))
    return done
  }

  function createEntry() {
    const worker = new Worker(new URL('./match-worker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      // Published JavaScript needs no parent loaders, test flags or process-only V8 options.
      execArgv: [] })
    workersStarted++
    const entry = { worker, ready: false, dead: false, tasks: new Map(), startedTask: undefined }
    worker.on('message', message => receive(entry, message))
    worker.on('error', error => kill(entry, error))
    worker.on('exit', code => { kill(entry, new Error(`matcher-worker-exited:${code}`)) })
    entries.add(entry)
    return entry
  }

  /** 这条消息属于哪个任务，就只交给那个任务；路由错了就等于把别人的失败安在自己头上。 */
  function receive(entry, message) {
    if (message.ready) {
      entry.ready = true
      preparing.get(entry)?.finish()
      // 就绪却还没有任务：这条线程不该拴住进程。预热出来的热线程从不经过 settle，
      // 少了这一步，每个池都会在跑完之后把进程按住（测试跑完了也退不出来）。
      if (entry.tasks.size === 0) entry.worker.unref()
      return
    }
    // 批量任务算完一条就上报一条：这一条已经有结局了，不该等到整批结束才算数。
    if ('item' in message) {
      entry.tasks.get(message.taskId)?.onItem?.(message.item)
      return
    }
    if (message.started) {
      entry.startedTask = message.taskId
      const task = entry.tasks.get(message.taskId)
      if (task) task.phase = 'processing'
      return
    }
    const task = entry.tasks.get(message.taskId)
    if (task === undefined) return
    if (message.error) settle(task, Object.assign(new Error(message.error.message), { name: message.error.name }))
    else settle(task, undefined, message.result)
  }

  /**
   * 线程死了。正在执行的那一条是死因（它吃掉了自己的预算），按超时交代；
   * 同线程上还没开始的那些什么都没做，标成可重试交给调用方换线程。
   */
  function kill(entry, error) {
    if (entry.dead) return
    entry.dead = true
    entries.delete(entry)
    // 还在等握手的启动工作也一起结束：它等的那条线程已经不会再就绪了，
    // 否则调用方要一直等到 startup-timeout 才知道线程根本没起来。
    preparing.get(entry)?.finish(error)
    const running = entry.startedTask === undefined ? undefined : entry.tasks.get(entry.startedTask)
    for (const task of [...entry.tasks.values()]) {
      settle(task, task === running ? failure(task, error) : restartable(task, error))
    }
    terminate(entry)
    scheduleRefill(1000)
  }

  function diagnostic(task, phase) {
    return { operationId: task.id, stage: task.input.stage ?? 'detector.reset', phase: phase ?? task.phase,
      rules: (task.input.rules ?? []).map(rule => ({ sourceId: rule.sourceId ?? '', ruleId: rule.id ?? '', revision: rule.revision ?? null })),
      inputBytes: task.inputBytes, blockCount: task.input.blocks?.length ?? 0, elapsedMs: performance.now() - task.began,
      startupMs: (task.dispatchedAt ?? performance.now()) - task.began,
      roundTripMs: task.dispatchedAt === undefined ? null : performance.now() - task.dispatchedAt,
      processingElapsedMs: task.processingAt === undefined ? null : performance.now() - task.processingAt,
      timeoutMs: task.workTimeoutMs, activeOperations: active.size }
  }

  function failure(task, error) {
    const detail = error instanceof MatcherFailure ? error.diagnostic : diagnostic(task)
    return new MatcherFailure(error.message, detail, error)
  }

  /** 可重试的失败：这条任务一行代码都没执行过，换一个线程重投不会重复副作用。 */
  function restartable(task, error) {
    const value = failure(task, error)
    value.retryable = true
    return value
  }

  function settle(task, error, value) {
    if (task.settled) return
    task.settled = true
    clearTimeout(task.timer)
    task.signal?.removeEventListener('abort', task.abort)
    active.delete(task)
    task.entry?.tasks.delete(task.id)
    // 空闲线程不能拴住进程：没有在途任务就放它走，任务到达时再 ref 回来。
    if (task.entry !== undefined && !task.entry.dead && task.entry.tasks.size === 0) task.entry.worker.unref()
    if (error === undefined) { completed++; task.resolve(value) }
    else { if (!task.cancelled) failed++; task.reject(error) }
  }

  /** 空转的就绪线程。 */
  function idleEntry() {
    for (const entry of entries) {
      if (entry.ready && !entry.dead && !preparing.has(entry) && entry.tasks.size === 0) return entry
    }
    return undefined
  }

  /**
   * 给任务找一条线程。顺序是有讲究的：
   * 空转的 > 正在启动的（等它就绪，比新开一条省）> 新开（池没满）> 最闲的（池满）。
   * 池满时也不排队等死——任务投给最闲的线程，它自己的结局仍然只属于自己。
   */
  async function acquire(task, signal) {
    const idle = idleEntry()
    if (idle !== undefined) return idle
    const starting = [...entries].find(entry => !entry.ready && !entry.dead && entry.claimed !== true)
    if (starting !== undefined) {
      // 认领它，免得两个任务抢同一条正在启动的线程。
      starting.claimed = true
      try { await preparing.get(starting)?.done } catch (error) {
        // 抛出前也要把认领标记放回去：留着它，这条线程就再也不会被任何任务选中。
        starting.claimed = false
        if (closed) throw error
      }
      starting.claimed = false
      if (!starting.dead) return starting
      return acquire(task, signal)
    }
    if (entries.size < Math.min(maxIdle, maxPending)) {
      const entry = createEntry()
      // 新开的线程同样要被认领：第二个任务到达时它还在启动，
      // 若不算「已占用」，两个任务就会挤进同一条线程，各自等着对方让路。
      entry.claimed = true
      task.phase = 'startup'
      try { await prepare(entry, signal) }
      catch (error) { throw failure(task, error) }
      finally { entry.claimed = false }
      return entry
    }
    const best = [...entries].filter(entry => !entry.dead).sort((a, b) => a.tasks.size - b.tasks.size)[0]
    if (best === undefined) throw failure(task, new Error('matcher-capacity-exceeded'))
    return best
  }

  function prepare(entry, signal) {
    signal?.throwIfAborted()
    let finish
    const done = new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => finish && finish(new Error('matcher-startup-timeout')), startupMs)
      finish = (error) => {
        if (settled) return
        settled = true; clearTimeout(timer); preparing.delete(entry); signal?.removeEventListener('abort', abort)
        if (error) reject(error); else resolve()
      }
      const abort = () => finish(signal.reason ?? new Error('matcher-cancelled'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
    preparing.set(entry, { finish, done, claim() {} })
    // 线程可能在我们挂上握手之前就已经就绪（新线程启动很快），
    // 那这条 ready 消息当时没有接收方；这里补一次，否则等它会一直等下去。
    if (entry.ready) queueMicrotask(() => finish())
    return done
  }

  async function warmup(signal) {
    if (closed) throw new Error('matcher-closed')
    warmTarget = Math.min(maxIdle, maxPending)
    if (warming) return warming
    warming = Promise.resolve().then(async () => {
      const pending = []
      // 补到目标数量为止：已有的热线程算数，不会重复创建。
      while (entries.size < warmTarget && !closed) {
        try { pending.push(prepare(createEntry(), signal)) }
        catch (error) { pending.push(Promise.reject(error)); break }
      }
      const results = await Promise.allSettled(pending)
      const rejected = results.find(result => result.status === 'rejected')
      if (rejected) throw rejected.reason
    }).finally(() => { warming = undefined; scheduleRefill(1000) })
    return warming
  }

  async function detect(input, signal, { onDispatch, workTimeoutMs = timeoutMs, onItem } = {}) {
    if (closed) throw new Error('matcher-closed')
    if (signal?.aborted) throw signal.reason ?? new Error('matcher-cancelled')
    // Reset operations still have work even without rules. Other empty stages need no thread or copy.
    if (!input.detectorReset && Array.isArray(input.rules)) {
      const rules = input.rules.filter(rule => !Array.isArray(rule.on) || rule.on.includes(input.stage))
      if (!rules.length) return input.detectorSpecifications ? { events: [], states: {} } : []
      input = { ...input, rules }
    }
    // 任务 id 必须全局唯一，不能用自增计数：池重建后计数会从头开始，
    // 一条迟到的响应就会落到别人的任务上，把结果交给错误的调用方。
    const task = { id: randomUUID(), input, signal, workTimeoutMs, onItem, began: performance.now(),
      dispatchedAt: undefined, processingAt: undefined, phase: 'admission', settled: false, cancelled: false,
      inputBytes: Buffer.byteLength(JSON.stringify(input), 'utf8') }
    const reject = (error) => { task.settled = true; throw failure(task, error) }
    if (active.size >= maxPending) reject(new Error('matcher-capacity-exceeded'))
    if (task.inputBytes > maxBytes) reject(new Error('matcher-input-budget-exceeded'))
    // 结算口先建好，再占准入名额：占位之后随时可能被 close() 结算，
    // 那时没有 reject 可调，任务就会卡在一条永远不会有人处理的 Promise 上。
    const answer = new Promise((resolve, rejectTask) => { task.resolve = resolve; task.reject = rejectTask })
    // 结算口还没交到调用方手上就可能失败（close 抢先结算），那段窗口里它没有认领者。
    // 先挂一个空处理：真正的错误仍会经由 detect 的返回值交给调用方。
    answer.catch(() => {})
    // 先占住准入名额再去等线程：否则两个任务都卡在「等线程」时，
    // 第三个任务看到的在途数还是 0，并发上限就被绕过去了。
    active.add(task)
    let entry
    try { entry = await acquire(task, signal) }
    catch (error) {
      active.delete(task)
      // 结算口已经建好了但不会再有人接：这里抛出去，它必须被就地收掉，
      // 否则进程会因为一个没人认领的 rejection 报错。
      answer.catch(() => {})
      throw error
    }
    if (task.settled) return answer
    task.entry = entry
    entry.tasks.set(task.id, task)
    task.abort = () => { task.cancelled = true; settle(task, signal.reason ?? new Error('matcher-cancelled')) }
    signal?.addEventListener('abort', task.abort, { once: true })
    if (signal?.aborted) { task.abort(); return answer }
    task.dispatchedAt = performance.now()
    entry.worker.ref()
    task.timer = setTimeout(() => {
      // 单条任务超时只废掉它自己所在的线程；terminate 之后 kill() 会把同线程
      // 还没开始的任务标成可重试，正在跑的这条才是这次超时的承担者。
      kill(entry, new Error('matcher-work-timeout'))
    }, workTimeoutMs)
    task.timer.unref?.()
    try { onDispatch?.(); entry.worker.postMessage({ ...input, taskId: task.id }) }
    catch (error) { settle(task, failure(task, error)) }
    return answer
  }

  async function close() {
    closed = true; clearTimeout(refillTimer)
    for (const task of [...active]) { task.cancelled = true; settle(task, new Error('matcher-closed')) }
    // 准备中的线程也要收尾：等握手的调用方不该替一个已经关掉的池把 startup 超时熬完。
    for (const entry of [...preparing.keys()]) preparing.get(entry)?.finish(new Error('matcher-closed'))
    preparing.clear()
    for (const entry of [...entries]) terminate(entry)
    // 连同 kill() 里已经发起的退出一起等：只等新发起的那批，
    // 之前卡在 CPU 循环里的线程仍然会把进程按住。
    await Promise.allSettled([...terminating].concat(warming ?? []))
    entries.clear()
  }

  return {
    getStats() {
      // idle 只算「已就绪、没有在途任务」的线程；正在启动的不算空闲。
      let idle = 0
      for (const entry of entries) {
        if (entry.ready && !entry.dead && !preparing.has(entry) && entry.tasks.size === 0) idle++
      }
      return { active: active.size, idle, preparing: preparing.size, threads: entries.size,
        workersStarted, completed, failed, closed }
    },
    detect, warmup, close,
  }
}
