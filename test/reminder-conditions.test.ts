import test from 'node:test'
import assert from 'node:assert/strict'
import { compileReminderCondition, matchReminderCondition, type ReminderCondition } from '../lib/reminder-runtime/conditions.js'
import type { TextCountResult } from '../lib/reminder-runtime/text-count.js'
import { executeReminderMatch } from '../lib/reminder-runtime/matcher.js'

const text = '目标目标。普通。'
const snapshot = { event: { output: { text } }, tool: { output: { text } }, facts: {}, context: {} }
const sample = (phase: 'prefix' | 'complete' = 'complete', truncated = false) => ({
  field: 'event.output.text', sampleId: 'output:attempt-1:0',
  window: 'current-block' as const, phase, truncated,
})
const limits = { maxTextChars: 10000, maxCandidates: 1000, maxUnits: 1000, maxEvidence: 8 }
const counting = (compare: { op: 'gt' | 'gte' | 'eq'; value: number },
  extra: { evaluate?: 'complete' | 'prefix' } = {}): unknown => ({
  kind: 'count', source: { kind: 'text', field: 'event.output.text', projection: 'raw', locale: 'zh-CN' },
  pattern: { kind: 'literal', text: '目标' }, metric: 'occurrences', window: { kind: 'current-block' },
  compare, limits, ...extra,
})

/** Deliver one condition with explicit evidence so three-valued outcomes stay observable. */
function judge(input: unknown, samples = [sample()]) {
  const condition: ReminderCondition = compileReminderCondition(input)
  return matchReminderCondition(condition, snapshot, samples)
}

test('计数条件从窗口样本测量并与比较符组合', () => {
  const matched = judge(counting({ op: 'gte', value: 2 }))
  assert.equal(matched.status, 'matched'); assert.equal(matched.ok, true)
  assert.equal(matched.measurements.length, 1)
  assert.equal(matched.measurements[0]!.result.status, 'matched')
  assert.equal(judge(counting({ op: 'gt', value: 2 })).status, 'unmatched')
  assert.equal(judge(counting({ op: 'eq', value: 2 })).status, 'matched')
})

/** Read the reason of a measurement known to be unavailable. */
function unavailableReason(result: TextCountResult): string {
  return result.status === 'unavailable' ? result.reason : `expected unavailable, got ${result.status}`
}

test('缺少证据或只看到前缀时计数不可用，不当作零', () => {
  const missing = judge(counting({ op: 'eq', value: 0 }), [])
  assert.equal(missing.status, 'unavailable')
  assert.equal(missing.ok, false)
  assert.equal(unavailableReason(missing.measurements[0]!.result), 'text-sample-unavailable')
  assert.equal(unavailableReason(judge(counting({ op: 'eq', value: 0 }), [sample('complete', true)])
    .measurements[0]!.result), 'text-sample-truncated')
  // A prefix sample cannot decide a rule that asks for the complete text.
  assert.equal(unavailableReason(judge(counting({ op: 'eq', value: 0 }, { evaluate: 'complete' }), [sample('prefix')])
    .measurements[0]!.result), 'text-sample-incomplete')
  assert.equal(judge(counting({ op: 'eq', value: 2 }, { evaluate: 'prefix' }), [sample('prefix')]).status, 'matched')
})

test('取反和组合保留不可用而不是把它们变成命中', () => {
  // No sample names this field, so the leaf is unavailable regardless of the other branch.
  const unavailable = { kind: 'count', source: { kind: 'text', field: 'event.absent.text', projection: 'raw', locale: 'zh-CN' },
    pattern: { kind: 'literal', text: '目标' }, metric: 'occurrences', window: { kind: 'current-block' },
    compare: { op: 'eq', value: 99 }, limits }
  assert.equal(judge({ kind: 'not', condition: unavailable }, []).status, 'unavailable')
  assert.equal(judge({ kind: 'all', conditions: [counting({ op: 'gte', value: 1 }), unavailable] }, []).status, 'unavailable')
  // A decisive branch decides the group even while its sibling stays unknown.
  assert.equal(judge({ kind: 'all', conditions: [counting({ op: 'gt', value: 99 }), unavailable] }).status, 'unmatched')
  assert.equal(judge({ kind: 'any', conditions: [counting({ op: 'gte', value: 1 }), unavailable] }).status, 'matched')
  assert.equal(judge({ kind: 'any', conditions: [counting({ op: 'gt', value: 99 }), unavailable] }).status, 'unavailable')
  assert.equal(judge({ kind: 'any', conditions: [counting({ op: 'gt', value: 99 })] }, []).status, 'unavailable')
})

test('非计数字段由现有引擎求值并保留捕获与位置', () => {
  const regex = judge({ kind: 'regex', field: 'event.output.text', pattern: '目标(目标)' })
  assert.equal(regex.status, 'matched')
  assert.equal(regex.field, 'event.output.text')
  assert.deepEqual(regex.captures['1'], '目标')
  assert.deepEqual(regex.ranges, [[0, 4]])
  assert.equal(judge({ kind: 'always' }).status, 'matched')
  assert.equal(judge({ kind: 'compare', field: 'event.output.text', op: 'contains', value: '没有' }).status, 'unmatched')
})

test('字段路径拒绝原型链，坏条件在编译期报错', () => {
  // A path that can reach the prototype chain is refused when the rule loads, not at delivery time.
  assert.throws(() => compileReminderCondition({ kind: 'compare', field: 'event.output.__proto__', op: 'exists' }),
    /invalid field path/)
  assert.throws(() => compileReminderCondition({ kind: 'count', source: { kind: 'text', field: 'event.output.text',
    projection: 'raw', locale: 'zh-CN' }, pattern: { kind: 'regex', pattern: '[' }, metric: 'occurrences',
    window: { kind: 'current-block' }, compare: { op: 'eq', value: 0 }, limits }), /invalid regular expression/)
  assert.throws(() => compileReminderCondition({ kind: 'count', source: { kind: 'text', field: 'event.output.text',
    projection: 'raw', locale: 'zh-CN' }, pattern: { kind: 'literal', text: '目标' }, metric: 'occurrences',
    window: { kind: 'current-block' }, compare: { op: 'eq', value: 0 },
    limits: { ...limits, maxTextChars: 1024 * 1024 + 1 } }), /maxTextChars|Too big/i)
})

test('worker入口接受JSON并返回三值结果，超预算则明确失败', async () => {
  // 执行期收的是**已编译**的条件树：上限在注册时就已经烘进树里，
  // 所以这里先编译，而不是像以前那样把 countLimits 一起传进去再编译一遍。
  const condition = compileReminderCondition(counting({ op: 'gte', value: 2 }), limits)
  const result = await executeReminderMatch({ condition, maxBytes: 4096,
    event: { type: 'assistant.output', sessionId: 's', callId: 'c', rootCallId: 'c',
      clock: { at: 1 }, output: { attemptId: 'attempt-1', turn: 1, step: 1, index: 0, type: 'text', text, offset: 0 },
      textSamples: [sample()] } })
  assert.equal(result.status, 'matched')
  await assert.rejects(executeReminderMatch({ condition, maxBytes: 8,
    event: { type: 'assistant.output', sessionId: 's', callId: 'c', rootCallId: 'c',
      clock: { at: 1 }, output: { attemptId: 'attempt-1', turn: 1, step: 1, index: 0, type: 'text', text, offset: 0 },
      textSamples: [sample()] } }), /budget-exceeded/)
})
