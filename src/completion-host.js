import { z } from 'zod'
import { parseCompletion } from './completion-observer.js'
import { createSessionCompletions } from '../lib/session-completions.js'
import { ensureSessionLog } from '../lib/session-log.js'

/** Completion wording and delivery are projections of the native Session log. */
export const name = 'context-care-completion'
export const inject = ['sessions', 'contextCareRequests']
export const Config = z.object({ cooldownMs: z.number().int().nonnegative().default(300000),
  maxObservedChars: z.number().int().positive().default(65536), notifications: z.boolean().default(true),
  maxDeliveries: z.number().int().positive().default(2) }).strict().prefault({})

/** @param {import('@deepseek-ai/cordis').Context} ctx @param {import('zod').output<typeof Config>} config */
export async function apply(ctx, config) {
  await openCompletionHost(ctx, config)
}

/**
 * Read committed output and request inputs without an observation/outbox side store.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('zod').output<typeof Config>} config
 */
export async function openCompletionHost(ctx, config) {
  const controls = ctx.contextCareRequests.controls
  const sourceId = 'dsh-context-care:completion'
  ctx.effect(() => controls.register({ sourceId, plugin: 'dsh-context-care', registration: 'completion', executor: 'dsh-context-care',
    rules: [{ id: 'completion', title: 'control_completion', actions: [{ id: 'notice', defaultEnabled: config.notifications }] }] }))
  const service = createSessionCompletions({ sessions: ctx.sessions, logs: ensureSessionLog(ctx), ...config, parse: parseCompletion,
    active: session => controls.enabled(String(session.id), sourceId, 'completion', 'notice'),
    since: session => controls.sinceSeq(String(session.id), sourceId, 'completion') })
  ctx.provide('contextCareCompletion', service)
  // A stream prefix is not a completed output. Only its committed Session event
  // can open cooldown or produce a notice, including after an empty-cache restore.
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'end' && frame.outcome.kind === 'committed') {
      void service.reconcile(agent.session).catch(error => ctx.logger.warn(`context-care: completion failed: ${String(error)}`))
    }
  })
  ctx.effect(() => () => service.close())
  return service
}
