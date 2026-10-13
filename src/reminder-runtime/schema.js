import { z } from 'zod'
import { normalizeRuleV2 } from '@leolee9086/dsh-rule-engine'
import { RuleLimit } from '../reminder-capacity.js'

const Id = z.string().min(1).max(256)
const Regex = z.object({ regex: z.string().min(1).max(4096), flags: z.string().regex(/^[gimsu]*$/).default('') }).strict()
export const ReminderRule = z.object({
  format: z.literal('reminder/v1'), id: Id, title: z.string().max(4096).optional(),
  on: z.literal('tool.succeeded'), priority: z.number().int().min(-100000).max(100000).default(0),
  exclusiveGroup: Id.optional(), text: z.string().min(1).max(16384),
  when: z.object({ tool: Id, arguments: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), Regex).default({}),
    condition: z.json().optional() }).strict(),
  judge: z.object({ ref: Id, revision: z.number().int().positive(), params: z.json().optional(),
    timeoutMs: z.number().int().min(1).max(60000).optional() }).strict().optional(),
  deliver: z.object({ model: z.object({ once: z.literal('surface') }).strict() }).strict(),
}).strict()
export const ReminderConfig = z.object({
  ruleTimeoutMs: z.number().int().min(1).max(60000).default(250),
  roundTimeoutMs: z.number().int().min(1).max(60000).default(1000),
  maxConcurrent: z.number().int().min(1).max(64).default(4),
  maxQueued: z.number().int().min(1).max(10000).default(128),
  maxRules: RuleLimit.default(0),
  maxBytes: z.number().int().min(1).max(33554432).default(1048576),
  maxCandidates: z.number().int().min(1).max(10000).default(128),
  maxIdle: z.number().int().min(0).max(64).default(4),
  maxContextMessages: z.number().int().min(0).max(1000).default(8),
  maxContextChars: z.number().int().min(0).max(1048576).default(32768),
}).strict().prefault({})
export const Source = z.object({ sourceId: Id, plugin: Id, sessionId: Id.optional(),
  revision: z.number().int().positive(), rules: z.array(ReminderRule),
  diagnostics: z.array(z.object({ id: z.string(), message: z.string().max(4096) }).strict()).default([]),
}).strict()

/** Compile the readable reminder form to the existing engine's conditions. */
export function compileRule(input, sourceId, revision) {
  const rule = ReminderRule.parse(input)
  const conditions = [{ kind: 'compare', field: 'tool.name', op: 'eq', value: rule.when.tool }]
  for (const [key, test] of Object.entries(rule.when.arguments)) {
    const field = `tool.arguments.${key}`
    // The engine's all group short-circuits: missing optional tool arguments are an ordinary non-match.
    conditions.push({ kind: 'compare', field, op: 'exists' },
      { kind: 'regex', field, pattern: test.regex, flags: test.flags.replaceAll('g', '') })
  }
  if (rule.when.condition) conditions.push(rule.when.condition)
  const compiled = normalizeRuleV2({ schemaVersion: 2, sourceId, id: rule.id, revision,
    on: ['tool.result'], select: { view: 'original', roles: ['tool'], blockTypes: ['tool-result'] },
    match: { kind: 'all', conditions }, priority: rule.priority,
    actions: [{ id: 'model', kind: 'notify', stage: 'tool.result', enabledDefault: true, template: rule.text }],
  })
  return { ...rule, condition: compiled.match }
}
