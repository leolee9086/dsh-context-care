import type { z } from 'zod'
import type { ReminderRule } from './schema.js'

type Rule = z.infer<typeof ReminderRule>
export interface MessageView {
  id?: string
  role: string
  content?: readonly { type: string; text?: string }[]
  source?: { kind?: string; reminder?: { key: string } }
}
export interface HistoryEvent { type: string; seq: number; time: number; data: unknown }
export interface EligibilityEvent {
  type?: Rule['on']
  name?: string
  error?: { code?: string }
  output?: { type: 'text' | 'reasoning' }
  clock?: { at: number }
  humanActivity?: { at: number; evidence: string } | null
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Local calendar windows use civil dates, including across midnight and DST changes. */
export function localWindow(spec: { start: string; end: string } | undefined, timestamp: number | undefined) {
  if (!spec || timestamp === undefined || !Number.isFinite(timestamp)) return undefined
  const date = new Date(timestamp)
  const minute = date.getHours() * 60 + date.getMinutes()
  const minutes = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3))
  const start = minutes(spec.start), end = minutes(spec.end)
  const overnight = start > end
  if (overnight ? minute < start && minute >= end : minute < start || minute >= end) return undefined
  const beginning = new Date(timestamp)
  if (overnight && minute < end) beginning.setDate(beginning.getDate() - 1)
  beginning.setHours(Math.floor(start / 60), start % 60, 0, 0)
  const ending = new Date(beginning)
  if (overnight) ending.setDate(ending.getDate() + 1)
  ending.setHours(Math.floor(end / 60), end % 60, 0, 0)
  const day = [beginning.getFullYear(), String(beginning.getMonth() + 1).padStart(2, '0'), String(beginning.getDate()).padStart(2, '0')].join('-')
  return { id: day, start: beginning.getTime(), end: ending.getTime() }
}

/** Read the earliest durable arrival for each human message, not its later surface commit.
 * Inherited fork events and producer-owned synthetic inputs do not establish local presence. */
export function humanActivity(events: HistoryEvent[]) {
  const seed = [...events].reverse().find(event => event.type === 'session/end-seed'
    && record(event.data) && event.data.inherited === true)
  const firstLiveSeq = (seed?.seq ?? -1) + 1
  const arrivals = new Map<string, number | null>()
  for (const event of events) {
    const data = event.data
    const messages: unknown[] = event.type === 'agent/inbox/spliced' && record(data) && Array.isArray(data.inserted)
      ? data.inserted : event.type === 'user/message' ? [data] : []
    for (const message of messages) {
      if (!record(message) || !record(message.source) || message.source.kind !== 'user'
        || typeof message.id !== 'string' || !message.id || arrivals.has(message.id)) continue
      arrivals.set(message.id, event.seq >= firstLiveSeq && Number.isFinite(event.time) ? event.time : null)
    }
  }
  const times = [...arrivals.values()].filter(value => value !== null)
  return times.length ? { at: times.reduce((latest, at) => Math.max(latest, at)), evidence: 'human-message' } : null
}

export function requestContext(visible: MessageView[], config: { maxContextChars: number; maxContextMessages: number }) {
  let chars = config.maxContextChars
  const messages: { role: string; text: string; truncated: boolean }[] = []
  for (const message of (config.maxContextMessages ? visible.slice(-config.maxContextMessages) : []).reverse()) {
    const text = (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
    messages.unshift({ role: message.role, text: chars ? text.slice(-chars) : '', truncated: text.length > chars })
    chars = Math.max(0, chars - text.length)
  }
  return { messages, truncated: messages.length < visible.length || messages.some(message => message.truncated) }
}

/** Built-in facts are evaluated before optional worker analysis and cannot be overwritten by it. */
export function requestEligible(rule: Rule, event: EligibilityEvent) {
  if (rule.on !== (event.type ?? 'tool.succeeded')) return false
  if (rule.on === 'tool.succeeded' || rule.on === 'tool.before-execute') return rule.when.tool === event.name
  if (rule.on === 'session.event') return rule.when.eventType === event.name
  if (rule.on === 'tool.failed') return rule.when.tool === event.name && rule.when.error?.code === event.error?.code
  if (rule.on === 'assistant.output' && (!event.output || !rule.when.blockTypes.includes(event.output.type))) return false
  if ('timeWindow' in rule.when && rule.when.timeWindow && !localWindow(rule.when.timeWindow, event.clock?.at)) return false
  if (rule.on === 'request.before' && rule.when.humanActivity) {
    const at = event.humanActivity?.at, now = event.clock?.at
    if (at === undefined || now === undefined || !Number.isFinite(at) || !Number.isFinite(now)
      || at > now || now - at > rule.when.humanActivity.withinSeconds * 1000) return false
  }
  return true
}
