// @ts-check
/** @import { Context } from '@deepseek-ai/cordis' */
/** @import { Agent } from '@deepseek-ai/dsh-agent' */
/** @import { SessionId } from '@deepseek-ai/dsh-session' */
/** @import {} from '@deepseek-ai/dsh-tools' */
/** @import {} from '@deepseek-ai/dsh-storage-domain' */
/** @import { createRuleControls } from '../rule-controls.js' */
import { createReminderRuntime, ReminderConfig, REMINDER_DOMAIN, REMINDER_SERVICE, REMINDER_MESSAGE_KIND } from '../../lib/reminder-runtime/runtime.js'
import { createOutputStream } from './output-stream.js'
import { createOutputInterrupt } from '../../lib/reminder-runtime/interrupt.js'
import { createSessionIdentityResolver } from '../../lib/reminder-runtime/session-identity.js'
import { restoreReminderEntries } from '../../lib/reminder-runtime/restore.js'
import { availableParallelism } from 'node:os'
import { createBoundedMatcher } from '../bounded-matcher.js'
import { CapacitySettings } from '../reminder-capacity.js'
import { releaseResources } from '../resource-cleanup.js'
import { CLAIM_DOMAIN } from './claims.js'
import { createTemplates } from '../templates.js'
export { createReminderRuntime, ReminderConfig, REMINDER_DOMAIN, REMINDER_SERVICE }
export { ReminderScope } from './schema.js'

/** @type {WeakMap<Context['storageDomain'], Promise<ReturnType<typeof createReminderRuntime>>>} */
const serviceStarts = new WeakMap()

/** First provider owns the service; later consumers reuse it through ctx.get.
 * @param {Context} ctx
 * @param {unknown} input
 * @param {ReturnType<typeof createRuleControls>} controls
 */
export async function ensureReminderService(ctx, input, controls) {
  const existing = ctx.get(REMINDER_SERVICE)
  if (existing) return existing
  const facility = ctx.storageDomain
  const starting = serviceStarts.get(facility)
  if (starting) return starting
  const pending = startReminderService(ctx, input, controls, facility)
  serviceStarts.set(facility, pending)
  try { return await pending }
  finally { if (serviceStarts.get(facility) === pending) serviceStarts.delete(facility) }
}

/** @param {Context} ctx
 * @param {unknown} input
 * @param {ReturnType<typeof createRuleControls>} controls
 * @param {Context['storageDomain']} facility
 */
async function startReminderService(ctx, input, controls, facility) {
  const config = ReminderConfig.parse(input)
  const domain = await facility.open(REMINDER_DOMAIN)
  // Another provider may have completed while storage was opening.
  const winner = ctx.get(REMINDER_SERVICE)
  if (winner) { await domain.close(); return winner }
  /** @type {Array<[string, () => unknown]>} */
  const resources = [['reminder-sessions', () => domain.close()]]
  try {
    // Global settings have their own domain, independent of existing session delivery records.
    const settingsDomain = await facility.open({ name: 'context_care_reminder_settings', version: 1, layout: 'per-record',
      tables: { settings: { valueSchema: CapacitySettings } } })
    resources.unshift(['reminder-settings', () => settingsDomain.close()])
    const settings = settingsDomain.table('settings'), table = domain.table('sessions')
    const claimDomain = await facility.open(CLAIM_DOMAIN)
    resources.unshift(['reminder-claims', () => claimDomain.close()])
    const claimTable = claimDomain.table('claims')
    // Service startup is serialized per facility; all later mutations use the domain's atomic update.
    if (!claimTable.get('global')) await claimTable.put('global', { buckets: [] })
    // Retire obsolete persisted candidates before v4 validation. The service is
    // published only after these saves succeed; live registrations remain v4-only.
    const entries = await restoreReminderEntries(table.entries(), (id, state) => table.put(id, state))
    // 线程池大小按机器算，不按配置文件猜：参考实现用核心数的一半，
    // 我们沿用同一个尺度——匹配是后台计算，不该和用户抢满整机。
    const threads = config.maxIdle ?? Math.max(1, Math.floor(availableParallelism() / 2))
    // 在途任务上限不在这里给：那是背压，和线程数无关。并发轮次由 runtime 控制，
    // 这里只让 matcher 用自己的防御性默认值。
    const matcher = createBoundedMatcher({ timeoutMs: config.ruleTimeoutMs,
      maxIdle: threads, maxBytes: config.maxBytes })
    resources.unshift(['reminder-worker', () => matcher.close()])
    await matcher.warmup()
    const runtime = createReminderRuntime({ config, entries, templates: createTemplates(), save: (id, value) => table.put(id, value),
      capacity: settings.get('global'), saveCapacity: value => settings.put('global', value),
      resolveIdentity: createSessionIdentityResolver(ctx),
      updateClaims: change => claimTable.update('global', change),
      dispatches: true, execute: (input, signal, timing) => matcher.detect(input, signal, timing), report: error => ctx.logger.warn(`reminder: ${error instanceof Error ? error.message : String(error)}`),
      eligible: (id, source, rule) => controls.enabled(id, source, rule, 'model'),
      epoch: (id, source, rule) => controls.epoch(id, source, rule) })
    resources.unshift(['reminder-runtime', () => runtime.close()])
    const interrupt = createOutputInterrupt({ runtime, maxInterrupts: config.maxInterruptsPerTurn,
      sessionId: (/** @type {Agent} */ agent) => String(agent.session.id), visible: agent => agent.session.deriveMessages(),
      humanTurn: agent => {
        const events = agent.session.snapshotEvents()
        const arrival = events.findLast(event => event.type === 'agent/inbox/spliced'
          && event.data.inserted.some(message => message.source.kind === 'user'))
        return String(arrival?.seq ?? events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')?.seq ?? 'initial')
      },
      isCurrent: /** @returns {boolean} */ (agent, output) => outputStream.isCurrent(agent, output),
      cancel: agent => agent.cancel({ kind: 'hook', reason: 'reminder output rule' }, { keepInbox: true }),
      steer: (agent, message) => agent.steer(message) })
    const outputStream = createOutputStream({ config,
      sessionId: (/** @type {Agent} */ agent) => String(agent.session.id),
      submit: event => runtime.submit(event),
      afterSubmit: interrupt,
      report: error => ctx.logger.warn(`reminder: ${error instanceof Error ? error.message : String(error)}`),
      enabled: id => runtime.controlCatalog(id).some(source => source.rules.some(rule => rule.definition?.on === 'assistant.output')) })
    resources.unshift(['reminder-output-stream', () => outputStream.close()])
    ctx.effect(() => () => releaseResources(resources, undefined))
    ctx.provide(REMINDER_SERVICE, runtime)
    ctx.effect(() => controls.registerProvider((/** @type {string} */ id) => runtime.controlCatalog(id)))
    // Denial policy runs before the tool body. The evaluation is asynchronous here,
    // so the synchronous guard below is what actually stops the call.
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!exec.agent) return next()
      try {
        await runtime.prepareToolExecution({ key: exec.token, sessionId: String(exec.agent.session.id),
          name: exec.name, arguments: exec.arguments, callId: String(exec.callId),
          rootCallId: String(exec.rootCallId ?? exec.callId), signal: exec.signal })
      } catch (error) {
        // A failed policy evaluation leaves no ticket, and the guard then refuses the call.
        ctx.logger.warn(`reminder: 工具前置评估失败: ${error instanceof Error ? error.message : String(error)}`)
      }
      return next()
    })
    // Guards have no allow result, so no listener ordering can turn a denial back into permission.
    ctx.effect(() => ctx.tools.guard(exec => {
      if (!exec.agent) return undefined
      // The guard is the commit point: once it reads the ticket, the call either runs or fails here.
      // Settling immediately keeps the registry bounded even when the body never runs.
      const verdict = runtime.decideToolExecution(exec.token)
      runtime.settleToolExecution(exec.token)
      return verdict.kind === 'deny' ? verdict.reason : undefined
    }))
    ctx.on('tools/result', (exec, result) => {
      if (!exec.agent) return
      const visible = exec.agent.session.deriveMessages()
      let chars = config.maxContextChars
      const messages = []
      for (const message of (config.maxContextMessages ? visible.slice(-config.maxContextMessages) : []).reverse()) {
        const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        messages.unshift({ role: message.role, text: text.slice(-chars || text.length), truncated: text.length > chars })
        if (chars === 0) messages[0].text = ''
        chars = Math.max(0, chars - text.length)
      }
      const event = { type: result.isError ? 'tool.failed' : 'tool.succeeded',
        sessionId: String(exec.agent.session.id), name: exec.name, arguments: exec.arguments,
        ...(result.isError ? { error: { code: result.error?.info?.code } } : {}),
        callId: String(exec.callId), rootCallId: String(exec.rootCallId ?? exec.callId),
        context: { messages, truncated: messages.length < visible.length || messages.some(message => message.truncated) } }
      void runtime.submit(event, exec.signal).catch(error => ctx.logger.warn(`reminder: ${error.message}`))
    })
    ctx.on('agent/assistant-stream', ({ agent, frame }) => outputStream.observe(agent, frame))
    // Committed log events are the `session.event` trigger. A rule selects the DSH
    // event name; the persisted payload rides `arguments`, because `facts` belongs to
    // analyzers (matching clears it before they run, and their output must not be
    // overwritten by event data).
    ctx.on('session/event', (session, event) => {
      if (!runtime.handlesSessionEvent(event.type)) return
      const data = event.data
      // Classify the source. Loop prevention must tell our own delivery from a human turn,
      // and it needs the identity of the rule that produced the causing message.
      let origin = 'background'
      let causationId
      if (typeof data === 'object' && data !== null && 'source' in data && typeof data.source === 'object' && data.source !== null
        && 'kind' in data.source && data.source.kind === REMINDER_MESSAGE_KIND) {
        origin = 'reminder'
        const trace = 'contextCareTrace' in data.source ? data.source.contextCareTrace : undefined
        if (typeof trace === 'object' && trace !== null && 'sourceId' in trace && 'ruleId' in trace
          && typeof trace.sourceId === 'string' && typeof trace.ruleId === 'string') {
          causationId = `${trace.sourceId}:${trace.ruleId}`
        }
      } else if (event.type === 'user/message') origin = 'human'
      else if (event.type.startsWith('tool/')) origin = 'tool'
      const callId = `${event.type}#${event.seq}`
      void runtime.submit({ type: 'session.event', sessionId: String(session.id), name: event.type, arguments: data,
        callId, rootCallId: callId, origin, ...(causationId === undefined ? {} : { causationId }),
        clock: { at: typeof event.time === 'number' ? event.time : Date.now() } })
        .catch(error => ctx.logger.warn(`reminder: ${error instanceof Error ? error.message : String(error)}`))
    })
    return runtime
  } catch (error) { await releaseResources(resources, error); throw error }
}
