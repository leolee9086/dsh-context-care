import { z } from 'zod'
import { matchConditionV2, normalizeRuleV2 } from '@leolee9086/dsh-rule-engine'
import { TextCountConfig, measureTextCount, negateTruth, type MatchTruth, type TextCountResult } from './text-count.js'
import { schemaError } from './schema-error.js'

const Json = z.json()
type JsonValue = z.infer<typeof Json>
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
function pathParts(path: string): string[] {
  return path.startsWith('/') ? path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~')) : path.split('.')
}
const Field = z.string().min(1).max(1024).refine(path => pathParts(path).every(part => part && !forbidden.has(part)), 'invalid field path')

/** Host measurement ceilings; rules may choose smaller limits, never larger ones. */
export const CountLimits = TextCountConfig.shape.limits.default({
  maxTextChars: 32768, maxCandidates: 10000, maxUnits: 10000, maxEvidence: 32,
})
export type CountLimitValues = z.infer<typeof CountLimits>
const TextSource = z.object({ kind: z.literal('text'), field: Field,
  projection: TextCountConfig.shape.projection, locale: TextCountConfig.shape.locale,
  metaPrefixes: TextCountConfig.shape.metaPrefixes }).strict()
const Count = z.object({ kind: z.literal('count'), source: TextSource,
  pattern: TextCountConfig.shape.pattern, metric: TextCountConfig.shape.metric,
  window: z.object({ kind: z.enum(['current-block', 'current-output']) }).strict(),
  evaluate: z.enum(['complete', 'prefix']).default('complete'),
  compare: TextCountConfig.shape.compare, limits: CountLimits,
}).strict().superRefine((value, context) => {
  const measurement = TextCountConfig.safeParse(measurementOptions(value))
  if (!measurement.success) for (const issue of measurement.error.issues) context.addIssue({ code: 'custom', message: issue.message, path: issue.path })
})

type CountCondition = z.infer<typeof Count>
function measurementOptions(value: { source: z.infer<typeof TextSource>; pattern: z.infer<typeof TextCountConfig.shape.pattern>;
  metric: z.infer<typeof TextCountConfig.shape.metric>; compare: z.infer<typeof TextCountConfig.shape.compare>; limits: CountLimitValues }) {
  return { projection: value.source.projection, locale: value.source.locale, metaPrefixes: value.source.metaPrefixes,
    pattern: value.pattern, metric: value.metric, compare: value.compare, limits: value.limits }
}

const Leaf = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }).strict(),
  z.object({ kind: z.literal('compare'), field: Field,
    op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists']), value: Json.optional() }).strict(),
  z.object({ kind: z.literal('regex'), field: Field, pattern: z.string(), flags: z.string().optional(), all: z.literal(false).optional() }).strict(),
  z.object({ kind: z.literal('keywords'), field: Field, values: z.array(z.string()),
    mode: z.enum(['ANY', 'ALL', 'NOT-ANY', 'NOT-ALL']).optional(),
    caseSensitive: z.boolean().optional(), wordBoundary: z.boolean().optional() }).strict(),
])
export type ReminderCondition = z.infer<typeof Leaf> | CountCondition
  | { kind: 'all' | 'any'; conditions: ReminderCondition[] }
  | { kind: 'not'; condition: ReminderCondition }
const Group = z.object({ kind: z.enum(['all', 'any']), conditions: z.array(z.unknown()).max(64) }).strict()
const Not = z.object({ kind: z.literal('not'), condition: z.unknown() }).strict()
const Tag = z.object({ kind: z.string() })

/** Registration checks both the bounded data shape and rule-engine semantics. */
export function compileReminderCondition(input: unknown, ceilings: CountLimitValues = CountLimits.parse(undefined)): ReminderCondition {
  return conditionFrom(input, ceilings, true)
}

/**
 * Structured clone does not retain a TypeScript proof. Recheck the bounded data
 * shape in the worker without recompiling the rule-engine declaration each time.
 */
export function parseReminderCondition(input: unknown, ceilings: CountLimitValues): ReminderCondition {
  return conditionFrom(input, ceilings, false)
}

function conditionFrom(input: unknown, ceilings: CountLimitValues, validateEngine: boolean): ReminderCondition {
  let nodes = 0
  function compile(value: unknown, depth: number): ReminderCondition {
    if (++nodes > 2048 || depth > 16) throw new TypeError('reminder-condition-tree-budget-exceeded')
    const { kind } = Tag.parse(value)
    if (kind === 'all' || kind === 'any') {
      const group = Group.parse(value)
      // An empty group is legitimate: a rule with no extra conditions matches everything.
      return { kind: group.kind, conditions: group.conditions.map(child => compile(child, depth + 1)) }
    }
    if (kind === 'not') return { kind, condition: compile(Not.parse(value).condition, depth + 1) }
    if (kind === 'count') {
      const count = Count.parse(value)
      count.limits = {
        maxTextChars: Math.min(count.limits.maxTextChars, ceilings.maxTextChars),
        maxCandidates: Math.min(count.limits.maxCandidates, ceilings.maxCandidates),
        maxUnits: Math.min(count.limits.maxUnits, ceilings.maxUnits),
        maxEvidence: Math.min(count.limits.maxEvidence, ceilings.maxEvidence),
      }
      return count
    }
    const leaf = Leaf.parse(value)
    if (!validateEngine) return leaf
    // Delegate literal/regex/keyword validation to the existing engine. Its own
    // rejection names the malformed pattern but not the field, so add that here.
    try {
      normalizeRuleV2({ schemaVersion: 2, sourceId: 'reminder-condition', id: 'condition', revision: 1,
        on: ['tool.result'], select: { view: 'original', roles: ['tool'], blockTypes: ['tool-result'] },
        match: { kind: 'all', conditions: [Json.parse(leaf)] }, priority: 0,
        actions: [{ id: 'validate', kind: 'notify', stage: 'tool.result', enabledDefault: true, template: '' }] })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`提醒条件 ${'field' in leaf ? leaf.field : '(always)'} 无效: ${detail}`, { cause: error })
    }
    return leaf
  }
  // This runs inside the matcher worker; a rejection must stay readable after
  // it is relayed back to the host thread.
  try { return compile(input, 0) }
  catch (error) { throw schemaError(error, '提醒条件无效') }
}
const EngineResult = z.object({ ok: z.boolean(), ranges: z.array(z.tuple([z.number(), z.number()])),
  captures: z.record(z.string(), Json), field: z.string().optional() }).strict()
const TextSample = z.object({ field: Field, sampleId: z.string().min(1),
  window: z.enum(['current-block', 'current-output']), phase: z.enum(['prefix', 'complete']),
  truncated: z.boolean() }).strict()
export const TextSamples = z.array(TextSample).max(1024)
export type TextSampleValue = z.infer<typeof TextSample>
interface Measurement { path: string; field: string; sampleId?: string; result: TextCountResult }
export interface ReminderMatch {
  ok: boolean
  status: MatchTruth
  ranges: [number, number][]
  captures: Record<string, JsonValue>
  measurements: Measurement[]
  diagnostics: { path: string; message: string }[]
  field?: string
}
function result(status: MatchTruth): ReminderMatch {
  return { ok: status === 'matched', status, ranges: [], captures: {}, measurements: [], diagnostics: [] }
}
function readField(root: JsonValue, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = root
  for (const part of pathParts(path)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part)) return undefined
      value = value[Number(part)]
    } else value = value[part]
  }
  return value
}

/** Run inside the cancellable matcher worker; missing evidence never becomes true under not. */
/**
 * 执行期把规则自带的测量上限再夹一次宿主 ceilings。
 *
 * 注册时 `compileRule` 已经夹过一次，这里是纵深防御：worker 里跑的代码
 * 不该信任调用方递过来的树。只走树、不做解析，而且没有任何节点需要改时
 * 直接返回原对象——所以它不会像重新编译那样每轮分配一整棵新树。
 */
export function clampCountLimits(condition: ReminderCondition, ceilings: CountLimitValues): ReminderCondition {
  switch (condition.kind) {
    case 'all':
    case 'any': {
      const next = condition.conditions.map(child => clampCountLimits(child, ceilings))
      return next.every((child, index) => child === condition.conditions[index]) ? condition : { ...condition, conditions: next }
    }
    case 'not': {
      const inner = clampCountLimits(condition.condition, ceilings)
      return inner === condition.condition ? condition : { ...condition, condition: inner }
    }
    case 'count': {
      const limits = {
        maxTextChars: Math.min(condition.limits.maxTextChars, ceilings.maxTextChars),
        maxCandidates: Math.min(condition.limits.maxCandidates, ceilings.maxCandidates),
        maxUnits: Math.min(condition.limits.maxUnits, ceilings.maxUnits),
        maxEvidence: Math.min(condition.limits.maxEvidence, ceilings.maxEvidence),
      }
      const same = limits.maxTextChars === condition.limits.maxTextChars
        && limits.maxCandidates === condition.limits.maxCandidates
        && limits.maxUnits === condition.limits.maxUnits
        && limits.maxEvidence === condition.limits.maxEvidence
      return same ? condition : { ...condition, limits }
    }
    default:
      return condition
  }
}

export function matchReminderCondition(condition: ReminderCondition, snapshot: JsonValue, samples: readonly TextSampleValue[] = []): ReminderMatch {
  function evaluate(node: ReminderCondition, path: string): ReminderMatch {
    if (node.kind === 'all' || node.kind === 'any') {
      const merged = result(node.kind === 'all' ? 'matched' : 'unmatched')
      let unavailable = false
      for (const [index, child] of node.conditions.entries()) {
        const found = evaluate(child, `${path}.${index}`)
        merged.measurements.push(...found.measurements); merged.diagnostics.push(...found.diagnostics)
        if ((node.kind === 'all' && found.status === 'unmatched') || (node.kind === 'any' && found.status === 'matched')) {
          return { ...found, measurements: merged.measurements, diagnostics: merged.diagnostics }
        }
        unavailable ||= found.status === 'unavailable'
        merged.ranges.push(...found.ranges); Object.assign(merged.captures, found.captures)
      }
      if (unavailable) { merged.status = 'unavailable'; merged.ok = false }
      return merged
    }
    if (node.kind === 'not') {
      const found = evaluate(node.condition, `${path}.not`)
      return { ...result(negateTruth(found.status)), measurements: found.measurements, diagnostics: found.diagnostics }
    }
    if (node.kind === 'count') {
      const sample = samples.find(value => value.field === node.source.field && value.window === node.window.kind)
      const text = readField(snapshot, node.source.field)
      const reason = !sample ? 'text-sample-unavailable' : sample.truncated ? 'text-sample-truncated'
        : node.evaluate === 'complete' && sample.phase !== 'complete' ? 'text-sample-incomplete'
          : typeof text !== 'string' ? 'text-field-unavailable' : undefined
      const measured: TextCountResult = reason !== undefined || typeof text !== 'string'
        ? { status: 'unavailable', reason: reason ?? 'text-field-unavailable' }
        : measureTextCount(text, measurementOptions(node))
      return { ...result(measured.status), measurements: [{ path, field: node.source.field,
        ...(sample ? { sampleId: sample.sampleId } : {}), result: measured }] }
    }
    try {
      const matched = EngineResult.parse(matchConditionV2(Json.parse(node), snapshot))
      return { ...result(matched.ok ? 'matched' : 'unmatched'), ...matched }
    } catch (error) {
      return { ...result('unavailable'), diagnostics: [{ path, message: error instanceof Error ? error.message : String(error) }] }
    }
  }
  return evaluate(condition, 'condition')
}
