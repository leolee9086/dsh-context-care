import { z } from 'zod'
import { captureInputPricing } from './input-pricing.js'
import { installContextCare, inject as agentInject, previousState, shouldNotify } from './index.js'
import { calculateState, renderState, resolveConfig } from './policy.js'
import { createUserMessage } from './message.js'
import { producedBy, producerKind } from './producer-source.js'
import { CARE_SOURCE, controlledState } from './control-catalog.js'

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
          const envelope = owner.session.requestHeader()
          const config = envelope?.config
          const info = config?.provider && config.model ? await scoped.llm.resolveModelInfo(config.provider, config.model, signal) : null
          signal.throwIfAborted()
          const pricing = captureInputPricing({ meter: scoped.tokenMeter, llm: scoped.llm, session: owner.session, header: envelope,
            requests: scoped.get('contextCareRequests') })
          const measurement = pricing.measure()
          const incoming = pricing.priceMessages(decision.messages.filter(message => !isState(message)))
          const retained = measurement.surfaceTokens
          const spec = resolveConfig()
          const load = Math.ceil(measurement.inputTokens + incoming)
          const state = calculateState(load, retained, info?.context?.contextWindow, spec)
          const requested = decision.messages.some(message => producedBy(message.source, 'dsh-context-care:request'))
          const controls = scoped.get('contextCareRequests')?.controls
          controls?.sample(String(owner.session.id), state)
          const existingText = existing?.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
          const outcome = existingText?.split('\n').find(line => /^(休息结果：|Rest outcome:)/.test(line))
            ?.replace(/^(休息结果：|Rest outcome:\s*)/, '').replace(/[。.]$/, '')

          const rendered = controls ? controlledState(state, outcome,
            (ruleId, actionId) => controls.enabled(String(owner.session.id), CARE_SOURCE, ruleId, actionId), requested) : renderState(state)
          const prior = previousState(owner.session)
          const notificationText = controls ? rendered : existingText ?? rendered

          if (!requested && (!rendered || !shouldNotify(prior, notificationText, state))) {
            return existing ? { ...decision, messages: decision.messages.filter(message => !isState(message)) } : decision
          }
          const numeric = createUserMessage({
            content: [{ type: 'text', text: rendered }],
            source: { kind: producerKind('dsh-context-care:state'), form: 'notice', summary: 'Context state', contextCare: { fatigueValue: state.fatigueValue, wakefulnessValue: state.wakefulnessValue } },
          })
          // Keep any outcome text from the old producer; values are display-only.
          const messages = existing
            ? decision.messages.map(message => isState(message) ? createUserMessage({ content: controls ? numeric.content : message.content, source: { ...message.source, contextCare: numeric.source.contextCare } }) : message)
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
