const failure = code => Object.assign(new Error(code), { code })

/** Resolve exact message identity from the host's Chat projection, never a nearby turn. */
export function sourceTarget(seq, entries, nodes) {
  const event = entries.find(entry => entry.event.seq === seq)?.event
  if (!event) return null
  if (['tool/call', 'tool/result'].includes(event.type) && event.data.callId) return { attribute: 'data-chat-call-id', id: event.data.callId }
  const kinds = {
    'user/message': ['user', 'steering', 'context', 'turn-trigger', 'compaction', 'manual-compaction', 'context-care-notice'],
    'assistant/message': ['assistant-step'], 'system/message': ['system-prompt'], 'request/header': ['system-prompt'], 'developer/message': ['context'],
  }[event.type]
  if (!kinds) return null
  const matches = nodes.filter(node => kinds.includes(node.kind) && (node.data?.seq === seq || node.data?.finalNode?.seq === seq
    || node.data?.compaction?.seq === seq
    || (['system/message', 'request/header'].includes(event.type) && node.id === String(seq))))
  // Our notice renders alongside the generic context. Prefer its visible dedicated row.
  const node = matches.find(node => node.kind === 'context-care-notice') ?? (matches.length === 1 ? matches[0] : null)
  return node ? { attribute: 'data-chat-node-key', id: node.key } : null
}

/** One bounded navigation owner per Session binding, released with that binding. */
export function createSourceNavigator({ binding, conversation, isCurrent, document: doc = globalThis.document }) {
  let generation = 0
  let disposed = false
  const pending = new Map()
  const cancel = () => { generation++; for (const [timer, resolve] of pending) { clearTimeout(timer); resolve() } pending.clear() }
  const pause = () => new Promise(resolve => { const timer = setTimeout(() => { pending.delete(timer); resolve() }, 50); pending.set(timer, resolve) })
  const root = () => {
    const roots = [...doc.querySelectorAll('[data-conversation-session][data-conversation-region="chat"]')]
      .filter(element => element.getAttribute('data-conversation-session') === binding.sessionId && element.getClientRects().length)
    if (roots.length !== 1) throw failure('jumpOpenChat')
    return roots[0]
  }
  return {
    cancel,
    dispose() { disposed = true; cancel() },
    async reveal(seq) {
      cancel()
      const ticket = generation
      const check = () => { if (disposed || ticket !== generation || !isCurrent()) throw failure('jumpCancelled') }
      check()
      if (!Number.isSafeInteger(seq) || seq < 0) throw failure('jumpUnavailable')
      root()
      await binding.session.loadThrough(seq)
      check()
      let entries = binding.eventSource.getSnapshot().entries
      const source = entries.find(entry => entry.event.seq === seq)?.event
      if (source && ['tool/call', 'tool/result'].includes(source.type)) {
        const call = entries.find(entry => entry.event.type === 'tool/call' && entry.event.data.callId === source.data.callId)?.event
        const rootCallId = call?.data.rootCallId ?? source.data.rootCallId ?? source.data.callId
        const rootCall = entries.find(entry => entry.event.type === 'tool/call' && entry.event.data.callId === rootCallId)?.event
        // A historical result may arrive before its call/root. Load the official history window;
        // keep the target's exact callId, even when its parent owns the outer chat seat.
        if (!call || !rootCall) {
          await binding.session.loadThrough(0)
          check()
        } else if (rootCall.seq < seq) {
          await binding.session.loadThrough(rootCall.seq)
          check()
        }
      }
      let found = false
      for (let attempt = 0; attempt < 40; attempt++) {
        check()
        const host = root()
        const nodes = conversation.snapshot.getSnapshot().views.get('chat')?.nodes.values() ?? []
        const target = sourceTarget(seq, binding.eventSource.getSnapshot().entries, nodes)
        const card = target && [...host.querySelectorAll(`[${target.attribute}]`)].find(element => element.getAttribute(target.attribute) === target.id)
        if (card) {
          found = true
          const hidden = []
          for (let element = card; element && element !== host; element = element.parentElement) if (element.hasAttribute('hidden')) hidden.push(element)
          if (hidden.length) {
            const outer = hidden.at(-1)
            if (outer.getAttribute('hidden') !== 'until-found') throw failure('jumpHidden')
            outer.dispatchEvent(new doc.defaultView.Event('beforematch', { bubbles: false }))
          } else if (card.getClientRects().length) {
            // beforematch also tells Chat's reading controller to stop following the tail.
            card.dispatchEvent(new doc.defaultView.Event('beforematch', { bubbles: true }))
            card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
            await pause()
            check()
            if (!card.isConnected || card.closest('[hidden]')) continue
            const box = card.getBoundingClientRect()
            const viewport = host.getBoundingClientRect()
            if (box.bottom > Math.max(0, viewport.top) && box.top < Math.min(doc.defaultView.innerHeight, viewport.bottom)
              && box.right > viewport.left && box.left < viewport.right) return { seq, ...target }
          }
        }
        await pause()
      }
      throw failure(found ? 'jumpUnsettled' : 'jumpMissing')
    },
  }
}

/** Slots receive only the callback; live services remain inside the apply closure. */
export function sourceNavigation(ctx) {
  const owners = new Map()
  ctx.effect(() => () => { for (const state of [...owners.values()]) state.release() })
  return sessionId => {
    const binding = ctx.sessions.binding(sessionId)
    if (!binding) throw new Error('context-care: Session binding unavailable')
    let state = owners.get(binding)
    if (!state) {
      const navigator = createSourceNavigator({ binding, conversation: ctx.uiConversation.binding(binding),
        isCurrent: () => ctx.sessions.binding(sessionId) === binding && ctx.sidebarRight.mounted.getSnapshot() === sessionId })
      const stop = ctx.sidebarRight.mounted.subscribe(() => { if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) navigator.cancel() })
      let released = false
      const release = () => { if (released) return; released = true; stop(); navigator.dispose(); owners.delete(binding) }
      state = { navigator, release }
      owners.set(binding, state)
      binding.ctx.effect(() => release, 'context-care: source navigation lifetime')
    }
    return seq => state.navigator.reveal(seq)
  }
}
