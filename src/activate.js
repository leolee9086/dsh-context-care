import { z } from 'zod'
import { installContextCare, inject as agentInject, previousState, shouldNotify } from './index.js'
import { calculateState, renderState, resolveConfig } from './policy.js'
import { createUserMessage } from './message.js'
import { producedBy, producerKind } from './producer-source.js'

export const name = 'dsh-context-care-activate'
export const inject = ['agents', 'agentPresets', 'tools']
export const Config = z.object({ sessionId: z.string().trim().min(1) }).strict()

/** Apply to an explicitly selected live session without replacing its preset or other tools. */
export async function apply(ctx, config) {
  const agent = ctx.agents.get(config.sessionId)
  // After restart, the regular preset supplies the feature when the session resumes.
  if (!agent) return
  if (ctx.tools.get('context_rest', agent)) {
    // A running preset keeps its old generation. Enrich its observations without
    // replacing tools or its compaction policy; new producers already carry numbers.
    const fiber = await agent.ctx.plugin({
      name: 'context-care-live-numeric', inject: ['tokenMeter', 'llm'],
      apply(scoped) {
        scoped.on('agent/pre-step', async ({ agent: owner, signal }, next) => {
          const decision = await next()
          if (decision.kind === 'reject' || signal.aborted) return decision
          const isState = message => producedBy(message.source, 'dsh-context-care:state')
          const existing = decision.messages.find(isState)
          if (existing?.source.contextCare) return decision
          const header = owner.session.requestHeader()?.config
          const info = header?.provider && header.model ? await scoped.llm.resolveModelInfo(header.provider, header.model, signal) : null
          signal.throwIfAborted()
          const measurement = scoped.tokenMeter.measure(owner.session)
          const incoming = decision.messages.filter(message => !isState(message)).reduce((sum, message) => sum + scoped.tokenMeter.estimateMessage(message), 0)
          const state = calculateState(measurement.totalTokens + incoming, measurement.surfaceTokens + incoming, info?.context?.contextWindow, resolveConfig())
          const prior = previousState(owner.session)
          const notificationText = existing ? existing.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : renderState(state)
          const requested = decision.messages.some(message => producedBy(message.source, 'dsh-context-care:request'))
          if (!requested && !shouldNotify(prior, notificationText, state)) {
            return existing ? { ...decision, messages: decision.messages.filter(message => !isState(message)) } : decision
          }
          const numeric = createUserMessage({
            content: [{ type: 'text', text: renderState(state) }],
            source: { kind: producerKind('dsh-context-care:state'), form: 'notice', summary: 'Context state', contextCare: { fatigueValue: state.fatigueValue, wakefulnessValue: state.wakefulnessValue } },
          })
          // Keep any outcome text from the old producer; values are display-only.
          const messages = existing
            ? decision.messages.map(message => isState(message) ? createUserMessage({ content: message.content, source: { ...message.source, contextCare: numeric.source.contextCare } }) : message)
            : [...decision.messages, numeric]
          return { ...decision, messages }
        }, { prepend: true })
      },
    })
    ctx.effect(() => () => fiber.dispose())
    return
  }
  const compaction = ctx.agentPresets.serviceFor(agent, 'compaction')
  if (!compaction) throw new Error('context-care activation: target session has no compaction provider')
  const fiber = await agent.ctx.plugin({
    name: 'context-care-live',
    inject: agentInject.filter(service => service !== 'compaction'),
    apply(scoped) { installContextCare(scoped, {}, compaction) },
  })
  ctx.effect(() => () => fiber.dispose())
}
