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
 * @param options fetcher and polling timers
 * @returns observable source, watch/refresh/change callbacks and disposer
 */
export function createControlRecords({ fetcher = fetch, pollMs = 2000, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let snapshot = new Map()
  let disposed = false
  const listeners = new Set()
  const watches = new Map()
  function publish(id, value) {
    if (disposed || !watches.has(id)) return
    snapshot = new Map(snapshot).set(id, value)
    for (const listener of listeners) listener()
  }
  async function read(watch) {
    if (disposed || watch.reading || watch.saving) return
    watch.reading = true
    const ticket = ++watch.ticket
    try {
      const response = await fetcher(`/context-care/rules?sessionId=${encodeURIComponent(watch.id)}`, {
        signal: watch.controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) throw await httpFailure(response, '/context-care/rules')
      const data = SnapshotWire.parse(await response.json())
      if (!Array.isArray(data.sources) || data.sessionId !== watch.id || !Number.isSafeInteger(data.revision)) throw new Error('Invalid rule controls response')
      if (watch.ticket === ticket && !watch.controller.signal.aborted) publish(watch.id, { status: 'ready', ...data, error: watch.saveError })
    } catch (error) {
      if (watch.ticket === ticket && !watch.controller.signal.aborted) publish(watch.id, { ...snapshot.get(watch.id), status: 'error', error: String(error) })
    } finally { watch.reading = false }
  }
  const timer = setTimer(() => { for (const watch of watches.values()) void read(watch) }, pollMs)
  return {
    source: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    watch(id) {
      if (disposed) return () => {}
      let watch = watches.get(id)
      if (!watch) {
        watch = { id, count: 0, ticket: 0, controller: new AbortController(), reading: false, saving: false }
        watches.set(id, watch); publish(id, { status: 'loading' }); void read(watch)
      }
      watch.count++
      return () => {
        if (--watch.count) return
        watch.controller.abort(); watch.ticket++; watches.delete(id)
        snapshot = new Map(snapshot); snapshot.delete(id)
        for (const listener of listeners) listener()
      }
    },
    refresh(id) { const watch = watches.get(id); if (watch) void read(watch) },
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
          publish(id, { status: 'ready', ...data, saved: true })
        }
      } catch (error) {
        if (ticket === watch.ticket && !watch.controller.signal.aborted) {
          watch.saveError = String(error)
          publish(id, { ...previous, status: 'error', saving: false, saved: false, error: watch.saveError })
        }
      } finally { watch.saving = false }
    },
    dispose() { disposed = true; clearTimer(timer); for (const watch of watches.values()) watch.controller.abort(); watches.clear(); listeners.clear(); snapshot = new Map() },
  }
}
