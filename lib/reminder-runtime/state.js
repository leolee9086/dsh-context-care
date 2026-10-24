import { z } from 'zod';
import { ReminderRule } from './schema.js';
import { TextSamples } from './conditions.js';
export const Detector = z.object({ ref: z.string().min(1), revision: z.number().int().positive(),
    module: z.string().url().refine(value => new URL(value).protocol === 'file:', 'detector module must be a local file URL'),
    exportName: z.string().min(1).default('judge') }).strict();
const Clock = z.object({ at: z.number(), timeZone: z.string().optional() });
/** Where an event came from; loop prevention turns on telling a delivery from a human turn. */
const Origin = z.enum(['human', 'tool', 'reminder', 'recovery', 'background']);
const HumanActivity = z.object({ at: z.number(), evidence: z.string() }).nullable();
const Output = z.object({ attemptId: z.string(), turn: z.number(), step: z.number(), index: z.number(),
    type: z.enum(['text', 'reasoning']), offset: z.number(),
    /** The attempt's readable text so far; absent in state written before this field existed. */
    full: z.string().default('') });
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
}).catchall(z.json());
export const MatchResult = z.object({ ok: z.boolean(), status: z.enum(['matched', 'unmatched', 'unavailable']).optional() }).catchall(z.json())
    .refine(value => value.status === undefined || value.ok === (value.status === 'matched'), 'inconsistent reminder result');
/**
 * 一条规则的回执。它只保证「有这么一条」，不保证内容合法：
 * 合法性由消费层按单条契约判定——否则一条坏结果会把整批判废，与逐条时的行为不同。
 */
export const BatchAnswer = z.union([
    z.object({ key: z.string(), ms: z.number().nonnegative(), match: z.json() }).strict(),
    z.object({ key: z.string(), ms: z.number().nonnegative(),
        error: z.object({ name: z.string(), message: z.string() }).catchall(z.json()) }).strict(),
]);
/**
 * worker 批量求值的收尾回执。`items` 故意收成 unknown[]：
 * 每一份回执单独过 BatchAnswer，一条坏掉只是那一条没答案。
 */
export const BatchResult = z.object({
    items: z.array(z.unknown()).max(2048),
    stopped: z.boolean(),
    elapsedMs: z.number().nonnegative(),
}).strict();
export const AnalysisFacts = z.record(z.string(), z.json());
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
});
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
    lastHumanId: z.string() }).strict();
export const SessionState = z.object({ seen: z.array(z.string()), candidates: z.array(Candidate),
    diagnostics: z.array(z.record(z.string(), z.json())),
    windows: z.array(z.object({ key: z.string(), until: z.number(), messageId: z.string().optional() })).default([]),
    stickies: z.array(StickyState).default([]),
}).strict();
// Keep the v1 storage envelope readable; validate concrete candidates when restoring the runtime.
export const REMINDER_DOMAIN = { name: 'context_care_reminders', version: 1, layout: 'per-record',
    tables: { sessions: { valueSchema: z.object({ seen: z.array(z.string()), candidates: z.array(z.json()), diagnostics: z.array(z.json()),
                windows: z.array(z.object({ key: z.string(), until: z.number(), messageId: z.string().optional() }).strict()).optional(),
                stickies: z.array(z.json()).optional() }).strict() } } };
/** Distinct trigger phases share real call ids; deduplication must keep those facts separate. */
export function triggerKey(type, callId) {
    return JSON.stringify([type ?? 'tool.succeeded', callId]);
}
/** JSON transport copying is intentional: optional undefined fields do not enter durable records. */
export function jsonCopy(value) { return JSON.parse(JSON.stringify(value)); }
export function errorMessage(error) {
    return String(error && typeof error === 'object' && 'message' in error ? error.message : error);
}
export function errorDetail(error) {
    if (!error || typeof error !== 'object' || !('diagnostic' in error) || !error.diagnostic)
        return {};
    return { diagnostic: z.json().parse(jsonCopy(error.diagnostic)) };
}
//# sourceMappingURL=state.js.map