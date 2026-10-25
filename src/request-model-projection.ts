import type { SessionCache } from './session-cache.js'

/** Freeze only owned projection data, never the request or native message itself. */
function freezeProjection(value: unknown, seen = new WeakSet<object>()): void {
  if (value && typeof value === 'object' && !Object.isFrozen(value) && !seen.has(value)) {
    seen.add(value)
    for (const child of Object.values(value)) freezeProjection(child, seen)
    Object.freeze(value)
  }
}

/** One planning operation borrows immutable bodies; envelope ids and positions stay per view. */
export function createRequestModelProjection<M extends object, B>(cache: SessionCache, project: (message: M) => readonly B[]) {
  const owner = {}; let closed = false
  const active = () => { if (closed) throw new Error('request-model-projection-closed') }
  const key = cache.define<object, { messages: WeakMap<M, readonly B[]>; system?: { text: string; blocks: readonly B[] } }>(
    'request-model-projection', 'Planning lifetime; immutable message identities, exact clone lineage and explicitly invalidated writes.',
    () => ({ messages: new WeakMap() }))
  const build = (message: M) => {
    const blocks = project(message)
    freezeProjection(blocks); cache.worked(key)
    return blocks
  }
  return {
    read(message: M): readonly B[] {
      active(); const state = cache.use(owner, key)
      let blocks = state.messages.get(message)
      if (!blocks) { blocks = build(message); state.messages.set(message, blocks) }
      return blocks
    },
    system(text: string, message: M): readonly B[] {
      active(); const state = cache.use(owner, key)
      if (state.system?.text !== text) state.system = { text, blocks: build(message) }
      return state.system.blocks
    },
    /** The planner has just cloned all messages but has not edited any payload yet. */
    cloned(before: readonly M[], after: readonly M[]): void {
      active()
      if (before.length !== after.length) throw new Error('request-projection-clone-length-mismatch')
      const state = cache.use(owner, key)
      for (let index = 0; index < before.length; index++) {
        const blocks = state.messages.get(before[index])
        if (blocks) state.messages.set(after[index], blocks)
      }
    },
    /** Detach the cloned message before its first payload edit; old cuts stay valid. */
    changed(message: M): void {
      active(); cache.use(owner, key).messages.delete(message)
    },
    close(): void { if (!closed) { closed = true; cache.clear(key) } },
  }
}
