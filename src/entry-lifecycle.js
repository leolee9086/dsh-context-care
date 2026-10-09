import { z } from 'zod'

const Materialization = z.object({ text: z.string(), turnId: z.string(), turn: z.number().int().nonnegative(),
  stickyUntilTurn: z.number().int().nonnegative().nullable() }).strict()

/** Read the durable turn counter, never the length of a compressed message view. A session with no turn has ordinal zero. */
export function entryTurn(session) {
  const event = session.snapshotEvents().findLast(event => event.type === 'turn/start')
  if (!event) return 0
  if (!Number.isSafeInteger(event.data.turn) || event.data.turn < 0) throw new Error('entry-turn-unavailable')
  return event.data.turn
}

/** Compute activation without writing state. Held text is reused until its declared lifetime or sticky interval expires. */
export function entryPolicy(entry, previous, { turnId, turn, matches, now = Date.now() }) {
  const materialization = previous?.materialization === undefined ? undefined : Materialization.parse(previous.materialization)
  const held = !!materialization && (entry.lifetime === 'session'
    || entry.lifetime === 'turn' && materialization.turnId === turnId
    || entry.lifetime === 'turns' && turn >= materialization.turn && turn < materialization.turn + entry.lifetimeTurns
    || entry.lifetime === 'until-inactive' && matches)
  const sticky = !!materialization && materialization.stickyUntilTurn !== null && turn >= materialization.turn && turn <= materialization.stickyUntilTurn
  const reuse = held || sticky
  const inactive = !!materialization && !reuse && !matches
  const reason = reuse ? undefined
    : previous?.lastActivationAt !== undefined && now - previous.lastActivationAt < entry.cooldownMs ? 'entry-activation-interval'
      : previous?.lastInactiveAt !== undefined && now - previous.lastInactiveAt < entry.activationCooldownMs ? 'entry-inactive-cooldown' : undefined
  return { matches, reuse, inactive, reason, ...(reuse ? { text: materialization.text } : {}) }
}

/** Commit only after a confirmed request handoff. Reusing a held slice does not restart its lifetime or minimum activation interval. */
export function deliveredEntry(entry, previous, policy, text, { turnId, turn, now = Date.now() }) {
  const old = policy.reuse ? Materialization.parse(previous.materialization) : undefined
  const stickyUntilTurn = entry.stickyTurns && policy.matches ? turn + entry.stickyTurns : old?.stickyUntilTurn ?? null
  return { ...previous, lastStarted: now, ...(policy.reuse ? {} : { lastActivationAt: now }), turnId,
    materialization: { text, turnId: old?.turnId ?? turnId, turn: old?.turn ?? turn, stickyUntilTurn } }
}

/** An inactive entry retains the last activation and deactivation times, but contributes no held slice. */
export function deactivatedEntry(previous, now = Date.now()) {
  const { materialization, ...remaining } = previous
  return { ...remaining, lastInactiveAt: now }
}
