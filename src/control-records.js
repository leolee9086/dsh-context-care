import { httpFailure } from './http-failure.js'
import { z } from 'zod'

// Validate nested wire data before publishing it to rendering components. A
// malformed response remains an explicit read/save error, never a partial ACK.
const ActionWire = z.object({ id: z.string().min(1), title: z.string().optional(), selected: z.boolean(),
  enabled: z.boolean(), reason: z.string(), defaultEnabled: z.boolean().optional(), available: z.boolean().optional(),
  requires: z.array(z.string()).optional() })
const RuleWire = z.object({ id: z.string().min(1), title: z.string().optional(), description: z.string().optional(),
  paused: z.boolean(), actions: z.array(ActionWire).min(1) })
const SnapshotWire = z.object({ sessionId: z.string(), revision: z.number().int().nonnegative(),
  storageError: z.string().optional(), sample: z.json().optional(), sources: z.array(z.object({
    sourceId: z.string().min(1), plugin: z.string().nullable(), registration: z.string(), executor: z.string(),
    sessionId: z.string().optional(), rules: z.array(RuleWire),
  })) })

/**
 * Own session subscriptions and acknowledged edits. Never optimistically change an executor switch.
 * @param options fetcher and shared change subscription
 * @returns observable source, watch/refresh/change callbacks and disposer
 */
export function createControlRecords({ fetcher = fetch, changes } = {}) {
  let snapshot = new Map()
  let disposed = false
  const listeners = new Set()
  const watches = new Map()
  function publish(id, value) {
    if (disposed || !watches.has(id)) return
    snapshot = new Map(snapshot).set(id, value)
    for (const listener of listeners) listener()
  }
  function receive(watch, update) {
    if (disposed || watch.controller.signal.aborted) return
    try {
      if (update.type === 'error') throw new Error(`${update.error.name}: ${update.error.message}`)
      if (update.type !== 'snapshot') throw new Error('Unexpected rule controls delta')
      const data = SnapshotWire.parse(update.value)
      if (data.sessionId !== watch.id) throw new Error('Invalid rule controls session')
      // A pushed commit can arrive before the PATCH acknowledgement. Keep the
      // save pending until its own response arrives, without discarding newer data.
      const previous = snapshot.get(watch.id)
      if (previous?.revision > data.revision) return
      publish(watch.id, { ...data, status: 'ready', saving: watch.saving, error: watch.saveError })
    } catch (error) {
      publish(watch.id, { ...snapshot.get(watch.id), status: 'error', error: String(error) })
    }
  }
  return {
    source: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    watch(id) {
      if (disposed) return () => {}
      let watch = watches.get(id)
      if (!watch) {
        watch = { id, count: 0, ticket: 0, controller: new AbortController(), saving: false }
        watches.set(id, watch)
        publish(id, { status: 'loading' })
        watch.unsubscribe = changes.subscribe({ sessionId: id, topic: 'controls' }, update => receive(watch, update))
      }
      watch.count++
      let released = false
      return () => {
        if (released) return
        released = true
        if (--watch.count) return
        watch.controller.abort(); watch.unsubscribe?.(); watch.ticket++; watches.delete(id)
        snapshot = new Map(snapshot); snapshot.delete(id)
        for (const listener of listeners) listener()
      }
    },
    refresh() { changes.refresh() },
    async change(id, change) {
      const watch = watches.get(id)
      const previous = snapshot.get(id)
      if (!watch || watch.saving || previous?.status !== 'ready') return
      watch.saving = true
      const ticket = ++watch.ticket
      publish(id, { ...previous, saving: true, saved: false, error: undefined })
      try {
        const response = await fetcher(`/context-care/rules?sessionId=${encodeURIComponent(id)}`, { method: 'PATCH', signal: watch.controller.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...change, revision: previous.revision }) })
        if (!response.ok) throw await httpFailure(response, '/context-care/rules')
        const data = SnapshotWire.parse(await response.json())
        if (!Array.isArray(data.sources) || data.sessionId !== id || data.revision !== previous.revision + 1) throw new Error('Invalid save acknowledgement')
        if (ticket === watch.ticket && !watch.controller.signal.aborted) {
          watch.saveError = undefined
          const current = snapshot.get(id)
          publish(id, { ...(current?.revision > data.revision ? current : data), status: 'ready', saved: true, saving: false, error: undefined })
        }
      } catch (error) {
        if (ticket === watch.ticket && !watch.controller.signal.aborted) {
          watch.saveError = String(error)
          publish(id, { ...snapshot.get(id), status: 'error', saving: false, saved: false, error: watch.saveError })
        }
      } finally { watch.saving = false }
    },
    dispose() { disposed = true; for (const watch of watches.values()) { watch.controller.abort(); watch.unsubscribe?.() } watches.clear(); listeners.clear(); snapshot = new Map() },
  }
}
