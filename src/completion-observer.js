/** Durable, source-scoped completion observations for bounded output notices. */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { markdownStatements } from './output-patterns.js'

const ENGLISH = /\b(?:done|complete|completed|finished|successfully finished|task complete|all set)\b/i
const CHINESE = /(?:已完成|完成了|任务完成|处理完毕|全部完成|搞定)/u
const NEGATED_ENGLISH = /\b(?:not|never|isn't|is not|unfinished)\b[\s\S]{0,24}\b(?:done|complete|completed|finished)\b/i
const NEGATED_CHINESE = /(?:未完成|没完成|没有完成|尚未完成|还没完成|未搞定)/u

function visibleLines(text) {
  return markdownStatements(String(text)).map(statement => statement.text)
}

/**
 * Parse only visible, affirmative completion labels.
 * @param {string} text model output or a bounded completion block
 * @returns {{label: string, line: string}|undefined}
 */
export function parseCompletion(text) {
  for (const raw of visibleLines(text)) {
    const line = raw.trim()
    if (line.length === 0 || NEGATED_ENGLISH.test(line) || NEGATED_CHINESE.test(line)) continue
    const match = line.match(ENGLISH) ?? line.match(CHINESE)
    if (match !== null) return { label: match[0], line }
  }
  return undefined
}

function identity(input) {
  return completionStateKey(input?.sessionId, input?.sourceId)
}

const COMPLETION_PENDING = z.object({
  occurrenceId: z.string().min(1),
  label: z.string().min(1),
  line: z.string().min(1),
}).strict()

const COMPLETION_STATE = z.object({
  version: z.literal(1),
  pending: COMPLETION_PENDING.optional(),
  cooldownUntil: z.number().int().nonnegative(),
  completedOccurrenceId: z.string().optional(),
}).strict()

/** Structural storage-domain declaration owned by this plugin. */
export const COMPLETION_STATE_DOMAIN = {
  name: 'context_care_completion',
  version: 1,
  layout: 'per-record',
  tables: {
    observations: { valueSchema: COMPLETION_STATE },
  },
}

/** Encode one opaque identity as path-safe fixed-width Unicode code points. */
function encodeIdentityPart(value) {
  return [...value].map(character => character.codePointAt(0).toString(16).padStart(6, '0')).join('')
}

/** Encode opaque session/source identity into a storage-table key. */
export function completionStateKey(sessionId, sourceId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('completion state requires sessionId')
  if (typeof sourceId !== 'string' || sourceId.length === 0) throw new Error('completion state requires sourceId')
  const legacy = `${encodeIdentityPart(sessionId)}_${encodeIdentityPart(sourceId)}`
  // Keep all legacy keys that can form a JSON filename. UUID session ids plus
  // a source name can exceed the filesystem's 255-byte component limit; those
  // identities could never persist with the old encoding, so hash only them.
  return legacy.length <= 250 ? legacy : `sha256_${createHash('sha256').update(JSON.stringify([sessionId, sourceId])).digest('hex')}`
}

/**
 * Create a durable state adapter over the injected storage-domain service.
 *
 * The `ready` promise is awaited by every read and write. With the real
 * service, a successful `save` therefore includes the storage-domain
 * durability acknowledgement. Opening, validation and write errors retain
 * their original identity. The caller owns the handle and must drain users
 * before closing it; no process-local substitute is used.
 *
 * @param {object} options
 * @param {object} options.storageDomain required Host service
 * @returns {object} observer store and lifecycle promise
 */
export function createCompletionStateStore({ storageDomain } = {}) {
  if (storageDomain === undefined) throw new Error('completion state requires storageDomain')
  const opening = Promise.resolve().then(() => storageDomain.open(COMPLETION_STATE_DOMAIN))
  const table = async () => (await opening).table('observations')
  return {
    ready: opening,
    load: async key => (await table()).get(key),
    save: async (key, value) => (await table()).put(key, value),
    close: async () => (await opening).close(),
  }
}

/**
 * Create an observer that awaits durable pending and settlement writes.
 * @param {object} options required load/save store, clock and cooldown
 * @returns {object} source-aware observe/settle/recover operations
 */
export function createCompletionObserver({ load, save, now = () => Date.now(), cooldownMs = 300000 }) {
  if (typeof load !== 'function' || typeof save !== 'function') throw new Error('completion observer requires a durable load/save store')

  async function current(key) {
    const value = await load(key)
    return value === undefined || value === null ? { version: 1, pending: undefined, cooldownUntil: 0 } : value
  }

  async function observe(input) {
    const key = identity(input)
    const candidate = parseCompletion(input.text)
    if (candidate === undefined) return { status: 'ignored', key }
    const previous = await current(key)
    if (previous.cooldownUntil > now()) return { status: 'cooldown', key, state: previous }
    if (previous.pending?.line === candidate.line && (input.occurrenceId === undefined || previous.pending.occurrenceId === input.occurrenceId)) {
      return { status: 'pending', key, state: previous }
    }
    const next = {
      version: 1,
      pending: { occurrenceId: input.occurrenceId ?? `${now()}`, label: candidate.label, line: candidate.line },
      cooldownUntil: 0,
    }
    await save(key, next)
    return { status: 'pending', key, state: next }
  }

  async function settle(input) {
    const key = identity(input)
    const previous = await current(key)
    if (previous.pending === undefined || (input.occurrenceId !== undefined && previous.pending.occurrenceId !== input.occurrenceId)) {
      return { status: 'recovery', key, state: previous }
    }
    const completed = input.outcome === undefined || input.outcome === 'completed'
    const next = {
      version: 1,
      pending: undefined,
      cooldownUntil: completed ? now() + cooldownMs : 0,
      ...(completed ? { completedOccurrenceId: previous.pending.occurrenceId }
        : previous.completedOccurrenceId === undefined ? {} : { completedOccurrenceId: previous.completedOccurrenceId }),
    }
    await save(key, next)
    return { status: input.outcome === 'recovered' ? 'recovered' : completed ? 'completed' : 'failed', key, state: next }
  }

  async function recover(input) {
    return settle({ ...input, outcome: 'recovered' })
  }

  return { observe, settle, recover }
}
