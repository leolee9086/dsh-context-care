import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-projection'
import { ensureSessionLog, type SessionLogRead } from '../session-log.js'
import type { RecipientFacts } from './scope.js'

/** Read current recipient facts through the Host's shared native log access. */
export function createSessionIdentityResolver(ctx: Context) {
  const history = ensureSessionLog(ctx)
  const selections = new WeakMap<Session, { value: string | undefined }>()
  ctx.on('session/created', session => {
    if (session.firstLiveSeq === 0) selections.set(session, { value: session.header.agentPreset })
  })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'agent-preset/selected') selections.set(session, { value: event.data.agentPreset ?? undefined })
  })
  function currentPreset(session: Session, log: SessionLogRead) {
    const projected = ctx.get('sessionProjections')?.stateOf(session, 'agentPreset')
    if (projected !== undefined) return projected ?? undefined
    const cached = selections.get(session)
    if (cached) return cached.value
    const event = log.last('agent-preset/selected')
    const value = event?.type === 'agent-preset/selected' ? event.data.agentPreset ?? undefined : log.header.agentPreset
    selections.set(session, { value })
    return value
  }
  return async (id: string, signal?: AbortSignal): Promise<RecipientFacts> => {
    const nativeId = id as SessionId
    for (;;) {
      signal?.throwIfAborted()
      using log = await history.read(nativeId, signal)
      const session = ctx.sessions.get(nativeId) ?? log.prepare()
      const projections = ctx.get('sessionProjections'), presets = ctx.get('agentPresets')
      const agentPreset = currentPreset(session, log)
      const document = agentPreset === undefined ? undefined : await presets?.readDocument(agentPreset)
      signal?.throwIfAborted()
      const live = ctx.sessions.get(nativeId)
      if (live && live !== session) continue
      if (currentPreset(session, log) !== agentPreset) continue
      const agent = ctx.get('agents')?.get(nativeId)
      const defaults = agent ? presets?.serviceFor(agent, 'agentDefaultModel') : ctx.get('agentDefaultModel')
      const selection = projections?.stateOf(session, 'modelSelection')?.pending
        ?? session.requestHeader()?.config ?? defaults?.currentSelection()
      return { ...(agentPreset === undefined ? {} : { agentPreset }),
        ...(document?.name === undefined ? {} : { agentPresetName: document.name }),
        ...(selection === undefined ? {} : { provider: selection.provider, model: selection.model }) }
    }
  }
}
