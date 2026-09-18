import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendText, createStreamWatch, createView, DETECTORS, LINE_WINDOW, TEXT_LIMIT, viewTail,
} from '../src/stream-watch.js'

const start = (watch, agent) => watch.observe(agent, { type: 'start', turn: 1, step: 1 })
const delta = (watch, agent, type, text) => watch.observe(agent, { type: 'chunk', chunk: { type, text } })
const textDelta = (watch, agent, text) => delta(watch, agent, 'text-delta', text)

/** 一个只收集命中的管线。 */
function collector(triggers, options = {}) {
  const hits = []
  const errors = []
  const watch = createStreamWatch({
    triggers,
    actions: { hit: ({ hit }) => hits.push(hit), ...options.actions },
    onError: error => errors.push(error),
  })
  return { watch, hits, errors }
}

const repeatTrigger = (overrides = {}) => ({
  id: 'r', kind: 'line-repeat', scope: 'text', everyBytes: 40,
  minLines: 30, minCount: 30, minRatio: 0.35, minRun: 12, actions: ['hit'], ...overrides,
})

// ------------------------------------------------------------ 视图的成本

test('视图只保留固定行数的窗口，计数与窗口同步', () => {
  const view = createView()
  for (let index = 0; index < 500; index += 1) appendText(view, `line ${index}\n`)
  assert.equal(view.window.length, LINE_WINDOW)
  assert.ok(view.counts.size <= LINE_WINDOW, '计数表不该比窗口还大')
  assert.equal([...view.counts.values()].reduce((sum, n) => sum + n, 0), LINE_WINDOW)
})

test('视图的文本总量受上限约束：逐段累积与单个超长块都不能突破', () => {
  const drip = createView()
  for (let index = 0; index < 50000; index += 1) appendText(drip, 'x')
  assert.ok(drip.length <= TEXT_LIMIT + 1, `逐段累积超限：${drip.length}`)

  const bulk = createView()
  appendText(bulk, 'y'.repeat(TEXT_LIMIT * 3))
  assert.ok(bulk.length <= TEXT_LIMIT, `超长单块绕过丢弃规则：${bulk.length}`)
})

test('viewTail 不重复末尾未完成行，也不拼接整段历史', () => {
  const view = createView()
  appendText(view, 'first\nsecond')
  assert.equal(viewTail(view, 100), 'first\nsecond')
  assert.equal(viewTail(view, 6), 'second')
})

test('短行与空行不进入窗口', () => {
  const view = createView()
  appendText(view, 'ab\n{}\n\n   \nreal line\n')
  assert.deepEqual(view.window, ['real line'])
})

// -------------------------------------------------------- marker 的成本

test('marker 的滑动窗口不随帧数增长：喂一万帧，进位尾巴仍是常数长度', () => {
  const state = DETECTORS.marker.create({ token: 'ABCDEF' })
  for (let index = 0; index < 10000; index += 1) DETECTORS.marker.feed(state, 'q')
  assert.ok(state.carry.length <= 'ABCDEF'.length - 1, `进位尾巴涨到了 ${state.carry.length}`)
})

test('marker 能跨帧拼出标记，且同一 attempt 内只报一次', () => {
  const { watch, hits } = collector([
    { id: 'm', kind: 'marker', token: 'XYZZY', scope: 'text', actions: ['hit'] },
  ])
  const agent = { id: 'a' }
  start(watch, agent)
  for (const piece of ['AB', 'XY', 'Z', 'ZY', 'CD', 'XYZZY']) textDelta(watch, agent, piece)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].token, 'XYZZY')
})

test('scope 决定看哪一路增量：只声明 text 的模式不吃思考块', () => {
  const { watch, hits } = collector([
    { id: 'm', kind: 'marker', token: 'HIT', scope: 'text', actions: ['hit'] },
  ])
  const agent = { id: 'a' }
  start(watch, agent)
  delta(watch, agent, 'reasoning-delta', 'HIT')
  assert.equal(hits.length, 0, '思考块不该触发只看正文的模式')
  textDelta(watch, agent, 'HIT')
  assert.equal(hits.length, 1)
})

// -------------------------------------------------- line-repeat 的判定

test('line-repeat：窗口里密集重复的行命中', () => {
  const { watch, hits } = collector([repeatTrigger()])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 60; index += 1) textDelta(watch, agent, 'same line\n')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].kind, 'line-repeat')
  assert.equal(hits[0].line, 'same line')
  assert.ok(hits[0].ratio >= 0.35)
})

test('line-repeat：稀疏重复不命中（正常的长清单不该被误杀）', () => {
  const { watch, hits } = collector([repeatTrigger()])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let round = 0; round < 8; round += 1) {
    for (let index = 0; index < 10; index += 1) textDelta(watch, agent, `line-${index}\n`)
  }
  assert.equal(hits.length, 0)
})

test('line-repeat：次数不够但连续重复照样命中', () => {
  const { watch, hits } = collector([repeatTrigger()])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 68; index += 1) textDelta(watch, agent, `unique line ${index}\n`)
  for (let index = 0; index < 20; index += 1) textDelta(watch, agent, 'zzz\n')
  assert.equal(hits.length, 1)
  assert.ok(hits[0].run >= 12, `连续段只有 ${hits[0].run}`)
  assert.ok(hits[0].count < 30, `这条本该靠连续段命中，次数却到了 ${hits[0].count}`)
})

test('line-repeat：行数不够时任何比例都不判', () => {
  const { watch, hits } = collector([repeatTrigger({ everyBytes: 1, minLines: 30 })])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 10; index += 1) textDelta(watch, agent, 'same line\n')
  assert.equal(hits.length, 0)
})

// ------------------------------------------------------------ 引擎调度

test('windowed 模式按累计字节节流：没到量就根本不叫判定器', () => {
  const { watch, hits } = collector([repeatTrigger({ everyBytes: 100000 })])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 100; index += 1) textDelta(watch, agent, 'same line\n')
  assert.equal(hits.length, 0)
})

test('命中后同一 attempt 不再重复触发，start 帧会重置', () => {
  const { watch, hits } = collector([repeatTrigger({ everyBytes: 1, minRun: 5, minCount: 5, minLines: 10 })])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 40; index += 1) textDelta(watch, agent, 'same line\n')
  assert.equal(hits.length, 1)
  start(watch, agent)
  for (let index = 0; index < 40; index += 1) textDelta(watch, agent, 'same line\n')
  assert.equal(hits.length, 2, '新 attempt 应该重新开始判定')
})

test('不同会话互不干扰，各自维护状态', () => {
  const { watch, hits } = collector([repeatTrigger({ everyBytes: 1, minRun: 5, minCount: 5, minLines: 10 })])
  const first = { id: 'a' }
  const second = { id: 'b' }
  start(watch, first)
  start(watch, second)
  for (let index = 0; index < 20; index += 1) textDelta(watch, second, 'same line\n')
  assert.equal(hits.length, 1)
  const state = watch.inspect()
  assert.equal(state.a.views.text, undefined, '没喂过文本的会话不该凭空有一份视图')
  assert.equal(state.b.views.text.lines, 20)
})

test('操作抛错被记账，不会把这一帧的判定打断', () => {
  const errors = []
  const watch = createStreamWatch({
    triggers: [repeatTrigger({ everyBytes: 1, minRun: 5, minCount: 5, minLines: 10 })],
    actions: { hit() { throw new Error('boom') } },
    onError: error => errors.push(error.message),
  })
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 20; index += 1) textDelta(watch, agent, 'same line\n')
  assert.deepEqual(errors, ['boom'])
  assert.equal(watch.inspect().a.errors.length, 1)
})

test('未知操作被如实记账，不静默跳过', () => {
  const { watch } = collector([repeatTrigger({ everyBytes: 1, minRun: 5, minCount: 5, minLines: 10, actions: ['nope'] })])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 20; index += 1) textDelta(watch, agent, 'same line\n')
  assert.match(watch.inspect().a.errors[0], /unknown action nope/)
})

test('非文本增量（工具调用、用量、收尾）不参与判定', () => {
  const { watch, hits } = collector([repeatTrigger({ everyBytes: 1, minRun: 5, minCount: 5, minLines: 10 })])
  const agent = { id: 'a' }
  start(watch, agent)
  for (let index = 0; index < 20; index += 1) {
    delta(watch, agent, 'tool-call-delta', 'same line\n')
    watch.observe(agent, { type: 'chunk', chunk: { type: 'usage', usage: {} } })
  }
  assert.equal(hits.length, 0)
  assert.ok(watch.inspect().a.views.text === undefined || watch.inspect().a.views.text.lines === 0)
})

// ---------------------------------------------------------- phrase 模式

test('phrase：任意短语命中即报，且能跨帧拼出来', () => {
  const { watch, hits } = collector([
    { id: 'p', kind: 'phrase', scope: 'reasoning', phrases: ['时间不够', '加快速度'], actions: ['hit'] },
  ])
  const agent = { id: 'a' }
  start(watch, agent)
  delta(watch, agent, 'reasoning-delta', '嗯，')
  delta(watch, agent, 'reasoning-delta', '时间')
  delta(watch, agent, 'reasoning-delta', '不够')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].phrase, '时间不够')
})

test('phrase：空词表不报，词表里的短串也不会误吞', () => {
  const { watch, hits } = collector([
    { id: 'p', kind: 'phrase', scope: 'reasoning', phrases: [], actions: ['hit'] },
  ])
  const agent = { id: 'a' }
  start(watch, agent)
  delta(watch, agent, 'reasoning-delta', '时间不够')
  assert.equal(hits.length, 0, '空词表不该报')
})

test('长度为 1 的模式不会让进位尾巴无限增长（slice(-0) 的坑）', () => {
  const phraseState = DETECTORS.phrase.create({ phrases: ['x'] })
  const markerState = DETECTORS.marker.create({ token: 'Z' })
  for (let index = 0; index < 5000; index += 1) {
    DETECTORS.phrase.feed(phraseState, 'q')
    DETECTORS.marker.feed(markerState, 'q')
  }
  assert.equal(phraseState.carry.length, 0)
  assert.equal(markerState.carry.length, 0)
})
