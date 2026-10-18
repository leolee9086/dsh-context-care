import { z } from 'zod';
import { compileReminderCondition, CountLimits } from './conditions.js';
import { parseOrThrow } from './schema-error.js';
import { SESSION_EVENT_TYPES } from './generated/session-events.js';
import { sessionEventShape, selectorPaths, unresolvableSegment } from './selector.js';
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
const ClockTime = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const TimeWindow = z.object({ start: ClockTime, end: ClockTime, timeZone: z.literal('local').default('local') }).strict()
    .refine(value => value.start !== value.end, 'timeWindow must have different start and end');
const OutputPattern = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), text: z.string().min(1).max(4096) }).strict(),
    z.object({ kind: z.literal('keywords'), values: z.array(z.string().min(1).max(4096)).min(1).max(128),
        mode: z.enum(['any', 'all']).default('any') }).strict(),
    Regex.extend({ kind: z.literal('regex') }),
]);
const ToolArguments = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), Regex).default({});
/**
 * Sticky delivery keeps one reminder present across consecutive clock ticks.
 * `lifetime` counts ticks including the delivery tick; `cooldown` is the number
 * of further ticks the rule stays silent before a new event may activate it.
 */
const Sticky = z.object({ lifetime: z.number().int().min(1).max(1000),
    cooldown: z.number().int().min(0).max(1000),
    clock: z.enum(['main-request', 'human-turn']).default('main-request') }).strict();
const Delivery = z.object({ model: z.object({ once: z.enum(['none', 'surface', 'window']), shared: SharedQuota.optional(),
        interrupt: z.literal('abort-resume').optional(), sticky: Sticky.optional() }).strict() }).strict();
/**
 * What a matched rule does. Both effects deliver a reminder: a denial that only
 * failed the call would leave the model with an unexplained error instead of the
 * rule telling it what the call violated. `deny-tool` adds the refusal on top.
 */
const Effect = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('remind'), deliver: Delivery }).strict(),
    z.object({ kind: z.literal('deny-tool'), deliver: Delivery,
        reason: z.string().min(1).max(1024).optional() }).strict(),
]);
const Base = z.object({
    format: z.literal('reminder/v4'), id: Id, title: z.string().max(4096).optional(),
    priority: z.number().int().min(-100000).max(100000).default(0),
    exclusiveGroup: Id.optional(), scope: ReminderScope.optional(), text: z.string().min(1).max(16384),
    judge: z.object({ ref: Id, revision: z.number().int().positive(), params: z.json().optional(),
        timeoutMs: z.number().int().min(1).max(60000).optional() }).strict().optional(),
}).strict();
const ToolWhen = z.object({ tool: Id, arguments: ToolArguments,
    error: z.object({ code: Id }).strict().optional(), condition: z.json().optional() }).strict();
const RequestWhen = z.object({ timeWindow: TimeWindow.optional(),
    humanActivity: z.object({ withinSeconds: z.number().int().min(1).max(86400) }).strict().optional(),
    condition: z.json().optional() }).strict();
const OutputWhen = z.object({ blockTypes: z.array(z.enum(['text', 'reasoning'])).min(1).max(2),
    pattern: OutputPattern, timeWindow: TimeWindow.optional(), condition: z.json().optional() }).strict();
// A pre-execution call has no error yet; `.strict()` already rejects a declared one.
const BeforeWhen = z.object({ tool: Id, arguments: ToolArguments, condition: z.json().optional() }).strict();
/**
 * A committed log event or a declared custom event, selected by its name. The name
 * is a plain string because a custom event is declared after this module is built;
 * `compileRule` resolves it against the built-in catalog plus the declared set and
 * rejects an unknown name there. A rule reads the payload as `event.arguments.<field>`
 * (or `tool.arguments.<field>`, the same object): `facts` stays reserved for analyzer
 * output, which matching clears before analyzers run.
 */
const SessionWhen = z.object({ eventType: z.string().min(1), condition: z.json().optional() }).strict();
const RuleObject = z.discriminatedUnion('on', [
    Base.extend({ on: z.literal('tool.succeeded'), when: ToolWhen, effect: Effect }).strict(),
    Base.extend({ on: z.literal('tool.failed'), when: ToolWhen, effect: Effect }).strict(),
    Base.extend({ on: z.literal('request.before'), when: RequestWhen, effect: Effect }).strict(),
    Base.extend({ on: z.literal('assistant.output'), when: OutputWhen, effect: Effect }).strict(),
    Base.extend({ on: z.literal('tool.before-execute'), when: BeforeWhen, effect: Effect }).strict(),
    Base.extend({ on: z.literal('session.event'), when: SessionWhen, effect: Effect }).strict(),
]);
export const ReminderRule = RuleObject.superRefine((rule, context) => {
    const { effect } = rule;
    // Denial is only meaningful at the pre-execution point that can still stop the call.
    if (effect.kind === 'deny-tool' && rule.on !== 'tool.before-execute') {
        context.addIssue({ code: 'custom', path: ['effect', 'kind'], message: 'deny-tool requires on: tool.before-execute' });
    }
    // Delivery rules apply to every effect, so a denial cannot skip a check a reminder obeys.
    const window = rule.on === 'request.before' || rule.on === 'assistant.output' ? rule.when.timeWindow : undefined;
    const { once, shared, sticky } = effect.deliver.model;
    if ((once === 'window' || shared?.reset === 'window') && window === undefined) {
        context.addIssue({ code: 'custom', path: ['effect', 'deliver', 'model'],
            message: 'window delivery or shared window quota requires when.timeWindow' });
    }
    // Sticky owns its own repeat suppression, so surface de-duplication cannot also apply.
    if (sticky !== undefined && once === 'surface') {
        context.addIssue({ code: 'custom', path: ['effect', 'deliver', 'model', 'sticky'],
            message: 'sticky cannot combine with once: surface' });
    }
    // `none` is the sticky spelling for "no de-duplication key"; alone it has no defined behaviour.
    if (once === 'none' && sticky === undefined) {
        context.addIssue({ code: 'custom', path: ['effect', 'deliver', 'model', 'once'],
            message: 'once: none requires sticky' });
    }
    if (effect.deliver.model.interrupt !== undefined && rule.on !== 'assistant.output') {
        context.addIssue({ code: 'custom', path: ['effect', 'deliver', 'model', 'interrupt'],
            message: 'abort-resume requires on: assistant.output' });
    }
    if (rule.on === 'tool.failed' && rule.when.error === undefined) {
        context.addIssue({ code: 'custom', path: ['when', 'error'], message: 'tool.failed requires when.error.code' });
    }
    if (rule.on === 'tool.succeeded' && rule.when.error !== undefined) {
        context.addIssue({ code: 'custom', path: ['when', 'error'], message: 'tool.succeeded cannot declare when.error' });
    }
});
export const ReminderConfig = z.object({
    countLimits: CountLimits,
    ruleTimeoutMs: z.number().int().min(1).max(60000).default(250),
    roundTimeoutMs: z.number().int().min(1).max(60000).default(1000),
    maxConcurrent: z.number().int().min(1).max(64).default(4),
    maxQueued: z.number().int().min(1).max(10000).default(128),
    /** Reminder-caused activations one session may chain before loop prevention stops them. */
    maxReminderChain: z.number().int().min(1).max(64).default(8),
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
    maxToolExecutions: z.number().int().min(1).max(100000).default(4096),
}).strict().prefault({});
export const Source = z.object({ sourceId: Id, plugin: Id, sessionId: Id.optional(), scope: ReminderScope.optional(),
    revision: z.number().int().positive(), rules: z.array(ReminderRule),
    diagnostics: z.array(z.object({ id: z.string(), message: z.string().max(4096) }).strict()).default([]),
}).strict();
/** The built-in vocabulary as a lookup set, so a name check cannot be fooled by index math. */
const BUILT_IN_EVENTS = new Set(SESSION_EVENT_TYPES);
/** Compile one rule's readable form into the bounded condition tree the matcher evaluates. */
export function compileRule(input, limits, declared) {
    const rule = parseOrThrow('提醒规则无效', () => ReminderRule.parse(input));
    const conditions = [];
    if (rule.on === 'tool.succeeded' || rule.on === 'tool.failed' || rule.on === 'tool.before-execute') {
        conditions.push({ kind: 'compare', field: 'tool.name', op: 'eq', value: rule.when.tool });
        if (rule.on === 'tool.failed' && rule.when.error) {
            conditions.push({ kind: 'compare', field: 'tool.error.code', op: 'eq', value: rule.when.error.code });
        }
        for (const [key, test] of Object.entries(rule.when.arguments)) {
            const field = `tool.arguments.${key}`;
            // The engine's all group short-circuits: missing optional tool arguments are an ordinary non-match.
            conditions.push({ kind: 'compare', field, op: 'exists' }, { kind: 'regex', field, pattern: test.regex, flags: test.flags.replaceAll('g', '') });
        }
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
    // An event selector is checked here, at load time: erased types cannot catch a
    // misspelling, and an unmatched selector would otherwise only ever report
    // `unavailable`. Unknown names are rejected too, so a typo cannot quietly never fire.
    if (rule.on === 'session.event') {
        const name = rule.when.eventType;
        const custom = declared?.shapes.get(name);
        if (!BUILT_IN_EVENTS.has(name) && !(declared?.names.has(name) ?? false)) {
            throw new Error(`提醒规则引用了未声明的事件类型 ${name}：它既不是内置事件，也没有被自定义事件描述符声明`);
        }
        if (rule.when.condition !== undefined) {
            const shape = sessionEventShape(name, custom);
            for (const path of selectorPaths(rule.when.condition)) {
                const segment = unresolvableSegment(shape, path);
                if (segment !== undefined) {
                    throw new Error(`提醒条件字段 ${path} 不存在于事件 ${name} 的载荷中（缺少 ${segment}）`);
                }
            }
        }
    }
    return { ...rule, condition: compileReminderCondition({ kind: 'all', conditions }, limits) };
}
//# sourceMappingURL=schema.js.map