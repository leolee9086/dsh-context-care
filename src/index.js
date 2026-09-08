import { z } from 'zod'
import { createUserMessage } from './message.js'
import { calculateState, GUIDANCE, renderState, resolveConfig } from './policy.js'
import { contextCareProjection } from './projection.js'
import { selectRestRange } from './selection.js'

export const name = 'dsh-context-care'
export const inject = ['agents', 'tools', 'systemPrompt', 'tokenMeter', 'llm', 'compaction', 'sessionProjections']
// Standard Schema is consumed by Cordis before activation; no DSH schema helper.
export const Config = z.object({
  budgetRatio: z.number().optional(), wakefulnessRatio: z.number().optional(),
  fatigueExponent: z.number().optional(), retainRatio: z.number().optional(),
  minFreshTokens: z.number().int().optional(), maxNoteChars: z.number().int().optional(),
}).strict()

const requestPlugin = `${name}:request`
const statePlugin = `${name}:state`

function notice(plugin, text, summary, state) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin, form: 'notice', summary,
      ...(state ? { contextCare: { fatigueValue: state.fatigueValue, wakefulnessValue: state.wakefulnessValue } } : {}),
    },
  })
}

/** Read only the latest retained state; no process-local state can leak across sessions. */
export function previousState(session) {
  for (let index = session.surface.nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(session.surface.nodes[index])
    if (event?.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.source.plugin === statePlugin) {
      return {
        text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        fatigueValue: event.data.source.contextCare?.fatigueValue,
        wakefulnessValue: event.data.source.contextCare?.wakefulnessValue,
      }
    }
  }
  return undefined
}

/** Notify only on an integer percentage transition, a changed grade or a new outcome. */
export function shouldNotify(previous, text, state) {
  const percent = value => Number.isFinite(value) ? Math.floor(value) : null
  return previous?.text !== text
    || percent(previous?.fatigueValue) !== percent(state.fatigueValue)
    || percent(previous?.wakefulnessValue) !== percent(state.wakefulnessValue)
}

/** Attach tools and durable boundary-time status, leaving the compaction provider unchanged. */
export function apply(ctx, raw = {}) {
  return installContextCare(ctx, raw, ctx.compaction)
}

/** Shared installer also supports explicit activation on one already-running agent. */
export function installContextCare(ctx, raw, compaction) {
  const spec = resolveConfig(raw)
  ctx.effect(() => ctx.sessionProjections.register(contextCareProjection))
  ctx.effect(() => ctx.systemPrompt.context({ name, order: 90, text: GUIDANCE }))

  async function sample(agent, signal, proposed = []) {
    signal.throwIfAborted()
    const header = agent.session.requestHeader()
    const measurement = ctx.tokenMeter.measure(agent.session)
    const config = header?.config
    // The first envelope and a newly routed model have not yet been priced.
    if (!config?.provider || !config.model) return { state: { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null }, measurement }
    const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal)
    signal.throwIfAborted()
    const capacity = info.context?.contextWindow
    const incoming = proposed.reduce((sum, message) => sum + ctx.tokenMeter.estimateMessage(message), 0)
    return {
      state: calculateState(measurement.totalTokens + incoming, measurement.surfaceTokens + incoming, capacity, spec),
      measurement,
      capacity,
    }
  }

  ctx.effect(() => ctx.tools.register({
    name: 'context_status',
    description: 'Read measured context fatigue and wakefulness. These are estimates, not memory-loss diagnoses or a task deadline. Use when deciding whether a checkpoint would help; do not poll repeatedly.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('context_status accepts an empty object')
      if (!exec.agent) throw new Error('context_status requires an owning session')
      const { state } = await sample(exec.agent, exec.signal)
      return renderState(state)
    },
    presentCall: () => ({ card: 'generic', title: 'Context state', kind: 'read' }),
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'context_rest',
    description: 'Request one history compaction at the next safe request boundary, even below automatic pressure thresholds. Supply a concise continuation note; recent history and this note remain available. This schedules compaction, does not erase files, does not end the task, and is not a sleep timer. Continue from the reported outcome.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['note'],
      properties: { note: { type: 'string', minLength: 1, maxLength: spec.maxNoteChars, description: `Continuation note: objective, verified progress, pending work, important paths. At most ${spec.maxNoteChars} characters; save longer irreplaceable details to files first.` } },
    },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('context_rest requires an owning session')
      exec.signal.throwIfAborted()
      if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.note !== 'string'
        || Object.keys(args).some(key => key !== 'note') || args.note.trim().length === 0 || args.note.length > spec.maxNoteChars) throw new Error(`context_rest note must contain 1-${spec.maxNoteChars} characters`)
      // Inbox insertion is durable. All calls in this batch settle before pre-step claims it.
      exec.agent.inject(notice(requestPlugin,
        `Continuation note for requested history compaction (agent-authored):\n${args.note}`,
        'History compaction requested'))
      return 'History compaction scheduled for the next request boundary. It has not completed yet; the next context-care status will report the outcome. Continue the task afterward.'
    },
    presentCall: () => ({ card: 'generic', title: 'Request history compaction', kind: 'other' }),
  }))

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const generation = agent.session.surface.replaceGeneration
    // Let normal admission and existing automatic safety compaction settle first.
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const requested = decision.messages.some(message => message.source.kind === 'plugin' && message.source.plugin === requestPlugin)
    let outcome
    let current
    try {
      current = await sample(agent, signal, decision.messages)
      if (requested) {
        if (agent.session.surface.replaceGeneration !== generation) {
          outcome = 'history already reduced by automatic maintenance at this boundary; no additional compaction'
        } else if (!current.capacity) {
          outcome = 'not performed: capacity is unavailable; history retained'
        } else {
          const range = selectRestRange(agent.session, current.measurement,
            Math.floor(current.capacity * spec.retainRatio), spec.minFreshTokens, name)
          if (range === null) {
            outcome = 'not performed: no sufficiently large fresh prefix outside the retained recent history'
          } else {
            await compaction.compactRegion(range.start, range.end, agent, signal)
            outcome = 'completed: older history summarized; recent history and the continuation note retained'
            current = await sample(agent, signal, decision.messages)
          }
        }
      }
    } catch (error) {
      if (signal.aborted) throw error
      ctx.logger.warn(`context-care: ${error instanceof Error ? error.message : String(error)}`)
      outcome = requested ? 'request did not finish normally; do not assume compaction completed; inspect the checkpoint before another request' : undefined
      current = { state: { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null } }
    }
    const text = renderState(current.state, outcome)
    const previous = previousState(agent.session)
    if (!requested && !shouldNotify(previous, text, current.state)) return decision
    return { ...decision, messages: [...decision.messages, notice(statePlugin, text, 'Context state', current.state)] }
  }, { prepend: true })
}
