import { z } from 'zod'
import type { DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import { ReminderRule, Source, compileRule } from './schema.js'
import { CapacitySettings, CapacityWire } from './capacity.js'
import type { ClaimBookValue } from './claims.js'
import type { HistoryView, MessageView } from './request-context.js'
import type { RecipientFacts, RecipientIdentity } from './scope.js'
import { TextSamples, type CountLimitValues } from './conditions.js'
import type { DenialVerdict, PreExecution, UnfinishedCode } from './denial.js'

export const Detector = z.object({ ref: z.string().min(1), revision: z.number().int().positive(),
  module: z.string().url().refine(value => new URL(value).protocol === 'file:', 'detector module must be a local file URL'),
  exportName: z.string().min(1).default('judge') }).strict()
const Clock = z.object({ at: z.number(), timeZone: z.string().optional() })
/** Where an event came from; loop prevention turns on telling a delivery from a human turn. */
const Origin = z.enum(['human', 'tool', 'reminder', 'recovery', 'background'])
const HumanActivity = z.object({ at: z.number(), evidence: z.string() }).nullable()
const Output = z.object({ attemptId: z.string(), turn: z.number(), step: z.number(), index: z.number(),
  type: z.enum(['text', 'reasoning']), offset: z.number(),
  /** The attempt's readable text so far; absent in state written before this field existed. */
  full: z.string().default('') })
export const Event = z.object({
  type: z.enum(['tool.succeeded', 'tool.failed', 'request.before', 'assistant.output', 'tool.before-execute', 'session.event']).optional(),
  sessionId: z.string(), agentPreset: z.string().optional(), callId: z.string(), rootCallId: z.string(),
  name: z.string().optional(), arguments: z.json().optional(),
  error: z.object({ code: z.string().optional() }).optional(), clock: Clock.optional(),
  /** Exact native fact; copied trigger fields are reconstructed from this position. */
  native: z.object({ type: z.enum(['tool-result', 'session-event', 'tool-call', 'assistant-output']), seq: z.number().int().nonnegative() }).strict().optional(),
  humanActivity: HumanActivity.optional(), output: Output.extend({ text: z.string() }).optional(),
  context: z.object({ messages: z.array(z.object({ role: z.string(), text: z.string(), truncated: z.boolean() })),
    truncated: z.boolean() }).optional(),
  textSamples: TextSamples.optional(),
  /** Source class of this event, and the delivery that caused it when that is a reminder. */
  origin: Origin.default('human'), causationId: z.string().optional(),
  facts: z.record(z.string(), z.json()).default({}),
}).catchall(z.json())
export const MatchResult = z.object({ ok: z.boolean(), status: z.enum(['matched', 'unmatched', 'unavailable']).optional() }).catchall(z.json())
  .refine(value => value.status === undefined || value.ok === (value.status === 'matched'), 'inconsistent reminder result')
/**
 * 一条规则的回执。它只保证「有这么一条」，不保证内容合法：
 * 合法性由消费层按单条契约判定——否则一条坏结果会把整批判废，与逐条时的行为不同。
 */
export const BatchAnswer = z.union([
  z.object({ key: z.string(), ms: z.number().nonnegative(), match: z.json() }).strict(),
  z.object({ key: z.string(), ms: z.number().nonnegative(),
    error: z.object({ name: z.string(), message: z.string() }).catchall(z.json()) }).strict(),
])
export type BatchAnswerValue = z.infer<typeof BatchAnswer>
/**
 * worker 批量求值的收尾回执。`items` 故意收成 unknown[]：
 * 每一份回执单独过 BatchAnswer，一条坏掉只是那一条没答案。
 */
export const BatchResult = z.object({
  items: z.array(z.unknown()).max(2048),
  stopped: z.boolean(),
  elapsedMs: z.number().nonnegative(),
}).strict()
export type BatchResultValue = z.infer<typeof BatchResult>
export const AnalysisFacts = z.record(z.string(), z.json())
const Candidate = z.object({
  id: z.string(), sessionId: z.string(), agentPreset: z.string().optional(),
  sourceId: z.string(), sourceToken: z.string(), sourceSignature: z.string().optional(), ruleId: z.string(),
  key: z.string(), window: z.object({ id: z.string(), start: z.number(), end: z.number() }).optional(),
  request: z.object({ type: z.literal('request.before'), humanActivity: HumanActivity.optional() }).optional(),
  // Controls use an opaque string epoch; standalone runtimes also persist numeric epochs.
  revision: z.number(), policy: z.union([z.string(), z.number()]), text: z.string(), title: z.string(),
  eventId: z.string(), rootCallId: z.string(), native: Event.shape.native, output: Output.optional(),
  status: z.enum(['pending', 'reserved', 'delivered', 'discarded']), messageId: z.string().optional(),
  /** The native inbox owns this match, but delivery has not reserved a shared slot. */
  queued: z.literal(true).optional(),
  /** Set once `text` holds rendered output; the template source is never rendered twice. */
  rendered: z.boolean().optional(),
  // Present when this delivery belongs to a sticky activation; `charged` marks the
  // activation that already consumed its shared quota, so later ticks do not charge again.
  sticky: z.object({ activationId: z.string(), charged: z.boolean() }).strict().optional(),
  evidence: z.json(), rule: ReminderRule,
})
/**
 * One sticky activation: a reminder that stays present across consecutive clock
 * ticks. `remaining` counts the active ticks left after the delivering tick, and
 * `cooldown` counts the silent ticks that follow before a new event may activate it.
 */
const StickyState = z.object({ key: z.string(), activationId: z.string(),
  sourceId: z.string(), ruleId: z.string(), sessionId: z.string(),
  text: z.string(), title: z.string(), clock: z.enum(['main-request', 'human-turn']),
  remaining: z.number().int().min(0), cooldown: z.number().int().min(0), charged: z.boolean(),
  // The last human message this activation advanced on, for the human-turn clock.
  lastHumanId: z.string() }).strict()
export const SessionState = z.object({ seen: z.array(z.string()), candidates: z.array(Candidate),
  diagnostics: z.array(z.record(z.string(), z.json())),
  windows: z.array(z.object({ key: z.string(), until: z.number(), messageId: z.string().optional() })).default([]),
  stickies: z.array(StickyState).default([]),
}).strict()
// Keep the v1 storage envelope readable; validate concrete candidates when restoring the runtime.
export const REMINDER_DOMAIN = { name: 'context_care_reminders', version: 1, layout: 'per-record',
  tables: { sessions: { valueSchema: z.object({ seen: z.array(z.string()), candidates: z.array(z.json()), diagnostics: z.array(z.json()),
    windows: z.array(z.object({ key: z.string(), until: z.number(), messageId: z.string().optional() }).strict()).optional(),
    stickies: z.array(z.json()).optional() }).strict() } } } satisfies DomainSpec

export type CandidateValue = z.infer<typeof Candidate>
export type StickyStateValue = z.infer<typeof StickyState>
export type StateValue = z.infer<typeof SessionState>
export type EventValue = z.infer<typeof Event>
export type SourceValue = z.infer<typeof Source>
export type RuleValue = z.infer<typeof ReminderRule>
export type DetectorValue = z.infer<typeof Detector>
export type CompiledRule = ReturnType<typeof compileRule>
export type Rejection = z.infer<typeof CapacityWire>['rejections'][number]
export interface RegisteredSource {
  owner: object
  acceptSession: (sessionId: string) => boolean
  token: string
  value: SourceValue
  compiled: CompiledRule[]
}
export interface WorkItem {
  source: SourceValue
  token: string
  rule: CompiledRule
  policy: CandidateValue['policy']
  judge?: DetectorValue
  window?: CandidateValue['window']
  /** Re-evaluate a choice as an exclusivity barrier without delivering this handed rule again. */
  handed?: boolean
  /** An alias withdrawn or rebound during Worker evaluation cannot publish its old match. */
  nativeEvent?: string
}
export interface Run {
  event: EventValue
  items: WorkItem[]
  analyzers: DetectorValue[]
  /** Authoritative current recipient read once for this ordered historical scan. */
  recipient?: RecipientIdentity
  controller: AbortController
  /** Remaining time measured inside workers; queue and storage time never debit it. */
  remainingMs: number
  resolve: () => void
  done: Promise<void>
  task?: Promise<unknown>
  /** A completed match must not report successful acceptance when its native inbox publication failed. */
  handoffFailure?: Error
  /** The call this round decides, for pre-execution rounds only. */
  preExecution?: PreExecution
  /** Denial chosen by this round; absent means the call stays allowed. */
  denial?: DenialVerdict
  /** Whether every rule was actually evaluated; an interrupted round must not authorize. */
  evaluated?: boolean
  /**
   * 这一轮是从哪一步失去确定答案的（规则超时、失败、整轮超时、取消……）。
   * 完成度是逐规则记账的离散事实：只要有一条没有结论，整轮就不算完成，
   * 不能因为“整体耗时在预算内”就当作评估过了。有值即代表这一轮不完整。
   */
  incomplete?: UnfinishedCode
}
/** A compiled rule plus its independent execution allowance and ordered group policy. */
export interface BatchRuleInput {
  key: string
  condition: CompiledRule['condition']
  judge?: DetectorValue
  params?: z.infer<ReturnType<typeof z.json>>
  timeoutMs?: number
  exclusiveGroup?: string
  error?: { name: string; message: string }
}
/** Compiled conditions retain count limits at the worker validation boundary. */
export type Work = { analysis: { analyzer: DetectorValue; event: EventValue; maxBytes: number } }
  | { reminder: { condition: CompiledRule['condition']; event: EventValue; maxBytes: number; countLimits: CountLimitValues; judge?: DetectorValue; params?: z.infer<ReturnType<typeof z.json>> } }
  /**
   * 一次往返算完多条规则。逐条往返的固定开销按规则数线性增长，
   * 而单条规则真正的匹配只有几十微秒，所以往返次数本身才是瓶颈。
   */
  | { reminderBatch: { event: EventValue; maxBytes: number; countLimits: CountLimitValues; budgetMs?: number; blockedGroups?: string[]; rules: BatchRuleInput[] } }
export interface NativeRecoverySelection {
  tools: boolean
  beforeTools: boolean
  outputs: boolean
  sessionEvents: readonly string[]
  /** Alias policy changes must invalidate a scan even when the native names stay the same. */
  sessionAliases?: readonly { name: string; nativeEvent: string }[]
}
export interface HandoffRule {
  sourceId: string
  ruleId: string
  exclusiveGroup?: string
  output?: Pick<NonNullable<EventValue['output']>, 'attemptId' | 'turn' | 'step'>
}
export interface OutputHandoffRule extends HandoffRule {
  output: NonNullable<HandoffRule['output']>
}
export type HandoffLookup = (triggerId: string, rule?: HandoffRule) => boolean
export interface RuntimeOptions {
  config?: unknown
  entries?: Iterable<readonly [string, unknown]>
  /** Keep candidate/evaluation state process-local; Session inbox and event logs own recovery. */
  sessionAuthoritative?: boolean
  /** Strict, single-pass prompt templates reused from context-care's engine. */
  templates?: TemplateRenderer
  save?: (id: string, state: StateValue) => Promise<unknown> | void
  /**
   * 执行端口。`onItem` 只对批量工作有意义：worker 每算完一条就上报一条，
   * 这样即使这一批因为超时被终止，已经算完的规则也不会跟着蒸发。
   */
  execute?: (input: Work, signal: AbortSignal, timing: { onDispatch: () => void; workTimeoutMs: number
    onItem?: (answer: unknown) => void; onTiming?: (timing: { processingMs: number }) => void }) => Promise<unknown>
  capacity?: unknown
  saveCapacity?: (value: z.infer<typeof CapacitySettings>) => Promise<unknown> | void
  /** Notify observers only after the owning catalog or settings actually change. */
  changed?: (sessionId?: string) => void
  dispatches?: boolean
  resolvePreset?: (sessionId: string) => string | undefined
  /** Authoritative current session facts; supplied event metadata is ignored when present. */
  resolveIdentity?: (sessionId: string, signal?: AbortSignal) => RecipientFacts | Promise<RecipientFacts>
  /** Reconstruct an anchored trigger from native facts before admission or evaluation. */
  resolveEvent?: (event: EventValue, signal?: AbortSignal) => Promise<EventValue>
  /** Native triggers preceding an explicit policy reset cannot activate that rule again. */
  sinceSeq?: (sessionId: string, sourceId: string, ruleId: string) => number
  updateClaims?: (change: (book: ClaimBookValue) => ClaimBookValue) => Promise<ClaimBookValue>
  /** Committed windows and sticky clocks reconstructed from the owning Session. */
  readDeliveries?: (sessionId: string, humanId: string, fromSeq?: number) => Promise<import('./session-deliveries.js').DeliveryState>
  /** Whether native inbox/message evidence accepted this rule's trigger or exclusive choice. */
  wasHanded?: (sessionId: string, triggerId: string, rule?: HandoffRule, fromSeq?: number) => Promise<boolean>
  /** Accepted but uncommitted native inbox messages; never evaluates historical triggers. */
  readQueued?: (sessionId: string) => readonly MessageView[]
  /** Store an otherwise unlogged match as ordinary pending context without waking the Agent. */
  handoffPending?: (sessionId: string, candidateIds: readonly string[]) => Promise<void>
  wallNow?: () => number
  now?: () => number
  eligible?: (sessionId: string, sourceId: string, ruleId: string) => boolean
  epoch?: (sessionId: string, sourceId: string, ruleId: string) => CandidateValue['policy']
  report?: (error: unknown) => void
}
/** The subset of the shared template engine the runtime needs. */
export interface TemplateRenderer {
  /** Reject an unusable template before any rule is registered. */
  validate(source: string): void
  /**
   * Render once against a frozen snapshot. The argument is `unknown` because the
   * engine owns snapshot validation: it walks the value and rejects anything that
   * is not plain JSON, so the caller does not pre-narrow it here.
   */
  render(source: string, snapshot: unknown): string
}
/** One tool call at the pre-execution point, already materialized by the registry. */
export interface ToolPreparation {
  /** Registry execution token; the later synchronous guard correlates on this exact object. */
  key: object
  sessionId: string
  agentPreset?: string
  name: string
  arguments: unknown
  callId: string
  rootCallId: string
  native?: { type: 'tool-call'; seq: number }
  signal?: AbortSignal
}
export interface RequestInput {  sessionId: string
  agentPreset?: string
  events: HistoryView
  visible?: MessageView[]
  accepted?: MessageView[]
  signal?: AbortSignal
}
export interface CollectInput {
  sessionId: string
  agentPreset?: string
  visible: MessageView[]
  accepted?: MessageView[]
  committedIds?: string[]
  candidateIds?: string[]
  signal?: AbortSignal
}

/** Distinct trigger phases share real call ids; deduplication must keep those facts separate. */
export function triggerKey(type: string | undefined, callId: string): string {
  return JSON.stringify([type ?? 'tool.succeeded', callId])
}

/** JSON transport copying is intentional: optional undefined fields do not enter durable records. */
export function jsonCopy(value: unknown): unknown { return JSON.parse(JSON.stringify(value)) }
export function errorMessage(error: unknown) {
  return String(error && typeof error === 'object' && 'message' in error ? error.message : error)
}
export function errorDetail(error: unknown) {
  if (!error || typeof error !== 'object' || !('diagnostic' in error) || !error.diagnostic) return {}
  return { diagnostic: z.json().parse(jsonCopy(error.diagnostic)) }
}
