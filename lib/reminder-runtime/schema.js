import { z } from 'zod';
import { normalizeRuleV2 } from '@leolee9086/dsh-rule-engine';
import { RuleLimit } from './capacity.js';
import { normalizeScope } from './scope.js';
const Id = z.string().min(1).max(256);
const ScopeList = z.array(Id).min(1).max(128);
export const ReminderScope = z.object({ sessionIds: ScopeList.optional(), agentPresets: ScopeList.optional(), condition: z.json().optional() }).strict()
    .transform((value, context) => {
    try {
        return normalizeScope(value);
    }
    catch (error) {
        if (!(error instanceof TypeError))
            throw error;
        context.addIssue({ code: 'custom', message: error.message });
        return z.NEVER;
    }
});
const Regex = z.object({ regex: z.string().min(1).max(4096), flags: z.string().regex(/^[gimsu]*$/).default('') }).strict();
const LifetimeQuota = z.object({ reset: z.literal('lifetime'), lifetime: Id,
    limit: z.number().int().min(1).max(10000) }).strict();
const WindowQuota = z.object({ reset: z.literal('window'), limit: z.number().int().min(1).max(10000) }).strict();
const SharedQuota = z.discriminatedUnion('reset', [LifetimeQuota, WindowQuota]);
const ToolRuleCommon = z.object({
    format: z.literal('reminder/v1'), id: Id, title: z.string().max(4096).optional(),
    priority: z.number().int().min(-100000).max(100000).default(0),
    exclusiveGroup: Id.optional(), scope: ReminderScope.optional(), text: z.string().min(1).max(16384),
    judge: z.object({ ref: Id, revision: z.number().int().positive(), params: z.json().optional(),
        timeoutMs: z.number().int().min(1).max(60000).optional() }).strict().optional(),
    deliver: z.object({ model: z.object({ once: z.literal('surface'), shared: LifetimeQuota.optional() }).strict() }).strict(),
}).strict();
const ToolRule = ToolRuleCommon.extend({
    on: z.enum(['tool.succeeded', 'tool.failed']),
    when: z.object({ tool: Id, arguments: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), Regex).default({}),
        error: z.object({ code: Id }).strict().optional(), condition: z.json().optional() }).strict(),
}).strict().superRefine((rule, context) => {
    const requiresError = rule.on === 'tool.failed';
    if (requiresError !== (rule.when.error !== undefined))
        context.addIssue({ code: 'custom', path: ['when', 'error'],
            message: requiresError ? 'tool.failed requires when.error.code' : 'tool.succeeded cannot declare when.error' });
});
const ClockTime = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const TimeWindow = z.object({ start: ClockTime, end: ClockTime, timeZone: z.literal('local').default('local') }).strict()
    .refine(value => value.start !== value.end, 'timeWindow must have different start and end');
const RequestRule = ToolRuleCommon.extend({
    format: z.literal('reminder/v2'), on: z.literal('request.before'),
    when: z.object({ timeWindow: TimeWindow.optional(),
        humanActivity: z.object({ withinSeconds: z.number().int().min(1).max(86400) }).strict().optional(),
        condition: z.json().optional() }).strict(),
    deliver: z.object({ model: z.object({ once: z.enum(['surface', 'window']), shared: SharedQuota.optional() }).strict() }).strict(),
}).refine(rule => (rule.deliver.model.once !== 'window' && rule.deliver.model.shared?.reset !== 'window') || rule.when.timeWindow !== undefined, 'window delivery or shared window quota requires when.timeWindow');
const OutputPattern = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), text: z.string().min(1).max(4096) }).strict(),
    z.object({ kind: z.literal('keywords'), values: z.array(z.string().min(1).max(4096)).min(1).max(128),
        mode: z.enum(['any', 'all']).default('any') }).strict(),
    Regex.extend({ kind: z.literal('regex') }),
]);
const OutputRule = ToolRuleCommon.extend({
    format: z.literal('reminder/v3'), on: z.literal('assistant.output'),
    when: z.object({ blockTypes: z.array(z.enum(['text', 'reasoning'])).min(1).max(2),
        pattern: OutputPattern, timeWindow: TimeWindow.optional(), condition: z.json().optional() }).strict(),
    deliver: z.object({ model: z.object({ once: z.enum(['surface', 'window']), shared: SharedQuota.optional(),
            interrupt: z.literal('abort-resume').optional() }).strict() }).strict(),
}).refine(rule => (rule.deliver.model.once !== 'window' && rule.deliver.model.shared?.reset !== 'window') || rule.when.timeWindow !== undefined, 'window delivery or shared window quota requires when.timeWindow');
export const ReminderRule = z.discriminatedUnion('format', [ToolRule, RequestRule, OutputRule]);
export const ReminderConfig = z.object({
    ruleTimeoutMs: z.number().int().min(1).max(60000).default(250),
    roundTimeoutMs: z.number().int().min(1).max(60000).default(1000),
    maxConcurrent: z.number().int().min(1).max(64).default(4),
    maxQueued: z.number().int().min(1).max(10000).default(128),
    maxRules: RuleLimit.default(0),
    maxBytes: z.number().int().min(1).max(33554432).default(1048576),
    maxClaimBytes: z.number().int().min(1).max(33554432).default(8388608),
    maxStreamChars: z.number().int().min(1).max(1048576).default(32768),
    maxStreamBlocks: z.number().int().min(1).max(1024).default(64),
    maxStreamPending: z.number().int().min(1).max(10000).default(32),
    maxStreamPendingBytes: z.number().int().min(1).max(33554432).default(4194304),
    streamEveryChars: z.number().int().min(1).max(32768).default(256),
    streamFlushMs: z.number().int().min(1).max(1000).default(50),
    maxInterruptsPerTurn: z.number().int().min(0).max(16).default(1),
    maxCandidates: z.number().int().min(1).max(10000).default(128),
    maxIdle: z.number().int().min(0).max(64).default(4),
    maxContextMessages: z.number().int().min(0).max(1000).default(8),
    maxContextChars: z.number().int().min(0).max(1048576).default(32768),
}).strict().prefault({});
export const Source = z.object({ sourceId: Id, plugin: Id, sessionId: Id.optional(), scope: ReminderScope.optional(),
    revision: z.number().int().positive(), rules: z.array(ReminderRule),
    diagnostics: z.array(z.object({ id: z.string(), message: z.string().max(4096) }).strict()).default([]),
}).strict();
/** Compile the readable reminder form to the existing engine's conditions. */
export function compileRule(input, sourceId, revision) {
    const rule = ReminderRule.parse(input);
    const conditions = rule.on === 'tool.succeeded' || rule.on === 'tool.failed'
        ? [{ kind: 'compare', field: 'tool.name', op: 'eq', value: rule.when.tool }]
        : [{ kind: 'always' }];
    if (rule.on === 'tool.failed' && rule.when.error) {
        conditions.push({ kind: 'compare', field: 'tool.error.code', op: 'eq', value: rule.when.error.code });
    }
    for (const [key, test] of Object.entries(rule.on === 'tool.succeeded' || rule.on === 'tool.failed' ? rule.when.arguments : {})) {
        const field = `tool.arguments.${key}`;
        // The engine's all group short-circuits: missing optional tool arguments are an ordinary non-match.
        conditions.push({ kind: 'compare', field, op: 'exists' }, { kind: 'regex', field, pattern: test.regex, flags: test.flags.replaceAll('g', '') });
    }
    if (rule.on === 'assistant.output') {
        const pattern = rule.when.pattern;
        const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const literal = (text) => ({ kind: 'regex', field: 'tool.output.text', pattern: escaped(text), flags: 'u' });
        conditions.push(pattern.kind === 'literal' ? literal(pattern.text)
            : pattern.kind === 'keywords' ? { kind: pattern.mode, conditions: pattern.values.map(literal) }
                : { kind: 'regex', field: 'tool.output.text', pattern: pattern.regex, flags: pattern.flags.replaceAll('g', '') });
    }
    if (rule.when.condition)
        conditions.push(rule.when.condition);
    const compiled = normalizeRuleV2({ schemaVersion: 2, sourceId, id: rule.id, revision,
        on: ['tool.result'], select: { view: 'original', roles: ['tool'], blockTypes: ['tool-result'] },
        match: { kind: 'all', conditions }, priority: rule.priority,
        actions: [{ id: 'model', kind: 'notify', stage: 'tool.result', enabledDefault: true, template: rule.text }],
    });
    return { ...rule, condition: compiled.match };
}
//# sourceMappingURL=schema.js.map