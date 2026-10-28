import { DeliveryConfig as ReminderConfig, createOutputInterrupt, shutdownEventRuntime as shutdownReminderRuntime, createBoundedMatcher, createTemplates, handoffQueuedDelivery, requestContext } from '@leolee9086/dsh-rule-engine'
import { CapacitySettings } from '@leolee9086/dsh-rule-engine/catalog-capacity'
// @ts-check
/** @import { Context } from '@deepseek-ai/cordis' */
/** @import { Agent } from '@deepseek-ai/dsh-agent' */
/** @import { SessionId } from '@deepseek-ai/dsh-session' */
/** @import {} from '@deepseek-ai/dsh-tools' */
/** @import {} from '@deepseek-ai/dsh-storage-domain' */
/** @import { createRuleControls } from '@leolee9086/dsh-rule-engine' */
import { createReminderRuntime, REMINDER_SERVICE } from '../../lib/reminder-runtime/runtime.js'
import { createOutputStream } from '../../lib/reminder-runtime/output-stream.js'

import { createSessionIdentityResolver } from '../../lib/reminder-runtime/session-identity.js'

import { availableParallelism } from 'node:os'

import { releaseResources } from '../resource-cleanup.js'
import { createSessionClaims } from '../../lib/reminder-runtime/session-claims.js'
import { createSessionDeliveries } from '../../lib/reminder-runtime/session-deliveries.js'
import { createToolEvents } from '../../lib/reminder-runtime/tool-events.js'
import { nativeOutputAttempt } from '../../lib/reminder-runtime/native-output-events.js'

import { ensureSessionLog } from '../../lib/session-log.js'
export { createReminderRuntime, REMINDER_SERVICE }

/** @type {WeakMap<Context['storageDomain'], Promise<ReturnType<typeof createReminderRuntime>>>} */
const serviceStarts = new WeakMap()

/** First provider owns the service; later consumers reuse it through ctx.get.
 * @param {Context} ctx
 * @param {unknown} input
 * @param {ReturnType<typeof createRuleControls>} controls
 * @param {import('@leolee9086/dsh-rule-engine').Engine} engine
 */
export async function ensureReminderService(ctx, input, controls, engine) {
  const existing = ctx.get(REMINDER_SERVICE)
  if (existing) return existing
  const facility = ctx.storageDomain
  const starting = serviceStarts.get(facility)
  if (starting) return starting
  const pending = startReminderService(ctx, input, controls, facility, engine)
  serviceStarts.set(facility, pending)
  try { return await pending }
  finally { if (serviceStarts.get(facility) === pending) serviceStarts.delete(facility) }
}

/** Queue unlogged matches as native context; this never starts a turn.
 * @param {Context} ctx
 * @param {ReturnType<typeof createReminderRuntime>} runtime
 * @param {string} sessionId
 * @param {readonly string[]} candidateIds
 */
async function handoffPending(ctx, runtime, sessionId, candidateIds) {
  const agent = ctx.get('agents')?.get(/** @type {SessionId} */ (sessionId))
  if (!agent) throw new Error('reminder-native-inbox-agent-unavailable')
  const history = ensureSessionLog(ctx)
  await handoffQueuedDelivery({ runtime, sessionId, candidateIds,
    visible: () => history.messages(agent.session), publish: message => agent.inject(message) })
}

/** @param {Context} ctx
 * @param {unknown} input
 * @param {ReturnType<typeof createRuleControls>} controls
 * @param {import('@leolee9086/dsh-rule-engine').Engine} engine
 * @param {Context['storageDomain']} facility
 */
async function startReminderService(ctx, input, controls, facility, engine) {
  const config = ReminderConfig.parse(input)
  const winner = ctx.get(REMINDER_SERVICE)
  if (winner) return winner
  /** @type {Array<[string, () => unknown]>} */
  const resources = []
  try {
    // Global settings have their own domain, independent of existing session delivery records.
    const settingsDomain = await facility.open({ name: 'context_care_reminder_settings', version: 1, layout: 'per-record',
      tables: { settings: { valueSchema: CapacitySettings } } })
    resources.unshift(['reminder-settings', () => settingsDomain.close()])
    const settings = settingsDomain.table('settings')
    const sharedClaims = createSessionClaims(ctx), deliveries = createSessionDeliveries(ctx)
    resources.unshift(['reminder-delivery-cache', () => deliveries.close()])
    resources.unshift(['reminder-claims-cache', () => sharedClaims.close()])
    ctx.on('session/event', (session, event) => {
      sharedClaims.observe(session, event)
      deliveries.observe(session, event)
    })
    ctx.on('session/created', session => { sharedClaims.created(session); deliveries.created(session) })
    // Candidate, seen and delivery projections are rebuilt from Session logs.
    // The retired v1 candidate table is deliberately neither opened nor cleared.
    // 线程池大小按机器算，不按配置文件猜：参考实现用核心数的一半，
    // 我们沿用同一个尺度——匹配是后台计算，不该和用户抢满整机。
    const threads = config.maxIdle ?? Math.max(1, Math.floor(availableParallelism() / 2))
    // 在途任务上限不在这里给：那是背压，和线程数无关。并发轮次由 runtime 控制，
    // 这里只让 matcher 用自己的防御性默认值。
    const matcher = createBoundedMatcher({ timeoutMs: config.ruleTimeoutMs,
      maxIdle: threads, maxBytes: config.maxBytes })
    resources.unshift(['reminder-worker', () => matcher.close()])
    await matcher.warmup()
    const history = ensureSessionLog(ctx)
    const toolEvents = createToolEvents({ ...config, output: config }, { sessions: ctx.sessions, logs: history,
      readSession: (id, signal) => history.read(id, signal) })
    resources.unshift(['reminder-tool-cache', () => toolEvents.close()])
    const runtime = createReminderRuntime({ config, sessionAuthoritative: true, templates: createTemplates(),
      capacity: settings.get('global'), saveCapacity: value => settings.put('global', value),
      changed: id => ctx.get('contextCareChanges')?.changed(id, ['controls', 'runtime']),
      resolveIdentity: createSessionIdentityResolver(ctx),
      resolveEvent: (event, signal) => toolEvents.resolve(event, signal),
      sinceSeq: (id, source, rule) => controls.sinceSeq(id, source, rule),
      updateClaims: change => sharedClaims.update(change),
      readDeliveries: (id, humanId, fromSeq) => deliveries.read(id, humanId, fromSeq),
      wasHanded: (id, eventId, outputRule, fromSeq) => deliveries.wasHanded(id, eventId, outputRule, fromSeq),
      readQueued: id => deliveries.queued(id),
      handoffPending: async (id, ids) => { await handoffPending(ctx, runtime, id, ids) },
      dispatches: true, execute: (input, signal, timing) => matcher.detect(input, signal, timing), report: error => ctx.logger.warn('reminder:', error),
      eligible: (id, source, rule, action) => controls.enabled(id, source, rule, action),
      epoch: (id, source, rule) => controls.epoch(id, source, rule) }, engine)
    resources.unshift(['reminder-runtime', () => shutdownReminderRuntime(runtime)])
    const interrupt = createOutputInterrupt({ runtime, maxInterrupts: config.maxInterruptsPerTurn,
      sessionId: (/** @type {Agent} */ agent) => String(agent.session.id), visible: agent => history.messages(agent.session),
      prepareHumanTurn: async agent => { await deliveries.humanTurn(String(agent.session.id)) },
      humanTurn: agent => deliveries.currentHumanTurn(String(agent.session.id)),
      isCurrent: /** @returns {boolean} */ (agent, output) => outputStream.isCurrent(agent, output),
      cancel: agent => agent.cancel({ kind: 'hook', reason: 'reminder output rule' }, { keepInbox: true }),
      steer: (agent, message) => agent.steer(message) })
    const outputStream = createOutputStream({ config,
      sessionId: (/** @type {Agent} */ agent) => String(agent.session.id),
      attemptId: agent => history.withLive(agent.session, log => nativeOutputAttempt(agent.session, log)),
      submit: event => runtime.submit(event),
      afterSubmit: interrupt,
      report: error => ctx.logger.warn('reminder:', error),
      enabled: id => runtime.observesEvent(id, 'assistant.output') })
    resources.unshift(['reminder-output-stream', () => outputStream.close()])
    ctx.effect(() => () => releaseResources(resources, undefined))
    ctx.provide(REMINDER_SERVICE, runtime)
    ctx.effect(() => controls.registerProvider((/** @type {string} */ id) => runtime.controlCatalog(id)))
    // Denial policy runs before the tool body. The evaluation is asynchronous here,
    // so the synchronous guard below is what actually stops the call.
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!exec.agent) return next()
      // Entry failures propagate to the registry's tool result with their original cause.
      await runtime.prepareToolExecution({ key: exec.token, sessionId: String(exec.agent.session.id),
        name: exec.name, arguments: exec.arguments, callId: String(exec.callId),
        rootCallId: String(exec.rootCallId ?? exec.callId),
        native: toolEvents.preparation(exec.agent.session, String(exec.callId)), signal: exec.signal })
      return next()
    })
    // Guards have no allow result, so no listener ordering can turn a denial back into permission.
    ctx.effect(() => ctx.tools.guard(exec => {
      if (!exec.agent) return undefined
      // The guard is the commit point: once it reads the ticket, the call either runs or fails here.
      // Settling immediately keeps the registry bounded even when the body never runs.
      const verdict = runtime.decideToolExecution(exec.token)
      runtime.settleToolExecution(exec.token)
      if (verdict.kind === 'allow') return undefined
      if (verdict.error) throw verdict.error
      return verdict.reason
    }))
    ctx.on('session/event', (session, event) => {
      const submission = toolEvents.observe(session, event)
      if (submission) void runtime.submit(submission.event)
        .catch(error => ctx.logger.warn('reminder:', error))
    })
    ctx.on('tools/result', (exec, result) => {
      if (!exec.agent) return
      if (toolEvents.waitForCommit(exec.agent.session, String(exec.callId))) return
      const visible = history.tail(exec.agent.session, config.maxContextMessages)
      const context = requestContext(visible, config)
      const event = { type: result.isError ? 'tool.failed' : 'tool.succeeded',
        sessionId: String(exec.agent.session.id), name: exec.name, arguments: exec.arguments,
        ...(result.isError ? { error: { code: result.error?.info?.code } } : {}),
        callId: String(exec.callId), rootCallId: String(exec.rootCallId ?? exec.callId),
        context }
      void runtime.submit(event, exec.signal).catch(error => ctx.logger.warn('reminder:', error))
    })
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (frame.type !== 'end') return outputStream.observe(agent, frame)
      if (frame.outcome.kind === 'abandoned') return outputStream.abandon(agent, frame)
      const outcome = frame.outcome
      const terminal = history.withLive(agent.session, log => log.at(outcome.seq))
      if (!terminal) throw new Error('reminder-native-output-terminal-missing')
      outputStream.observe(agent, { ...frame, time: terminal.time })
    })
    // Committed log events are the `session.event` trigger. A rule selects the DSH
    // event name; the persisted payload rides `arguments`, because `facts` belongs to
    // analyzers (matching clears it before they run, and their output must not be
    // overwritten by event data).
    ctx.on('session/event', (session, event) => {
      if (!runtime.handlesSessionEvent(event.type)) return
      // Reuse the same canonical payload and source classification during replay.
      void runtime.submit(toolEvents.observeSession(session, event))
        .catch(error => ctx.logger.warn('reminder:', error))
    })
    return runtime
  } catch (error) { await releaseResources(resources, error); throw error }
}
