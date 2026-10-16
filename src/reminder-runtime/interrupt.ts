import type { OutputEvidence } from './output-stream.js'
import type { MessageView } from './request-context.js'
import type { createReminderRuntime } from './runtime.js'

type Runtime = ReturnType<typeof createReminderRuntime>
type ReminderMessage = Awaited<ReturnType<Runtime['collect']>>[number]
interface InterruptOptions<Agent> {
  runtime: Pick<Runtime, 'snapshot' | 'collect' | 'filterMessages' | 'rollback'>
  maxInterrupts: number
  sessionId: (agent: Agent) => string
  humanTurn: (agent: Agent) => string
  visible: (agent: Agent) => MessageView[]
  isCurrent: (agent: Agent, output: OutputEvidence) => boolean
  cancel: (agent: Agent) => void
  steer: (agent: Agent, message: ReminderMessage) => void
}

/** Reuse reserved reminder messages for cancel/steer, with one budget across automatic resumptions. */
export function createOutputInterrupt<Agent>(options: InterruptOptions<Agent>) {
  const budgets = new Map<string, { turn: string; count: number }>()
  const running = new Set<string>()
  return async (agent: Agent, output: OutputEvidence) => {
    const id = options.sessionId(agent), turn = options.humanTurn(agent)
    if (running.has(id) || options.maxInterrupts === 0 || !options.isCurrent(agent, output)) return
    const previous = budgets.get(id)
    const budget = previous?.turn === turn ? previous : { turn, count: 0 }
    if (budget.count >= options.maxInterrupts) return
    const ids = options.runtime.snapshot(id).candidates.filter(candidate => candidate.status === 'pending'
      && candidate.output?.attemptId === output.attemptId && candidate.output.index === output.index
      && candidate.rule.format === 'reminder/v3'
      && candidate.rule.deliver.model.interrupt === 'abort-resume').map(candidate => candidate.id)
    if (!ids.length) return
    running.add(id)
    try {
      const messages = await options.runtime.collect({ sessionId: id, visible: options.visible(agent), candidateIds: ids })
      const allowed = options.isCurrent(agent, output)
        ? options.runtime.filterMessages(id, options.visible(agent), messages) : []
      const denied = messages.filter(message => !allowed.includes(message))
      if (denied.length) await options.runtime.rollback(id, denied)
      if (!allowed.length) return
      // Rollback can yield to a new attempt or human input; recheck after that await.
      if (!options.isCurrent(agent, output) || options.humanTurn(agent) !== turn
        || options.runtime.filterMessages(id, options.visible(agent), allowed).length !== allowed.length) {
        await options.runtime.rollback(id, allowed)
        return
      }
      // No await separates the last stream check from cancel/steer.
      budget.count++; budgets.set(id, budget)
      try { options.cancel(agent) }
      catch (error) { await options.runtime.rollback(id, allowed); throw error }
      for (const message of allowed) options.steer(agent, message)
      // A throwing steer has an unknown handoff: its durable reservation remains occupied.
    } finally { running.delete(id) }
  }
}
