import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { createBoundedMatcher } from '../bounded-matcher.js'
import { Source, ReminderConfig, compileRule } from './schema.js'
import { CapacitySettings, CapacityError } from '../reminder-capacity.js'
import { releaseResources } from '../resource-cleanup.js'
import { localWindow, humanActivity, requestContext, requestEligible } from './request-context.js'
export { ReminderConfig } from './schema.js'

export const REMINDER_SERVICE = 'reminderRules'
const KIND = 'plugin:dsh-context-care:reminder'
const serviceStarts = new WeakMap()
const clone = value => JSON.parse(JSON.stringify(value))
const keyOf = (sourceId, ruleId) => JSON.stringify([sourceId, ruleId, 'model'])
const Detector = z.object({ ref: z.string().min(1), revision: z.number().int().positive(),
  module: z.string().url().refine(value => new URL(value).protocol === 'file:', 'detector module must be a local file URL'),
  exportName: z.string().min(1).default('judge') }).strict()
export const REMINDER_DOMAIN = { name: 'context_care_reminders', version: 1, layout: 'per-record',
  tables: { sessions: { valueSchema: z.object({ seen: z.array(z.string()), candidates: z.array(z.json()), diagnostics: z.array(z.json()),
    windows: z.array(z.object({ key: z.string(), until: z.number(), messageId: z.string().optional() }).strict()).optional() }).strict() } } }

/** One runtime owns source snapshots, evaluation lifetimes and durable candidate records.
 * save ACKs before publishing state; execute must settle cancellation after its worker stops.
 * No Cordis or live session objects enter the scheduler. */
export function createReminderRuntime({ config: input, entries = [], save = async () => {}, execute,
  capacity, saveCapacity = async () => {}, dispatches = false,
  wallNow = () => Date.now(), now = () => performance.now(), eligible = () => true, epoch = () => 0, report = () => {} } = {}) {
  const config = ReminderConfig.parse(input)
  let settings = CapacitySettings.parse(capacity ?? { revision: 0, maxRules: config.maxRules })
  let capacityWrite = Promise.resolve()
  const rejectedSources = new Map()
  const records = new Map(entries.map(([id, value]) => [id, clone(value)]))
  const sources = new Map(), detectors = new Map(), analyzers = new Map(), chains = new Map(), queues = new Map(), running = new Map()
  const failures = new Map(), admissions = new Set()
  let closed = false, pumping = false
  const empty = () => ({ seen: [], candidates: [], diagnostics: [] })
  const serial = (id, fn) => {
    const task = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(fn)
    chains.set(id, task)
    return task
  }
  async function update(id, change) {
    return serial(id, async () => {
      const next = clone(records.get(id) ?? empty())
      // Window claims outlive candidate eviction and surface compaction, but expire at the local window end.
      next.windows = (next.windows ?? []).filter(item => item.until > wallNow())
      for (const candidate of next.candidates) {
        if (candidate.window && wallNow() >= candidate.window.end) candidate.status = 'discarded'
      }
      const value = change(next)
      next.diagnostics = next.diagnostics.slice(-config.maxCandidates)
      next.seen = next.seen.slice(-config.maxQueued * 4)
      // Do not evict an undelivered candidate to make space for a new one.
      while (next.candidates.length > config.maxCandidates) {
        const index = next.candidates.findIndex(item => item.status === 'delivered' || item.status === 'discarded')
        if (index < 0) throw new Error('reminder-candidate-capacity-exceeded')
        next.candidates.splice(index, 1)
      }
      if (Buffer.byteLength(JSON.stringify(next)) > config.maxBytes) throw new Error('reminder-retained-budget-exceeded')
      try { await save(id, next); failures.delete(id) }
      catch (error) { failures.set(id, error); throw error }
      records.set(id, next)
      return value
    })
  }
  function fresh(candidate) {
    const at = wallNow()
    if (candidate.window && (at < candidate.window.start || at >= candidate.window.end)) return false
    return !candidate.request || requestEligible(candidate.rule, { ...candidate.request, clock: { at } })
  }
  function current(candidate) {
    const source = sources.get(candidate.sourceId)
    return source?.token === candidate.sourceToken && source.acceptSession(candidate.sessionId)
      && source.value.rules.some(rule => rule.id === candidate.ruleId)
  }
  function diagnostic(id, detail) {
    return update(id, state => state.diagnostics.push({ at: Date.now(), ...detail })).catch(report)
  }
  function invalidate(sourceId) {
    for (const run of running.values()) if (run.items.some(item => item.source.sourceId === sourceId)) run.controller.abort(new Error('reminder-source-changed'))
  }
  function pump() {
    if (pumping || closed) return
    pumping = true
    try {
      for (const [id, queue] of queues) {
        if (running.size >= config.maxConcurrent) break
        if (running.has(id) || !queue.length) continue
        const run = queue.shift()
        // Move a served session to the tail so it cannot monopolize the next free slot.
        queues.delete(id); if (queue.length) queues.set(id, queue)
        running.set(id, run)
        run.task = evaluate(run).catch(error => diagnostic(id, { eventId: run.event.callId, status: 'failed', message: String(error.message ?? error) }))
          .finally(() => { clearTimeout(run.timer); running.delete(id); run.resolve(); pump() })
      }
    } finally { pumping = false }
  }
  async function evaluate(run) {
    const { event, items, controller, deadline } = run
    const blockedGroups = new Set(), winners = new Set(), results = [], diagnostics = []
    // Every analyzer reads the same base input; only the matching phase sees their combined facts.
    event.facts = {}
    for (const analyzer of run.analyzers) {
      if (controller.signal.aborted || now() >= deadline) break
      if (analyzers.get(analyzer.ref) !== analyzer) continue
      const child = new AbortController()
      const abort = () => child.abort(controller.signal.reason)
      controller.signal.addEventListener('abort', abort, { once: true })
      let timer
      const onDispatch = () => { timer ??= setTimeout(() => child.abort(new Error('reminder-analysis-timeout')), Math.max(0, Math.min(config.ruleTimeoutMs, deadline - now()))) }
      if (!dispatches) onDispatch()
      try {
        const facts = await execute({ analysis: { analyzer, event: { ...event, facts: {} }, maxBytes: config.maxBytes } }, child.signal, { onDispatch, workTimeoutMs: config.ruleTimeoutMs })
        child.signal.throwIfAborted()
        if (now() >= deadline || analyzers.get(analyzer.ref) !== analyzer) continue
        if (Buffer.byteLength(JSON.stringify({ ...event.facts, [analyzer.ref]: facts })) > config.maxBytes) throw new Error('reminder-facts-budget-exceeded')
        event.facts[analyzer.ref] = facts
        diagnostics.push({ analyzer: analyzer.ref, revision: analyzer.revision, status: 'analyzed', eventId: event.callId })
      } catch (error) {
        diagnostics.push({ analyzer: analyzer.ref, status: child.signal.aborted || /timeout/.test(error.message ?? '') ? 'timed-out' : 'failed', message: String(error.message ?? error),
          ...(error.diagnostic ? { diagnostic: clone(error.diagnostic) } : {}), eventId: event.callId })
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) }
    }
    for (const item of items) {
      const { source, token, rule, policy } = item
      if (controller.signal.aborted || now() >= deadline) { diagnostics.push({ status: 'round-timeout', eventId: event.callId }); break }
      if (rule.exclusiveGroup && (blockedGroups.has(rule.exclusiveGroup) || winners.has(rule.exclusiveGroup))) continue
      if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy) continue
      const child = new AbortController()
      const abort = () => child.abort(controller.signal.reason)
      controller.signal.addEventListener('abort', abort, { once: true })
      const workTimeoutMs = Math.min(config.ruleTimeoutMs, rule.judge?.timeoutMs ?? config.ruleTimeoutMs)
      let timer
      const onDispatch = () => { timer ??= setTimeout(() => child.abort(new Error('reminder-rule-timeout')), Math.max(0, Math.min(workTimeoutMs, deadline - now()))) }
      if (!dispatches) onDispatch()
      try {
        const judge = item.judge
        if (rule.judge && (judge?.revision !== rule.judge.revision || detectors.get(rule.judge.ref) !== judge)) throw new Error('reminder-judge-unavailable')
        const result = await execute({ reminder: { condition: rule.condition, event, maxBytes: config.maxBytes,
          ...(judge ? { judge, params: rule.judge.params ?? null } : {}) } }, child.signal, { onDispatch, workTimeoutMs })
        if (child.signal.aborted || controller.signal.aborted || now() >= deadline) throw child.signal.reason ?? new Error('reminder-round-timeout')
        if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy) continue
        if (result.ok) {
          if (rule.exclusiveGroup) winners.add(rule.exclusiveGroup)
          results.push({ id: randomUUID(), sessionId: event.sessionId, sourceId: source.sourceId, sourceToken: token, ruleId: rule.id,
            key: item.window ? JSON.stringify([source.sourceId, rule.id, 'model', item.window.id]) : keyOf(source.sourceId, rule.id),
            ...(item.window ? { window: item.window } : {}),
            ...(rule.on === 'request.before' ? { request: { type: event.type, humanActivity: event.humanActivity } } : {}),
            revision: source.revision, policy, text: rule.text,
            title: rule.title ?? rule.id, eventId: event.callId, rootCallId: event.rootCallId,
            status: 'pending', evidence: rule.on === 'request.before'
              ? { ...result, clock: event.clock, humanActivity: event.humanActivity } : result,
            rule: clone(source.rules.find(value => value.id === rule.id)) })
        }
        diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId, status: result.ok ? 'matched' : 'unmatched' })
      } catch (error) {
        if (rule.exclusiveGroup) blockedGroups.add(rule.exclusiveGroup)
        diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
          status: child.signal.aborted || /timeout/.test(error.message ?? '') ? 'timed-out' : 'failed', message: String(error.message ?? error),
          ...(error.diagnostic ? { diagnostic: clone(error.diagnostic) } : {}) })
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) }
    }
    await update(event.sessionId, state => {
      state.diagnostics.push(...diagnostics)
      for (const candidate of results) {
        if (controller.signal.aborted || closed || !current(candidate) || !eligible(event.sessionId, candidate.sourceId, candidate.ruleId)
          || epoch(event.sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) continue
        for (const old of state.candidates) if (old.status === 'pending' && !fresh(old)) old.status = 'discarded'
        if (!state.candidates.some(old => old.key === candidate.key && old.status === 'pending' && current(old))) state.candidates.push(candidate)
      }
    })
  }
  const registeredRules = () => [...sources.values()].reduce((count, item) => count + item.compiled.length, 0)
  const capacitySnapshot = () => clone({ ...settings, registeredRules: registeredRules(), rejections: [...rejectedSources.values()] })
  return {
    capacitySnapshot,
    /** Evaluate natural conversation at the same boundary that collects tool reminders. */
    async prepareRequest({ sessionId, events, visible = [], accepted = [], signal }) {
      if (![...sources.values()].some(source => source.compiled.some(rule => rule.on === 'request.before'))) return
      const at = wallNow(), callId = `request:${randomUUID()}`
      await this.submit({ type: 'request.before', sessionId, callId, rootCallId: callId,
        clock: { at, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        humanActivity: humanActivity(events), context: requestContext([...visible, ...accepted], config) }, signal)
    },
    /** Persist suppression through the active calendar window; omitted identity selects all window rules. */
    async snooze({ sessionId, sourceId, ruleId }) {
      if (closed) throw new Error('reminder-runtime-closed')
      if ((sourceId === undefined) !== (ruleId === undefined)) throw new Error('sourceId and ruleId must be supplied together')
      const selected = [...sources.values()].filter(source => source.acceptSession(sessionId)
        && (source.value.sessionId === undefined || source.value.sessionId === sessionId)
        && (sourceId === undefined || source.value.sourceId === sourceId))
        .flatMap(source => source.compiled.filter(rule => rule.deliver.model.once === 'window'
          && (ruleId === undefined || rule.id === ruleId)).map(rule => ({ sourceId: source.value.sourceId, rule })))
      return update(sessionId, state => {
        const suppressed = []
        for (const item of selected) {
          const window = localWindow(item.rule.when.timeWindow, wallNow())
          if (!window) continue
          const key = JSON.stringify([item.sourceId, item.rule.id, 'model', window.id])
          state.windows = state.windows.filter(claim => claim.key !== key)
          state.windows.push({ key, until: window.end })
          suppressed.push({ sourceId: item.sourceId, ruleId: item.rule.id, until: window.end })
        }
        return suppressed
      })
    },
    setCapacity(input) {
      const change = CapacitySettings.parse(input)
      const task = capacityWrite.catch(() => {}).then(async () => {
        if (closed) throw new CapacityError(503, '提醒服务已关闭')
        if (change.revision !== settings.revision) throw new CapacityError(409, '提醒容量已被其他窗口修改，请刷新后重试')
        const next = { revision: settings.revision + 1, maxRules: change.maxRules }
        // Only durable acknowledgement publishes a new setting; a failed write is retryable.
        await saveCapacity(next)
        settings = next
        return capacitySnapshot()
      })
      capacityWrite = task
      return task
    },
    validateRule(input) { return clone(compileRule(input, 'validation', 1)) },
    registerSource(input, { acceptSession = () => true } = {}) {
      if (closed) throw new Error('reminder-runtime-closed')
      const value = Source.parse(input)
      if (sources.has(value.sourceId)) throw new Error('reminder-source-already-registered')
      const owner = {}
      const replace = input => {
        if (closed || (sources.has(value.sourceId) && sources.get(value.sourceId).owner !== owner)) throw new Error('reminder-source-disposed')
        const next = Source.parse(input)
        if (next.sourceId !== value.sourceId || next.plugin !== value.plugin || next.sessionId !== value.sessionId) throw new Error('reminder-source-identity-changed')
        const previousCount = registeredRules()
        const totalRules = previousCount - (sources.get(next.sourceId)?.compiled.length ?? 0) + next.rules.length
        // Lowering a limit preserves registered rules. Only growth is refused until capacity is available.
        if (settings.maxRules && totalRules > settings.maxRules && totalRules > previousCount) {
          const message = `提醒规则总数 ${totalRules} 超过上限 ${settings.maxRules}（来源 ${next.sourceId}：${next.rules.length} 条）`
          rejectedSources.set(next.sourceId, { sourceId: next.sourceId, sourceRules: next.rules.length, totalRules, limit: settings.maxRules, message })
          throw Object.assign(new Error(message), { code: 'reminder-capacity-exceeded' })
        }
        if (new Set(next.rules.map(rule => rule.id)).size !== next.rules.length) throw new Error('reminder-duplicate-rule')
        const compiled = next.rules.map(rule => compileRule(rule, next.sourceId, next.revision))
        invalidate(value.sourceId)
        rejectedSources.delete(next.sourceId)
        sources.set(value.sourceId, { owner, acceptSession, token: randomUUID(), value: next, compiled })
      }
      replace(value)
      let disposed = false
      return { replace: next => { if (disposed) throw new Error('reminder-source-disposed'); replace(next) },
        async dispose() { if (disposed) return; disposed = true; invalidate(value.sourceId); sources.delete(value.sourceId)
          await Promise.allSettled([...running.values()].filter(run => run.items.some(item => item.source.sourceId === value.sourceId)).map(run => run.task)) } }
    },
    registerDetector(input) {
      const value = Detector.parse(input)
      if (closed || detectors.has(value.ref)) throw new Error('reminder-detector-unavailable')
      detectors.set(value.ref, value)
      return async () => { if (detectors.get(value.ref) !== value) return; detectors.delete(value.ref)
        const affected = [...running.values()].filter(run => run.items.some(item => item.rule.judge?.ref === value.ref))
        for (const run of affected) run.controller.abort(new Error('reminder-detector-disposed'))
        await Promise.allSettled(affected.map(run => run.task)) }
    },
    registerAnalyzer(input) {
      const value = Detector.parse({ exportName: 'analyze', ...input })
      if (closed || analyzers.has(value.ref) || ['__proto__', 'constructor', 'prototype'].includes(value.ref)) throw new Error('reminder-analyzer-unavailable')
      analyzers.set(value.ref, value)
      return async () => {
        if (analyzers.get(value.ref) !== value) return
        analyzers.delete(value.ref)
        const affected = [...running.values()].filter(run => run.analyzers.includes(value))
        for (const run of affected) run.controller.abort(new Error('reminder-analyzer-disposed'))
        await Promise.allSettled(affected.map(run => run.task))
      }
    },
    catalog(sessionId) {
      return [...sources.values()].filter(item => item.acceptSession(sessionId)).map(item => item.value).filter(source => source.sessionId === undefined || source.sessionId === sessionId)
        .map(source => ({ sourceId: source.sourceId, plugin: source.plugin, registration: 'reminderRules', executor: 'context-care',
          ...(source.sessionId ? { sessionId: source.sessionId } : {}), readOnly: true,
          rules: source.rules.map(rule => ({ id: rule.id, title: rule.title ?? rule.id, description: rule.text,
            definition: rule, actions: [{ id: 'model', title: '模型提醒', defaultEnabled: true }] })) }))
    },
    submit(rawEvent, signal) {
      if (closed || signal?.aborted) return Promise.resolve()
      // Reserve capacity before the first persistence await; pending writes are part of the queue.
      if (admissions.size >= config.maxQueued + config.maxConcurrent) return Promise.reject(new Error('reminder-capacity-exceeded'))
      const admittedAt = now(), serialized = JSON.stringify(rawEvent)
      if (Buffer.byteLength(serialized) > config.maxBytes) return Promise.reject(new Error('reminder-input-budget-exceeded'))
      const event = JSON.parse(serialized)
      const items = [...sources.values()].filter(item => item.acceptSession(event.sessionId) && (item.value.sessionId === undefined || item.value.sessionId === event.sessionId))
        .flatMap(item => item.compiled.filter(rule => requestEligible(rule, event) && eligible(event.sessionId, item.value.sourceId, rule.id))
          .map(rule => ({ rule, source: item.value, token: item.token, policy: epoch(event.sessionId, item.value.sourceId, rule.id),
            judge: rule.judge && detectors.get(rule.judge.ref),
            window: rule.deliver.model.once === 'window' ? localWindow(rule.when.timeWindow, event.clock?.at) : undefined })))
        .sort((a, b) => b.rule.priority - a.rule.priority || a.source.sourceId.localeCompare(b.source.sourceId) || a.rule.id.localeCompare(b.rule.id))
      if (!items.length) return Promise.resolve()
      const admission = { sessionId: event.sessionId }
      admissions.add(admission)
      let resolve
      const done = new Promise(finish => { resolve = finish })
      const run = { event, items, analyzers: [...analyzers.values()], controller: new AbortController(), deadline: admittedAt + config.roundTimeoutMs, resolve, done }
      const abort = () => {
        run.controller.abort(signal?.reason ?? new Error('reminder-round-timeout'))
        const queue = queues.get(event.sessionId), index = queue?.indexOf(run) ?? -1
        if (index >= 0) {
          queue.splice(index, 1); if (!queue.length) queues.delete(event.sessionId)
          void diagnostic(event.sessionId, { eventId: event.callId, status: signal?.aborted ? 'cancelled' : 'queue-timeout' }).finally(resolve)
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
      run.timer = setTimeout(abort, Math.max(0, run.deadline - now()))
      admission.task = update(event.sessionId, state => {
        if (run.controller.signal.aborted || state.seen.includes(event.callId)) return false
        state.seen.push(event.callId); return true
      }).then(admitted => {
        if (!admitted || closed || run.controller.signal.aborted || now() >= run.deadline) return
        const queue = queues.get(event.sessionId) ?? []; queue.push(run); queues.set(event.sessionId, queue); pump()
        return done
      }).finally(() => {
        clearTimeout(run.timer); signal?.removeEventListener('abort', abort); admissions.delete(admission)
      })
      return admission.task
    },
    async settle(sessionId) {
      // Previous callers have already received write failures. A new collection may retry the durable writer.
      await Promise.allSettled([...admissions].filter(item => item.sessionId === sessionId).map(item => item.task))
      await chains.get(sessionId)?.catch(() => {})
      await Promise.all([running.get(sessionId)?.done, ...(queues.get(sessionId) ?? []).map(run => run.done)])
      await chains.get(sessionId)?.catch(() => {})
    },
    snapshot(sessionId) { return clone({ ...(records.get(sessionId) ?? empty()), sources: [...sources.values()].map(item => item.value), storageError: failures.has(sessionId) }) },
    async collect({ sessionId, visible, accepted = [], committedIds = [], signal }) {
      await this.settle(sessionId); signal?.throwIfAborted()
      return update(sessionId, state => {
        const messages = [], present = [...visible, ...accepted]
        const keys = new Set(present.filter(message => message.source?.kind === KIND).map(message => message.source.reminder.key))
        const committed = new Set([...committedIds, ...present.map(message => message.id)])
        for (const candidate of state.candidates) {
          if (candidate.status !== 'reserved') continue
          if (committed.has(candidate.messageId)) candidate.status = 'delivered'
          else keys.add(candidate.key) // Unknown handoff cannot be retried merely because the process restarted.
        }
        for (const candidate of state.candidates) {
          if (candidate.status !== 'pending') continue
          if (!fresh(candidate) || !current(candidate) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
            || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) { candidate.status = 'discarded'; continue }
          if (keys.has(candidate.key) || state.windows.some(item => item.key === candidate.key)) { candidate.status = 'discarded'; continue }
          keys.add(candidate.key)
          candidate.messageId = randomUUID(); candidate.status = 'reserved'
          if (candidate.window) state.windows.push({ key: candidate.key, until: candidate.window.end, messageId: candidate.messageId })
          messages.push({ id: candidate.messageId, role: 'user', content: [{ type: 'text', text: candidate.text }],
            source: { kind: KIND, form: 'notice', summary: candidate.title,
              reminder: { key: candidate.key, candidateId: candidate.id },
              contextCareTrace: { trigger: 'reminder-rule', evaluationId: candidate.id, ruleId: candidate.ruleId,
                sourceId: candidate.sourceId, callId: candidate.eventId, rule: candidate.rule, evidence: candidate.evidence } } })
        }
        return messages
      })
    },
    async rollback(sessionId, messages) {
      const ids = new Set(messages.filter(message => message.source?.kind === KIND).map(message => message.id))
      if (!ids.size) return
      await update(sessionId, state => {
        for (const candidate of state.candidates) {
          if (candidate.status !== 'reserved' || !ids.has(candidate.messageId)) continue
          // An explicit snooze has no messageId and survives cancellation of this handoff.
          state.windows = state.windows.filter(item => item.messageId !== candidate.messageId)
          candidate.status = 'pending'; delete candidate.messageId
        }
      })
    },
    filterMessages(sessionId, visible, messages) {
      const keys = new Set(visible.filter(message => message.source?.kind === KIND).map(message => message.source.reminder.key))
      const state = records.get(sessionId)
      return messages.filter(message => {
        if (message.source?.kind !== KIND) return true
        const candidate = state?.candidates.find(item => item.messageId === message.id)
        if (!candidate || !fresh(candidate) || !current(candidate) || keys.has(candidate.key)
          || state.windows?.some(item => item.key === candidate.key && item.messageId !== message.id) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
          || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) return false
        keys.add(candidate.key); return true
      })
    },
    async close() {
      closed = true
      for (const queue of queues.values()) for (const run of queue) { clearTimeout(run.timer); run.resolve() }
      queues.clear()
      for (const run of running.values()) run.controller.abort(new Error('reminder-runtime-closed'))
      await Promise.allSettled([...running.values()].map(run => run.done))
      await Promise.allSettled([...admissions].map(item => item.task))
      await Promise.allSettled([...chains.values(), capacityWrite]); sources.clear(); detectors.clear(); analyzers.clear(); rejectedSources.clear()
    },
  }
}

/** First provider owns the service; later consumers reuse it through ctx.get. */
export async function ensureReminderService(ctx, input, controls) {
  const existing = ctx.get(REMINDER_SERVICE)
  if (existing) return existing
  const facility = ctx.get('storageDomain')
  const starting = serviceStarts.get(facility)
  if (starting) return starting
  const pending = startReminderService(ctx, input, controls, facility)
  serviceStarts.set(facility, pending)
  try { return await pending }
  finally { if (serviceStarts.get(facility) === pending) serviceStarts.delete(facility) }
}

async function startReminderService(ctx, input, controls, facility) {
  const config = ReminderConfig.parse(input)
  const domain = await facility.open(REMINDER_DOMAIN)
  // Another provider may have completed while storage was opening.
  const winner = ctx.get(REMINDER_SERVICE)
  if (winner) { await domain.close(); return winner }
  const resources = [['reminder-sessions', () => domain.close()]]
  let runtime
  try {
    // Global settings have their own domain, independent of existing session delivery records.
    const settingsDomain = await facility.open({ name: 'context_care_reminder_settings', version: 1, layout: 'per-record',
      tables: { settings: { valueSchema: CapacitySettings } } })
    resources.unshift(['reminder-settings', () => settingsDomain.close()])
    const settings = settingsDomain.table('settings'), table = domain.table('sessions')
    const matcher = createBoundedMatcher({ timeoutMs: config.ruleTimeoutMs,
      maxPending: config.maxConcurrent, maxIdle: config.maxIdle, maxBytes: config.maxBytes })
    resources.unshift(['reminder-worker', () => matcher.close()])
    await matcher.warmup()
    runtime = createReminderRuntime({ config, entries: [...table.entries()], save: (id, value) => table.put(id, value),
      capacity: settings.get('global'), saveCapacity: value => settings.put('global', value),
      dispatches: true, execute: (input, signal, timing) => matcher.detect(input, signal, timing), report: error => ctx.logger.warn(`reminder: ${error.message}`),
      eligible: (id, source, rule) => controls.enabled(id, source, rule, 'model'),
      epoch: (id, source, rule) => controls.epoch(id, source, rule) })
    resources.unshift(['reminder-runtime', () => runtime.close()])
  } catch (error) { await releaseResources(resources, error); throw error }
  ctx.effect(() => () => releaseResources(resources))
  ctx.provide(REMINDER_SERVICE, runtime)
  ctx.effect(() => controls.registerProvider(id => runtime.catalog(id)))
  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent || result.isError) return
    const visible = exec.agent.session.deriveMessages()
    let chars = config.maxContextChars
    const messages = []
    for (const message of (config.maxContextMessages ? visible.slice(-config.maxContextMessages) : []).reverse()) {
      const text = (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
      messages.unshift({ role: message.role, text: text.slice(-chars || text.length), truncated: text.length > chars })
      if (chars === 0) messages[0].text = ''
      chars = Math.max(0, chars - text.length)
    }
    const event = { sessionId: String(exec.agent.session.id), name: exec.name, arguments: exec.arguments,
      callId: String(exec.callId), rootCallId: String(exec.rootCallId ?? exec.callId),
      context: { messages, truncated: messages.length < visible.length || messages.some(message => message.truncated) } }
    void runtime.submit(event, exec.signal).catch(error => ctx.logger.warn(`reminder: ${error.message}`))
  })
  return runtime
}
