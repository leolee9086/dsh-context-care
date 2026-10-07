import test from 'node:test'
import assert from 'node:assert/strict'
import { detectOutputPatterns, OutputPatternConfig, patternTrigger } from '../src/output-patterns.js'
import { resolveScopedPrompts, selectScopedPrompts } from '../src/scoped-prompts.js'

import { detectorFixture } from './fixtures/detector.js'

test('counts complete prose with source offsets, overlap merging and distinct families', () => {
  const text = '我不能宣称、也不写成这样。\n我不会做、也不能宣称这样。\n我不写成这样。\n我不会做。\n证据已经查验。\n任务继续。\n正在测试。\n文件已保存。'
  const result = detectOutputPatterns(text, detectorFixture)
  assert.deepEqual([result.N, result.K, result.H, result.F, result.J, result.D], [8, 4, 6, 3, 2, 0.5])
  for (const hit of result.evidence) assert.equal(text.slice(hit.start, hit.end), hit.text)
  assert.equal(patternTrigger(result, [result], detectorFixture), 'single-output')
})

test('Markdown code, quotes and local vocabulary discussion are excluded but commitments count', () => {
  const result = detectOutputPatterns('> 我不能宣称。\n\n~~~js\n我不会做。\n~~~\n\n    我不写成。\n\n`我不能宣称`\n\n规则匹配“不会做”和“不写成”。\n\n我“不会做”任何未经授权的修改。', detectorFixture)
  assert.equal(result.H, 1)
  assert.equal(result.K, 1)
  assert.equal(result.N, 1)
  assert.equal(result.exclusions.length, 1)
  assert.equal(patternTrigger(result, [result], detectorFixture), undefined)
  assert.equal(detectOutputPatterns('~~~\n我不会做\n~~~', detectorFixture).D, null)
})

test('sparse output stays below thresholds; repeated short and window outputs trigger', () => {
  const sparse = detectOutputPatterns('我不能宣称通过。\n' + '已核对具体证据。\n'.repeat(19), detectorFixture)
  assert.equal(patternTrigger(sparse, [sparse], detectorFixture), undefined)
  const short = detectOutputPatterns('我不会做第一项。\n我不会做第二项。\n我不会做第三项。', detectorFixture)
  assert.equal(patternTrigger(short, [short], detectorFixture), 'single-output')
  const low = detectOutputPatterns('我不会做。\n我不会做。\n已核对。\n已测试。\n已记录。\n继续执行。', detectorFixture)
  assert.equal(patternTrigger(low, [low, low], detectorFixture), undefined)
  assert.equal(patternTrigger(low, [low, low, low], detectorFixture), 'window')
})

test('bounds report unavailable rather than measuring a tail; vocabulary/configuration fails at load', () => {
  assert.equal(detectOutputPatterns('x'.repeat(20001), detectorFixture).status, 'unavailable')
  assert.equal(detectOutputPatterns('继续。\n'.repeat(201), detectorFixture).reason, 'maxStatements')
  assert.equal(OutputPatternConfig.safeParse({ ...detectorFixture, maxPhrases: 1 }).success, false)
  assert.equal(OutputPatternConfig.safeParse({ ...detectorFixture, phrases: [{ id: 'x', family: 'x', regex: '.*' }] }).success, false)
  assert.throws(() => resolveScopedPrompts([{ ruleId: 'x', version: '1', provider: 'p', model: 'm', trigger: 'output-pattern', text: '检查证据' }]))
})

test('switch and static rules match exact routes, purposes and explicit first bind', () => {
  const rules = resolveScopedPrompts([{ ruleId: 'switch', version: '1', provider: 'p', model: 'm', trigger: 'model-switch', text: '{boundModelLabel}' }])
  const request = { provider: 'p', model: 'm' }
  assert.equal(selectScopedPrompts(rules, request).length, 0)
  assert.equal(selectScopedPrompts(rules, request, { provider: 'other', model: 'm' })[0].text, 'p/m')
  assert.equal(selectScopedPrompts(rules, { ...request, purpose: 'compaction' }, { provider: 'other', model: 'm' }).length, 0)
  assert.equal(selectScopedPrompts(rules, { ...request, model: 'm-next' }, { provider: 'other', model: 'm' }).length, 0)
})
