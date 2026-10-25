// @ts-check
import { createActionIndex, actionEventTypes } from './action-view-data.js'
import { createPromptIndex, promptEventTypes } from './prompt-view-data.js'
import { createDiagnosticPages } from '../lib/diagnostic-pages.js'
import { runtimePage } from './rule-runtime-data.js'
import { visibleReminderControls } from '../lib/reminder-runtime/control-view.js'
import { ensureSessionLog } from '../lib/session-log.js'

/** The composer and message markers need no journal pages or full diagnostic bodies.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} sessionId */
export function careStatus(ctx, sessionId) {
  const workbench = ctx.get('contextCareWorkbench')
  const runtime = workbench?.store.read(sessionId)?.runtime
  const agent = ctx.agents.get(/** @type {import('@deepseek-ai/dsh-session').SessionId} */ (sessionId))
  const token = agent && workbench ? workbench.token(agent, undefined) : undefined
  const markers = runtime && '$displayMarkers' in runtime.state ? runtime.state.$displayMarkers : undefined
  return {
    currentState: ctx.contextCareRequests.controls.currentSample(sessionId) ?? null,
    matchingFailures: (runtime?.runs ?? []).flatMap(run => {
      if (run === null || typeof run !== 'object' || Array.isArray(run) || (run.kind !== 'matching' && run.kind !== 'display')) return []
      return [{ id: run.id, sourceSeqs: run.sourceSeqs }]
    }),
    displayMarkers: Array.isArray(markers) && token !== undefined ? markers.flatMap(value =>
      value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.seq === 'number'
        && value.token === token ? [value.seq] : []) : [],
  }
}

/** One owner for HTTP reads and push subscriptions; no process-global cache.
 * @param {import('@deepseek-ai/cordis').Context} ctx */
export function createCarePages(ctx) {
  const history = ensureSessionLog(ctx)
  const actions = createDiagnosticPages(history, actionEventTypes, createActionIndex)
  const prompts = createDiagnosticPages(history, promptEventTypes, createPromptIndex)
  ctx.effect(() => () => { actions.close(); prompts.close() })
  /** @param {import('@deepseek-ai/dsh-session').Session} session
   * @param {'actions' | 'prompts'} topic
   * @param {{ offset: number, limit: number, seq?: number }} query */
  return (session, topic, query) => (topic === 'actions' ? actions : prompts)(session, ctx.contextCareRequests.diagnosticFeed(String(session.id)), query)
}

/** Build the subscribed page from committed owner state, without performing HTTP reads.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ view(sessionId: string): Promise<object> }} journal
 * @returns {(query: import('./care-stream.js').CareSubscriptionValue, signal: AbortSignal) => Promise<unknown>} */
export function createCareViewReader(ctx, journal, pages = createCarePages(ctx)) {
  return async (query, signal) => {
    signal.throwIfAborted()
    const { sessionId, topic, offset, seq } = query
    const id = /** @type {import('@deepseek-ai/dsh-session').SessionId} */ (sessionId)
    const session = ctx.sessions.get(id)
    if (!session) throw new Error(`context-care: session unavailable: ${sessionId}`)
    switch (topic) {
      case 'status': return careStatus(ctx, sessionId)
      case 'rewrites': return journal.view(sessionId)
      case 'controls': {
        const snapshot = ctx.contextCareRequests.controls.snapshot(sessionId)
        const reminders = ctx.get('reminderRules')
        return reminders ? { ...snapshot, sources: visibleReminderControls(snapshot.sources, await reminders.catalog(sessionId)) } : snapshot
      }
      case 'runtime': {
        const agent = ctx.agents.get(id)
        const workbench = ctx.get('contextCareWorkbench')
        if (!agent || !workbench) throw new Error('context-care: workbench unavailable')
        return runtimePage(workbench.inspect(agent), { ...query, limit: 20 })
      }
      case 'actions':
      case 'prompts': {
        const { items, admission, ...pagination } = pages(session, topic, { offset, seq, limit: 20 })
        const runtime = topic === 'actions' ? ctx.get('contextCareWorkbench')?.store.read(sessionId)?.runtime : undefined
        const matchingFailures = (runtime?.runs ?? []).flatMap(run => {
          if (run === null || typeof run !== 'object' || Array.isArray(run) || (run.kind !== 'matching' && run.kind !== 'display')) return []
          return [{ id: run.id, kind: run.kind, status: run.status, reason: run.reason, count: run.count,
            updatedAt: run.updatedAt, sourceSeqs: run.sourceSeqs, diagnostic: run.result }]
        })
        return { ...(topic === 'actions' ? { ...careStatus(ctx, sessionId), admission, matchingFailures } : {}),
          [topic]: items, ...pagination }
      }
    }
  }
}
