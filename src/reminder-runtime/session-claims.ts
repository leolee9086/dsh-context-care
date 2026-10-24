import { z } from 'zod'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-projection'
import { ReminderRule } from './schema.js'
import { localWindow } from './request-context.js'
import { quotaFor, type ClaimBookValue } from './claims.js'

const SharedFact = z.object({ key: z.string(), until: z.number().optional() })
const OwnedMessage = z.object({ id: z.string(), source: z.object({
  kind: z.literal('plugin:dsh-context-care:reminder'),
  reminder: z.object({ key: z.string(), candidateId: z.string(), sessionId: z.string().optional(),
    shared: SharedFact.nullable().optional() }),
  contextCareTrace: z.object({ sourceId: z.string(), ruleId: z.string(), rule: z.unknown(),
    evidence: z.object({ activationId: z.string().optional(),
      event: z.object({ clock: z.object({ at: z.number() }).optional() }).optional(),
      clock: z.object({ at: z.number() }).optional() }).optional() }).optional(),
}) })
const Owner = z.object({ source: z.object({ kind: z.string() }) })

/**
 * Shared quota is derived from delivered messages and the native pending inbox.
 * Only reservations not yet accepted into that inbox live solely in this cache.
 * @param ctx the owning Host context, including its native Session query service
 * @param now the clock used to discard expired quota windows
 * @returns serialized quota transitions and synchronous committed-event observation
 */
export function createSessionClaims(ctx: Context, now: () => number = Date.now) {
  let book: ClaimBookValue = { buckets: [] }
  let ready: Promise<void> | undefined
  let lane: Promise<unknown> = Promise.resolve()
  let closed = false
  let observationFailure: unknown
  const dirty = new Set<SessionId>()
  const chargedActivations = new Set<string>()
  const accepted = new Map<string, Set<string>>()

  function record(sessionId: string, value: unknown, status: 'reserved' | 'consumed') {
    if (Owner.safeParse(value).data?.source.kind !== 'plugin:dsh-context-care:reminder') return
    const message = OwnedMessage.parse(value), { reminder, contextCareTrace: trace } = message.source
    let shared = reminder.shared
    // Old messages already contain their rule and frozen event facts. New messages
    // record the charged identity explicitly, including null for an uncharged tick.
    if (shared === undefined) {
      if (!trace) throw new Error('reminder-shared-evidence-missing')
      const rule = ReminderRule.parse(trace.rule)
      if (!rule.effect.deliver.model.shared) return
      if (trace.evidence?.activationId && chargedActivations.has(trace.evidence.activationId)) return
      const clock = trace.evidence?.event?.clock?.at ?? trace.evidence?.clock?.at
      const window = 'timeWindow' in rule.when ? localWindow(rule.when.timeWindow, clock) : undefined
      shared = quotaFor({ sourceId: trace.sourceId, ruleId: trace.ruleId, rule, ...(window ? { window } : {}) })
    }
    if (!shared || (shared.until !== undefined && shared.until <= now())) return
    let bucket = book.buckets.find(item => item.key === shared.key)
    if (!bucket) {
      bucket = { key: shared.key, ...(shared.until === undefined ? {} : { until: shared.until }), claims: [] }
      book.buckets.push(bucket)
    }
    const previous = bucket.claims.find(claim => claim.messageId === message.id)
    if (previous) { if (status === 'consumed') previous.status = status }
    else bucket.claims.push({ candidateId: reminder.candidateId, sessionId: reminder.sessionId ?? sessionId,
      messageId: message.id, status })
    chargedActivations.add(reminder.candidateId)
  }

  function readInbox(session: Session, id: string, canceled = false) {
    const inbox = ctx.get('sessionProjections')?.stateOf(session, 'inbox')
    if (!inbox) throw new Error('reminder-shared-inbox-projection-unavailable')
    const messages = [...inbox['next-turn'], ...inbox['next-step']].filter(message =>
      message.source.kind === 'plugin:dsh-context-care:reminder' && message.source.reminder.shared !== null)
    const present = new Set(messages.map(message => String(message.id)))
    if (canceled) {
      const removed = new Set([...(accepted.get(id) ?? [])].filter(messageId => !present.has(messageId)))
      for (const bucket of book.buckets) bucket.claims = bucket.claims.filter(claim =>
        claim.status === 'consumed' || !removed.has(claim.messageId))
      book.buckets = book.buckets.filter(bucket => bucket.claims.length > 0)
    }
    for (const message of messages) record(id, message, 'reserved')
    if (present.size) accepted.set(id, present)
    else accepted.delete(id)
  }

  async function readSession(id: SessionId) {
    const query = ctx.get('sessionQuery'), projections = ctx.get('sessionProjections')
    if (!query || !projections) throw new Error('reminder-shared-session-history-unavailable')
    const log = await query.readSession(id)
    if (closed) throw new Error('reminder-claims-closed')
    let inboxChanged = false
    let processed = 0
    for (const event of log.events) {
      if (event.type === 'user/message') record(String(id), event.data, 'consumed')
      else if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message =>
        message.source.kind === 'plugin:dsh-context-care:reminder' && message.source.reminder.shared !== null)) inboxChanged = true
      // This is a finite corpus fold, not a timer or a repeated read. Yield on
      // progress so a large cold Session cannot monopolize Host HTTP dispatch.
      if (++processed % 2048 === 0) { await yieldToHost(); if (closed) throw new Error('reminder-claims-closed') }
    }
    // Use the live inbox when available. A dormant log with no reminder insertion
    // cannot own a pending reservation and needs no detached full Session replay.
    const live = ctx.sessions.get(id)
    if (live) readInbox(live, String(id))
    else if (inboxChanged) {
      const replay = ctx.sessions.prepare(id, { seed: log.events, meta: log.session,
        inheritedEventCount: log.inheritedEventCount, eventState: 'detached' })
      readInbox(replay, String(id))
    }
  }

  async function initialize() {
    const query = ctx.get('sessionQuery')
    if (!query) throw new Error('reminder-shared-session-history-unavailable')
    // Lifetime quotas need the logical corpus, including dormant sessions; reading
    // only sessions.get/list would silently reset another session's consumption.
    for (const { header } of await query.listSessions()) {
      dirty.delete(header.id)
      await readSession(header.id)
    }
  }

  return {
    /** Observe delivery commits without turning inbox acceptance into consumption. */
    observe(session: Session, event: SessionEvent) {
      if (closed) return
      try {
        if (event.type === 'user/message') record(String(session.id), event.data, 'consumed')
        else if (event.type === 'agent/inbox/spliced' && (accepted.has(String(session.id))
          || event.data.inserted.some(message => message.source.kind === 'plugin:dsh-context-care:reminder'
            && message.source.reminder.shared !== null))) {
          // A canceled inbox item releases a reservation. An ordinary claim only
          // hands it to pre-step: consumption still waits for user/message.
          readInbox(session, String(session.id), event.data.outcome === 'canceled')
        }
      } catch (error) { observationFailure = error; throw error }
    },
    /** A newly restored Session may contain commits published before this owner existed. */
    created(session: Session) { if (!closed) dirty.add(session.id) },
    /** Serialize cross-session reservations; no domain file or ACK participates. */
    update(change: (current: ClaimBookValue) => ClaimBookValue): Promise<ClaimBookValue> {
      const result = lane.then(async () => {
        if (closed) throw new Error('reminder-claims-closed')
        if (observationFailure) throw observationFailure
        ready ??= initialize().catch(error => { ready = undefined; throw error })
        await ready
        while (dirty.size) {
          const ids = [...dirty]; dirty.clear()
          for (const id of ids) await readSession(id)
        }
        if (closed) throw new Error('reminder-claims-closed')
        if (observationFailure) throw observationFailure
        const committed = new Set(book.buckets.flatMap(bucket => bucket.claims
          .filter(claim => claim.status === 'consumed').map(claim => claim.messageId)))
        const next = change(structuredClone(book))
        for (const bucket of next.buckets) for (const claim of bucket.claims) {
          if (claim.status === 'consumed' && !committed.has(claim.messageId)) {
            throw new Error('reminder-shared-delivery-not-committed')
          }
        }
        book = next
        return structuredClone(book)
      })
      lane = result.catch(() => { /* The caller owns the failure; later reservations can retry. */ })
      return result
    },
    /** Await owned reads and reservations before releasing this disposable cache. */
    async close() {
      closed = true
      await lane
      book = { buckets: [] }; dirty.clear(); chargedActivations.clear(); accepted.clear()
    },
  }
}
