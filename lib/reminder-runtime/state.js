import { z } from 'zod';
import { ReminderRule } from './schema.js';
export const Detector = z.object({ ref: z.string().min(1), revision: z.number().int().positive(),
    module: z.string().url().refine(value => new URL(value).protocol === 'file:', 'detector module must be a local file URL'),
    exportName: z.string().min(1).default('judge') }).strict();
const Clock = z.object({ at: z.number(), timeZone: z.string().optional() });
const HumanActivity = z.object({ at: z.number(), evidence: z.string() }).nullable();
const Output = z.object({ attemptId: z.string(), turn: z.number(), step: z.number(), index: z.number(),
    type: z.enum(['text', 'reasoning']), offset: z.number() });
export const Event = z.object({
    type: z.enum(['tool.succeeded', 'tool.failed', 'request.before', 'assistant.output']).optional(),
    sessionId: z.string(), agentPreset: z.string().optional(), callId: z.string(), rootCallId: z.string(),
    name: z.string().optional(), arguments: z.json().optional(),
    error: z.object({ code: z.string().optional() }).optional(), clock: Clock.optional(),
    humanActivity: HumanActivity.optional(), output: Output.extend({ text: z.string() }).optional(),
    context: z.object({ messages: z.array(z.object({ role: z.string(), text: z.string(), truncated: z.boolean() })),
        truncated: z.boolean() }).optional(),
    facts: z.record(z.string(), z.json()).default({}),
}).catchall(z.json());
export const MatchResult = z.object({ ok: z.boolean() }).catchall(z.json());
export const AnalysisFacts = z.record(z.string(), z.json());
const Candidate = z.object({
    id: z.string(), sessionId: z.string(), agentPreset: z.string().optional(),
    sourceId: z.string(), sourceToken: z.string(), sourceSignature: z.string().optional(), ruleId: z.string(),
    key: z.string(), window: z.object({ id: z.string(), start: z.number(), end: z.number() }).optional(),
    request: z.object({ type: z.literal('request.before'), humanActivity: HumanActivity.optional() }).optional(),
    // Controls use an opaque string epoch; standalone runtimes also persist numeric epochs.
    revision: z.number(), policy: z.union([z.string(), z.number()]), text: z.string(), title: z.string(),
    eventId: z.string(), rootCallId: z.string(), output: Output.optional(),
    status: z.enum(['pending', 'reserved', 'delivered', 'discarded']), messageId: z.string().optional(),
    evidence: z.json(), rule: ReminderRule,
});
export const SessionState = z.object({ seen: z.array(z.string()), candidates: z.array(Candidate),
    diagnostics: z.array(z.record(z.string(), z.json())),
    windows: z.array(z.object({ key: z.string(), until: z.number(), messageId: z.string().optional() })).default([]),
}).strict();
// Keep the v1 storage envelope readable; validate concrete candidates when restoring the runtime.
export const REMINDER_DOMAIN = { name: 'context_care_reminders', version: 1, layout: 'per-record',
    tables: { sessions: { valueSchema: z.object({ seen: z.array(z.string()), candidates: z.array(z.json()), diagnostics: z.array(z.json()),
                windows: z.array(z.object({ key: z.string(), until: z.number(), messageId: z.string().optional() }).strict()).optional() }).strict() } } };
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