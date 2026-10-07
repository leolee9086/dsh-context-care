import { z } from 'zod'
import { OutputPatternConfig } from './output-patterns.js'

export const ScopedPromptConfig = z.object({
  ruleId: z.string().min(1), version: z.string().min(1), provider: z.string().min(1), model: z.string().min(1),
  purposes: z.array(z.enum(['conversation', 'compaction', 'session-title'])).min(1).default(['conversation']),
  trigger: z.enum(['static', 'model-switch', 'output-pattern']), initialBind: z.boolean().default(false), text: z.string().min(1),
  detector: OutputPatternConfig.optional(), carryFromOtherRoute: z.boolean().default(false),
}).strict().superRefine((rule, ctx) => {
  if ((rule.trigger === 'output-pattern') !== (rule.detector !== undefined)) ctx.addIssue({ code: 'custom', message: 'detector is required only for output-pattern' })
  if (rule.trigger === 'output-pattern' && (rule.purposes.length !== 1 || rule.purposes[0] !== 'conversation')) {
    ctx.addIssue({ code: 'custom', message: 'output-pattern observes conversation output only' })
  }
})

/** Resolve exact-route rules once; rule ids identify a single version in this contribution. */
export function resolveScopedPrompts(input = []) {
  const rules = z.array(ScopedPromptConfig).parse(input)
  const ids = new Set()
  for (const rule of rules) {
    if (ids.has(rule.ruleId)) throw new Error(`context-care: duplicate scoped prompt ${rule.ruleId}`)
    ids.add(rule.ruleId)
  }
  return rules
}

/** Select segments against actual routed input, never against model-name substrings. */
export function selectScopedPrompts(rules, request, previousRoute) {
  const purpose = request.purpose ?? 'conversation'
  return rules.filter(rule => rule.provider === request.provider && rule.model === request.model && rule.purposes.includes(purpose)
    && (rule.trigger === 'static' || (rule.trigger === 'model-switch' && (previousRoute === undefined ? rule.initialBind
      : previousRoute.provider !== request.provider || previousRoute.model !== request.model)))).map(rule => ({
    ruleId: rule.ruleId, version: rule.version, trigger: rule.trigger, provider: request.provider, model: request.model, purpose,
    text: rule.text.replaceAll('{boundModelLabel}', `${request.provider}/${request.model}`),
  }))
}

/** Append request-only context; its durable decision is metadata on a log-only request/header. */
export function withScopedPrompts(request, segments) {
  if (segments.length === 0) return request
  return { ...request, messages: [...request.messages, {
    role: 'user', content: [{ type: 'text', text: segments.map(segment => segment.text).join('\n\n') }],
    source: { kind: 'plugin:dsh-context-care:scoped-prompts' },
  }] }
}
