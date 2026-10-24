import { z } from 'zod'
import { CARE_FRAME_BYTES, CareFrame, CareSubscription, careSubscriptionKey,
  type CareSubscriptionInput, type CareSubscriptionValue, type CareUpdate, type CareFrameValue } from './care-stream.js'

type Observer = (update: CareUpdate) => void
type Subscription = { query: CareSubscriptionValue; listeners: Set<Observer>; revision: number;
  snapshot?: Extract<CareFrameValue, { type: 'snapshot' }>; failure?: Extract<CareUpdate, { type: 'error' }> }

/** One connection carries data for every retained view. There are no notification-triggered GETs.
 * Membership changes, explicit refresh and native connection reset open a fresh snapshot stream. */
export function createClientChanges({ fetcher = fetch, report = (error: unknown) => console.error('context-care: subscription failed', error) } = {}) {
  const subscriptions = new Map<string, Subscription>()
  let controller: AbortController | undefined
  let disposed = false
  let scheduled = false
  const failureOf = (error: unknown): Extract<CareUpdate, { type: 'error' }> => ({ type: 'error',
    error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } })
  function deliver(entry: Subscription, update: CareUpdate) {
    for (const listener of entry.listeners) listener(update)
  }
  async function open(owned: AbortController, entries: Map<string, Subscription>) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const query = new URLSearchParams([...entries.values()].map(entry => ['subscription', JSON.stringify(entry.query)]))
      const response = await fetcher(`/context-care/changes?${query}`, { signal: owned.signal, headers: { accept: 'application/x-ndjson' } })
      if (!response.ok || !response.body) throw new Error(`context-care: subscription HTTP ${response.status}`)
      reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const encoder = new TextEncoder()
      let buffered = ''
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        buffered += decoder.decode(part.value, { stream: true })
        let end: number
        while ((end = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, end); buffered = buffered.slice(end + 1)
          if (!line) continue
          if (encoder.encode(line).byteLength + 1 > CARE_FRAME_BYTES) throw new Error('context-care: oversized subscription frame')
          const frame = CareFrame.parse(JSON.parse(line))
          const entry = entries.get(frame.key)
          if (!entry || entry.query.sessionId !== frame.sessionId || entry.query.topic !== frame.topic)
            throw new Error('context-care: subscription identity mismatch')
          if (controller !== owned || owned.signal.aborted) return
          if (frame.revision !== entry.revision + 1) throw new Error('context-care: subscription revision gap')
          if (frame.type === 'delta') {
            if (frame.topic !== 'rewrites' || !entry.snapshot || !Array.isArray(entry.snapshot.value.records))
              throw new Error('context-care: delta without rewrite snapshot')
            const records = new Map<string, Record<string, z.infer<ReturnType<typeof z.json>>>>()
            for (const record of [...entry.snapshot.value.records, ...frame.value.records]) {
              if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.hash !== 'string' || record.sessionId !== frame.sessionId)
                throw new Error('context-care: invalid rewrite delta record')
              records.set(record.hash, record)
            }
            for (const hash of frame.value.removed) records.delete(hash)
            entry.snapshot = { ...frame, type: 'snapshot', value: { records: [...records.values()] } }
          } else if (frame.type === 'snapshot') entry.snapshot = frame
          entry.failure = frame.type === 'error' ? frame : undefined
          entry.revision = frame.revision
          deliver(entry, frame)
        }
        if (encoder.encode(buffered).byteLength > CARE_FRAME_BYTES) throw new Error('context-care: oversized subscription frame')
      }
      if (!owned.signal.aborted) throw new Error(buffered ? 'context-care: truncated subscription frame' : 'context-care: subscription closed')
    } catch (error) {
      if (!owned.signal.aborted && !disposed && controller === owned) {
        const failure = failureOf(error)
        for (const entry of entries.values()) { entry.failure = failure; deliver(entry, failure) }
        report(error)
      }
    } finally {
      if (reader) {
        try { await reader.cancel() }
        catch (error) { if (!owned.signal.aborted && !disposed) report(error) }
        reader.releaseLock()
      }
    }
  }
  function schedule() {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      controller?.abort(); controller = undefined
      if (disposed || !subscriptions.size) return
      controller = new AbortController()
      for (const entry of subscriptions.values()) { entry.revision = 0; entry.snapshot = undefined; entry.failure = undefined }
      void open(controller, new Map(subscriptions))
    })
  }
  return {
    subscribe(input: CareSubscriptionInput, listener: Observer) {
      if (disposed) return () => {}
      const query = CareSubscription.parse(input), key = careSubscriptionKey(query)
      let entry = subscriptions.get(key)
      if (!entry) { entry = { query, listeners: new Set(), revision: 0 }; subscriptions.set(key, entry); schedule() }
      entry.listeners.add(listener)
      if (entry.failure) listener(entry.failure)
      else if (entry.snapshot) listener(entry.snapshot)
      const owned = entry
      let released = false
      return () => {
        if (released) return
        released = true; owned.listeners.delete(listener)
        if (!owned.listeners.size && subscriptions.get(key) === owned) {
          subscriptions.delete(key)
          if (!subscriptions.size) { controller?.abort(); controller = undefined }
          else schedule()
        }
      }
    },
    reset: schedule,
    refresh: schedule,
    dispose() { disposed = true; controller?.abort(); controller = undefined; subscriptions.clear() },
  }
}
