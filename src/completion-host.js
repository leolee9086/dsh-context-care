import { z } from 'zod'
import { completionStateKey, createCompletionObserver, createCompletionStateStore, parseCompletion } from './completion-observer.js'
import { openCompletionNotices } from './completion-notices.js'

/** One Host owns observation state and the durable completion-notice outbox. */
export const name = 'context-care-completion'
export const inject = ['storageDomain', 'contextCareRequests']
export const Config = z.object({ cooldownMs: z.number().int().nonnegative().default(300000),
  maxObservedChars: z.number().int().positive().default(65536), notifications: z.boolean().default(true),
  maxDeliveries: z.number().int().positive().default(2) }).strict().prefault({})

/** Observe authoritative text blocks once and settle from committed output, with bounded parsing. */
export async function apply(ctx, config) {
  const store = createCompletionStateStore({ storageDomain: ctx.storageDomain })
  await store.ready
  let notices
  try { notices = await openCompletionNotices(ctx.storageDomain) }
  catch (error) {
    await store.close().catch(closeError => ctx.logger.warn(`context-care: completion rollback failed: ${String(closeError)}`))
    throw error
  }
  const observer = createCompletionObserver({ ...store, cooldownMs: config.cooldownMs })
  const attempts = new Map()
  const chains = new Map()
  const failures = new Map()
  function enqueue(sessionId, run) {
    const task = (chains.get(sessionId) ?? Promise.resolve()).then(run)
    chains.set(sessionId, task)
    task.catch(error => {
      failures.set(sessionId, error)
      ctx.logger.warn(`context-care: completion failed: ${String(error)}`)
    })
    return task
  }
  async function flush(sessionId) {
    await Promise.all([...chains].filter(([id]) => sessionId === undefined || id === String(sessionId)).map(([, task]) => task))
    for (const [id, error] of failures) if (sessionId === undefined || id === String(sessionId)) throw error
  }
  const inputFor = (sessionId, occurrenceId, text) => ({ sessionId, sourceId: 'assistant', occurrenceId, text })
  async function publish(session, event, candidate) {
    if (!config.notifications || candidate === undefined) return
    await ctx.contextCareRequests.flush(session.id)
    const record = ctx.contextCareRequests.list(session.id).find(record => record.kind === 'request'
      && record.data.eventSeq === event.seq && record.data.outcome === 'completed' && record.data.dispatched)
    if (record?.data.route !== undefined) await notices.publish(session, event.seq, record.data.route, candidate, config.maxDeliveries)
  }
  async function reconcile(session) {
    // Requests already carry the committed output sequence, so replay neither
    // guesses a source model nor treats an interrupted prefix as completion.
    await ctx.contextCareRequests.flush(session.id)
    const records = ctx.contextCareRequests.list(session.id).filter(record => record.kind === 'request'
      && record.data.purpose === 'conversation' && record.data.eventSeq !== undefined).sort((a, b) => a.data.eventSeq - b.data.eventSeq)
    for (const record of records) {
      const input = inputFor(String(session.id), record.data.attemptId ?? `committed:${record.data.eventSeq}`, '')
      const event = session.eventAt(record.data.eventSeq)
      if (event?.type !== 'assistant/message' || event.data.interrupted || !record.data.dispatched) {
        await observer.recover(input)
        continue
      }
      if (notices.seen(session, event.seq)) continue
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
      const candidate = text.length <= config.maxObservedChars ? parseCompletion(text) : undefined
      if (candidate !== undefined) {
        const previous = await store.load(completionStateKey(String(session.id), 'assistant'))
        // A crash after settlement but before publishing must finish its outbox
        // write, without bypassing cooldown for a different occurrence.
        if (previous?.completedOccurrenceId === input.occurrenceId) await publish(session, event, candidate)
        else if ((await observer.observe({ ...input, text })).status === 'pending') {
          await observer.settle(input)
          await publish(session, event, candidate)
        }
      } else await observer.recover(input)
      await notices.mark(session, event.seq)
    }
  }
  const service = {
    flush,
    collect: (session, request) => config.notifications ? notices.collect(session, request) : [],
    reserve: (session, segments, callId) => enqueue(String(session.id), () => notices.reserve(session, segments, callId)),
    dispatched: (session, segments, callId, request) => enqueue(String(session.id), () => notices.dispatched(session, segments, callId, request)),
    reconcile: session => enqueue(String(session.id), () => reconcile(session)),
    list: notices.list,
  }
  ctx.provide('contextCareCompletion', service)
  const dispose = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const sessionId = String(agent.session.id)
    const key = JSON.stringify([sessionId, String(frame.attemptId)])
    if (frame.type === 'start') {
      attempts.set(key, { observed: false, chars: 0, unavailable: false })
      return
    }
    const state = attempts.get(key)
    if (state === undefined) return
    if (frame.type === 'chunk') {
      if (frame.chunk.type !== 'block-end' || frame.chunk.block.type !== 'text' || state.observed || state.unavailable) return
      state.chars += frame.chunk.block.text.length
      if (state.chars > config.maxObservedChars) { state.unavailable = true; return }
      const input = inputFor(sessionId, String(frame.attemptId), frame.chunk.block.text)
      if (parseCompletion(input.text) === undefined) return
      state.observed = true
      void enqueue(sessionId, () => observer.observe(input))
      return
    }
    if (frame.type !== 'end') return
    attempts.delete(key)
    const event = frame.outcome.kind === 'committed' ? agent.session.eventAt(frame.outcome.seq) : undefined
    // Capture only the authoritative committed event. No delta accumulation and
    // no full-history scan on every chunk; failed streams never publish notices.
    void enqueue(sessionId, async () => {
      const input = inputFor(sessionId, String(frame.attemptId), '')
      if (event?.type !== 'assistant/message' || event.data.interrupted) { await observer.recover(input); return }
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
      const candidate = text.length <= config.maxObservedChars ? parseCompletion(text) : undefined
      if (candidate === undefined) {
        if (state.observed) await observer.recover(input)
        await notices.mark(agent.session, event.seq)
        return
      }
      const observed = await observer.observe({ ...input, text })
      if (observed.status === 'pending') {
        await observer.settle(input)
        await publish(agent.session, event, candidate)
      }
      await notices.mark(agent.session, event.seq)
    })
  })
  ctx.effect(() => async () => {
    dispose()
    try { await flush() } finally { attempts.clear(); try { await notices.close() } finally { await store.close() } }
  })
}
