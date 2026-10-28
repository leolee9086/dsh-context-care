import { TextCountConfig, measureTextCount, combineTruth, negateTruth, markdownStatements } from '@leolee9086/dsh-rule-engine'
import type { TextCountOptions, MatchTruth } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

const base = TextCountConfig.parse({
  projection: 'raw', locale: 'zh-CN', pattern: { kind: 'literal', text: '目标' },
  metric: 'occurrences', compare: { op: 'gte', value: 1 },
  limits: { maxTextChars: 10000, maxCandidates: 100, maxUnits: 1000, maxEvidence: 10 },
})
const options = (overrides: Partial<TextCountOptions> = {}) => TextCountConfig.parse({ ...base, ...overrides })

test('文本计数保留UTF-16原文位置，最长优先消除多模式重叠', () => {
  const text = '😀目标目标。'
  const result = measureTextCount(text, options({ pattern: { kind: 'keywords', values: ['目标', '目标目标'] } }))
  assert.ok(result.status !== 'unavailable')
  assert.equal(result.value, 1)
  assert.deepEqual(result.evidence, [{ start: 2, end: 6, patternId: '1' }])
  assert.equal(text.slice(result.evidence[0]!.start, result.evidence[0]!.end), '目标目标')
  const repeated = measureTextCount('aaaaa', options({ pattern: { kind: 'literal', text: 'aaa' } }))
  assert.ok(repeated.status !== 'unavailable')
  assert.equal(repeated.counts.occurrences, 1)
})

test('Markdown投影对分子与分母使用同一组有效句子并排除元讨论', () => {
  const text = '😀目标。普通。\n\n> 目标。\n\n```txt\n目标。\n```\n\n`目标` 后文。\n\n说明：目标。'
  const result = measureTextCount(text, options({ projection: 'markdown-prose', metaPrefixes: ['说明：'],
    metric: { kind: 'ratio', numerator: 'matched-sentences', denominator: 'sentences', minDenominator: 3, scale: 1 } }))
  assert.ok(result.status !== 'unavailable')
  assert.equal(result.counts.occurrences, 1)
  assert.equal(result.counts.sentences, 3)
  assert.equal(result.value, 1 / 3)
  assert.deepEqual(result.evidence.map(hit => text.slice(hit.start, hit.end)), ['目标'])
  assert.ok(markdownStatements(text).every(span => span.end - span.start === span.text.length))
})

test('被排除区的占位空白不成为正则证据，也不让模式跨越代码', () => {
  const excluded = measureTextCount('```txt\n目标\n```', options({ projection: 'markdown-prose', pattern: { kind: 'regex', pattern: '.', flags: 'u' } }))
  assert.ok(excluded.status !== 'unavailable')
  assert.equal(excluded.value, 0)
  const crossing = measureTextCount('前`目标`后。', options({ projection: 'markdown-prose', pattern: { kind: 'regex', pattern: '前.*后', flags: 'u' } }))
  assert.ok(crossing.status !== 'unavailable')
  assert.equal(crossing.value, 0)
})

test('每百词次数可以大于100，命中词数仅统计一次', () => {
  const result = measureTextCount('aaaa', options({ locale: 'en', pattern: { kind: 'literal', text: 'a' },
    metric: { kind: 'ratio', numerator: 'occurrences', denominator: 'words', minDenominator: 1, scale: 100 } }))
  assert.ok(result.status !== 'unavailable')
  assert.equal(result.value, 400)
  assert.equal(result.counts['matched-words'], 1)
  assert.equal(result.counts['matched-sentences'], 1)
})

test('空文本绝对计数为零，最小分母不足不可用，ne不把不可用当命中', () => {
  const empty = measureTextCount('', base)
  assert.ok(empty.status !== 'unavailable')
  assert.equal(empty.value, 0)
  assert.equal(empty.status, 'unmatched')
  for (const text of ['', '目标。']) {
    assert.deepEqual(measureTextCount(text, options({ compare: { op: 'ne', value: 0 },
      metric: { kind: 'ratio', numerator: 'matched-sentences', denominator: 'sentences', minDenominator: 2, scale: 1 } })),
    { status: 'unavailable', reason: 'minDenominator' })
  }
})

test('证据截短保留完整数值，测量上限则返回不可用', () => {
  const result = measureTextCount('目标目标目标', options({ limits: { ...base.limits, maxEvidence: 1 } }))
  assert.ok(result.status !== 'unavailable')
  assert.equal(result.value, 3)
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidenceTruncated, true)
  assert.deepEqual(measureTextCount('目标目标', options({ limits: { ...base.limits, maxCandidates: 1 } })),
    { status: 'unavailable', reason: 'maxCandidates' })
  assert.deepEqual(measureTextCount('目标', options({ limits: { ...base.limits, maxTextChars: 1 } })),
    { status: 'unavailable', reason: 'maxTextChars' })
  assert.deepEqual(measureTextCount('目标。目标。', options({ limits: { ...base.limits, maxUnits: 1 } })),
    { status: 'unavailable', reason: 'maxUnits' })
})

test('零宽正则明确不可用，正则和locale错误在配置边界拒绝', () => {
  assert.deepEqual(measureTextCount('目标', options({ pattern: { kind: 'regex', pattern: '(?=目标)', flags: 'u' } })),
    { status: 'unavailable', reason: 'zero-width-match' })
  for (const pattern of [
    { kind: 'regex', pattern: '[', flags: 'u' }, { kind: 'regex', pattern: '.', flags: 'uu' },
    { kind: 'keywords', values: [''] },
  ]) assert.equal(TextCountConfig.safeParse({ ...base, pattern }).success, false)
  assert.equal(TextCountConfig.safeParse({ ...base, locale: '_' }).success, false)
})

test('raw正则锚点以完整输入为准，累计前缀重新测量可改变结果', () => {
  const config = options({ pattern: { kind: 'regex', pattern: '^目标$', flags: 'u' } })
  assert.equal(measureTextCount('目标', config).status, 'matched')
  assert.equal(measureTextCount('目标\n后文', config).status, 'unmatched')
  for (const op of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const) {
    const result = measureTextCount('目标', options({ compare: { op, value: 1 } }))
    assert.equal(result.status, ['eq', 'gte', 'lte'].includes(op) ? 'matched' : 'unmatched')
  }
})

test('三值条件保留不可用，明确的false和true分别主导all和any', () => {
  const values: MatchTruth[] = ['matched', 'unmatched', 'unavailable']
  assert.equal(negateTruth('unavailable'), 'unavailable')
  assert.equal(negateTruth('matched'), 'unmatched')
  assert.equal(negateTruth('unmatched'), 'matched')
  for (const left of values) for (const right of values) {
    const pair = [left, right]
    assert.equal(combineTruth('all', pair), pair.includes('unmatched') ? 'unmatched' : pair.includes('unavailable') ? 'unavailable' : 'matched')
    assert.equal(combineTruth('any', pair), pair.includes('matched') ? 'matched' : pair.includes('unavailable') ? 'unavailable' : 'unmatched')
  }
})
