import { z } from 'zod'
import { REMINDER_DOMAIN, SessionState } from './state.js'
import type { StateValue } from './state.js'

// This projection reads only enough of an obsolete candidate to retire it and
// record its delivery identity. It never compiles or upgrades an old rule.
const RetiredCandidate = z.object({
  id: z.string(), sourceId: z.string(), ruleId: z.string(),
  status: z.enum(['pending', 'reserved', 'delivered', 'discarded']),
  messageId: z.string().optional(),
  rule: z.object({ format: z.enum(['reminder/v1', 'reminder/v2', 'reminder/v3']) }),
})

/**
 * Retire pre-v4 candidates before validating the executable state. Keep event
 * deduplication, window receipts and diagnostics; shared claims live in their
 * own domain and are never released by this upgrade, including uncertain sends.
 */
export function restoreReminderState(input: unknown, at: number) {
  const wire = REMINDER_DOMAIN.tables.sessions.valueSchema.parse(input)
  const retired = []
  const candidates = []
  for (const candidate of wire.candidates) {
    const old = RetiredCandidate.safeParse(candidate)
    if (old.success) retired.push(old.data)
    else candidates.push(candidate)
  }
  // Corrupt v4 records and unknown formats still fail explicitly. Only the
  // three released obsolete formats above qualify for retirement.
  const state = SessionState.parse({ ...wire, candidates })
  if (retired.length) state.diagnostics.push({
    at, status: 'retired-pre-v4',
    message: '升级到 reminder/v4，旧候选已停止投递；去重记录、窗口回执和共享配额保留。',
    candidates: retired.map(({ rule, ...receipt }) => ({ ...receipt, format: rule.format })),
  })
  return { state, changed: retired.length > 0 }
}

/**
 * Validate every record and retire obsolete formats in the returned working
 * projection. Native Hosts omit save: retirement must not depend on clearing an
 * obsolete cache file. Standalone callers can still supply their own writer.
 */
export async function restoreReminderEntries(
  entries: Iterable<readonly [string, unknown]>,
  save?: (id: string, state: StateValue) => Promise<unknown> | void,
  at = Date.now(),
) {
  const restored = [...entries].map(([id, input]) => {
    try { return { id, ...restoreReminderState(input, at) } }
    catch (cause) { throw new Error(`reminder-state-restore-failed: ${id}`, { cause }) }
  })
  for (const { id, state, changed } of restored) {
    if (changed && save) await save(id, state)
  }
  return restored.map(({ id, state }) => [id, state] as const)
}
