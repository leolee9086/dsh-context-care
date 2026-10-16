import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { RecipientFacts } from './scope.js'

/** Read the recipient's current preset metadata and selected model from Host services. */
export function createSessionIdentityResolver(ctx: Context) {
  return async (id: string, signal?: AbortSignal): Promise<RecipientFacts> => {
    const session = ctx.sessions.get(id as SessionId)
    if (!session) throw new Error(`reminder-session-unavailable: ${id}`)
    const projections = ctx.get('sessionProjections'), presets = ctx.get('agentPresets')
    const currentPreset = () => {
      const projected = projections?.stateOf(session, 'agentPreset')
      if (projected !== undefined) return projected ?? undefined
      // Headless hosts may omit the projection registration; the committed selection still owns the fact.
      const selection = session.snapshotEvents().slice().reverse().find(event => event.type === 'agent-preset/selected')
      return selection?.data.agentPreset ?? session.header.agentPreset
    }
    for (;;) {
      signal?.throwIfAborted()
      const agentPreset = currentPreset()
      const document = agentPreset === undefined ? undefined : await presets?.readDocument(agentPreset)
      signal?.throwIfAborted()
      if (currentPreset() !== agentPreset) continue
      const agent = ctx.get('agents')?.get(session.id)
      const defaults = agent ? presets?.serviceFor(agent, 'agentDefaultModel') : ctx.get('agentDefaultModel')
      const selection = projections?.stateOf(session, 'modelSelection')?.pending
        ?? session.requestHeader()?.config ?? defaults?.currentSelection()
      return { ...(agentPreset === undefined ? {} : { agentPreset }),
        ...(document?.name === undefined ? {} : { agentPresetName: document.name }),
        ...(selection === undefined ? {} : { provider: selection.provider, model: selection.model }) }
    }
  }
}
