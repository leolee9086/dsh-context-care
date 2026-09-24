// 判定表（loop-patterns.js）：形状认得对不对、严重度分得对不对、会不会误报。
//
// 这里锁的是 2026-09-25 那次真机漏报：她的会话里模型退化成「好。/做。/输出。」的短句轮转，
// 判定表一条都没命中，于是从来没有提醒过。样本都从会话日志里原样抄来。
import test from 'node:test'
import assert from 'node:assert/strict'
import { CLEANABLE_IDS, describeHit, detectDegradation } from '../src/loop-patterns.js'
import { detectLoop, loopNeedsReminder, loopNoticeText } from '../src/loop-guard.js'

/** 把一段助手文本包成 detectLoop 认得的 session。 */
function assistantSession(text) {
  const event = {
    type: 'assistant/message', seq: 1, time: 0,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text }] }, stream: [] },
  }
  return { surface: { nodes: [1] }, eventAt: () => event }
}

/** 严重档样本：同一行长行刷满尾巴（真机上重复上百行那种）。 */
function repeatSample() {
  return ['先读 surface 的实现', '再看 invariant 的约束'].join('\n')
    + '\n' + Array.from({ length: 40 }, () => '（做。）').join('\n')
}

/** 轻微档样本一：三行短句稀疏轮转 —— 任何一行都到不了 15 次，旧判据永远看不见。 */
function weakCycleSample() {
  const cycle = ['看代码。', '写测试。', '跑一遍。']
  const lines = []
  for (let index = 0; index < 24; index += 1) {
    lines.push(cycle[index % cycle.length], '')
  }
  return lines.join('\n')
}

/** 轻微档样本二：2026-09-25 turn 19 的真机轮转，原样抄（短句本身是填充词）。 */
function realWeakCycleSample() {
  const cycle = ['好。', '做。', '输出。']
  const lines = []
  for (let index = 0; index < 24; index += 1) {
    lines.push(cycle[index % cycle.length], '')
  }
  return lines.join('\n')
}

/** 轻微档样本三：2026-09-25 哥哥报的行首单调，原样抄。 */
function prefixSample() {
  return [
    '嗯，先落盘再压缩。',
    '嗯，这次先不改代码。',
    '嗯，先看一眼 surface 的实现。',
    '嗯，然后再决定要不要动它。',
    '嗯，先把结论写给哥哥看。',
    '嗯，先确认 pre-step 的时序。',
    '嗯，先把 invariant 读一遍。',
    '嗯，再回来处理这个卡片。',
    '嗯，先记一笔再继续。',
    '嗯，先看日志里有没有线索。',
    '嗯，先跑一遍测试。',
    '嗯，然后再改文案。',
  ].join('\n')
}

test('行重复占满尾巴 → 严重档（硬清理的对象）', () => {
  const hit = detectDegradation(repeatSample())
  assert.equal(hit.pattern, 'line-repeat')
  assert.equal(hit.line, '（做。）')
  assert.equal(hit.severity, 'severe')
  assert.ok(CLEANABLE_IDS.includes(hit.pattern))
})

test('三行短句稀疏轮转 → 轻微档（认得出，但只提醒）', () => {
  const hit = detectDegradation(weakCycleSample())
  assert.equal(hit?.pattern, 'line-cycle')
  assert.equal(hit?.severity, 'mild')
  assert.ok(hit.ratio > 0.5, `三条短句应当占满尾巴，实测 ${hit.ratio}`)
  // 单行门槛（≥15 次）在这里永远够不到，这正是旧判据漏掉它的原因。
  assert.ok(hit.count >= 24)
})

test('真机那次「好。/做。/输出。」也算轻微档 —— 短句轮转不该被硬清掉', () => {
  const hit = detectDegradation(realWeakCycleSample())
  assert.ok(hit !== undefined, '短句轮转不该漏')
  assert.equal(hit.pattern, 'line-cycle')
  assert.equal(hit.severity, 'mild')
  // 每一条单行只占尾巴的三分之一（8/24），够不到 line-repeat 的 15 次；
  // 三条加起来占满 —— 这正是"轮转"与"单行刷屏"的区别：后者才是硬清理的对象。
  assert.equal(hit.cycle.length, 3)
  assert.ok(hit.count >= 24)
})

test('混合型刷屏（单行占一半）也是轻微档 —— 真机那批就长这样', () => {
  // 2026-09-25 真机：80 行窗口里「好。」出现 40 次（50%），中间夹着别的短句。
  // 这类只提醒：从第一次出现处截断，会把夹在中间的正常内容一起切掉。
  const lines = []
  for (let index = 0; index < 40; index += 1) lines.push('好。', '看一遍实现。')
  const hit = detectDegradation(lines.join('\n'))
  assert.equal(hit.pattern, 'line-repeat')
  assert.equal(hit.severity, 'mild')
  assert.equal(loopNeedsReminder(hit, true), true)
})

test('行首单调（每行都以「嗯，」开头）单独成一类，也是轻微档', () => {
  const hit = detectDegradation(prefixSample())
  assert.equal(hit.pattern, 'prefix-monotony')
  assert.equal(hit.prefix, '嗯，')
  assert.equal(hit.severity, 'mild')
  assert.ok(hit.count >= 10)
})

test('填充行成片 → 严重档', () => {
  const text = ['做。', '嗯，简洁。', '做。', '嗯，一次做完。', '做。', '好。', '做。', '（直接做。）', '做。'].join('\n')
  const hit = detectDegradation(text)
  assert.equal(hit.pattern, 'filler-lines')
  assert.equal(hit.severity, 'severe')
})

test('正常散文一条都不命中', () => {
  const prose = [
    '先看 surface 的实现：它按 surface 节点给事件定价。',
    'invariant 那边要求同一个 turn 内的替换必须连续，否则直接拒绝。',
    '所以清理只能碰最后一条助手消息，往前翻会改到已经定稿的历史。',
    '围栏保护是必须的：代码块里短行、注释、示例文本都天然重复。',
    '误清代码比漏清一段退化严重得多，前者毁任务材料。',
    '判定只吃文本，不碰会话，也不碰请求，这样两层才能共用一份。',
    '改完要跑测试，再在真机会话上量一遍命中率。',
    '命中之后提醒模型先落盘、再压缩，顺序不能反。',
    '压缩会带走细节，所以笔记必须先写。',
    '这条提醒只在 agent 层注入，请求层的清理模型看不见。',
  ].join('\n')
  assert.equal(detectDegradation(prose), undefined)
})

test('代码块里的重复短行不算循环', () => {
  const text = ['```python', ...Array.from({ length: 40 }, () => 'x = 1'), '```'].join('\n')
  assert.equal(detectDegradation(text), undefined)
})

test('轻微档一律提醒 —— 清不掉它，也就没有"房间里的大象"', () => {
  for (const sample of [weakCycleSample(), realWeakCycleSample(), prefixSample()]) {
    const hit = detectLoop(assistantSession(sample))
    assert.equal(hit?.severity, 'mild')
    assert.equal(loopNeedsReminder(hit, true), true, '有执行者也提醒')
    assert.equal(loopNeedsReminder(hit, false), true, '没执行者更得提醒')
  }
})

test('严重档：有清理执行者就不提醒，没有才兜底提醒', () => {
  const repeat = detectLoop(assistantSession(repeatSample()))
  assert.equal(repeat?.severity, 'severe')
  assert.equal(loopNeedsReminder(repeat, true), false, '清得掉就别再提醒它去找一段不存在的文本')
  assert.equal(loopNeedsReminder(repeat, false), true, '清不掉就必须说')

  const filler = detectDegradation(['做。', '嗯，简洁。', '做。', '嗯，一次做完。', '做。', '好。', '做。', '（直接做。）', '做。'].join('\n'))
  assert.equal(loopNeedsReminder(filler, true), false)
  assert.equal(loopNeedsReminder(filler, false), true)
})

test('没命中就不提醒', () => {
  assert.equal(loopNeedsReminder(undefined, true), false)
  assert.equal(loopNeedsReminder(undefined, false), false)
})

test('提醒正文说出命中的是哪一种形状', () => {
  const cycle = loopNoticeText(detectLoop(assistantSession(weakCycleSample())))
  assert.match(cycle, /检测到输出循环/)
  assert.match(cycle, /这组短句来回重复/)
  assert.match(cycle, /context_rest/)
  const prefix = loopNoticeText(detectLoop(assistantSession(prefixSample())))
  assert.match(prefix, /行都以「嗯，」开头/)
  assert.match(describeHit({ pattern: 'line-repeat', line: 'go.', count: 60, total: 80, ratio: 0.75 }), /「go\.」重复了 60 次/)
})
