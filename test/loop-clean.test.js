import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanTail, cleanMessage, cleanMessages, PATTERNS } from '../src/loop-clean.js'
import { detectLoop } from '../src/loop-guard.js'

/** 造一段像真实循环的文本:前面正常,尾巴上同一行刷了几十遍。 */
function loopingText() {
  const head = ['先读 surface 的实现', '再看 invariant 的约束', '这里有几个点要查'].join('\n')
  const spin = Array.from({ length: 40 }, () => '（做。）').join('\n')
  return head + '\n' + spin
}

test('正常文本原样返回', () => {
  const text = '第一行\n第二行\n第三行'
  assert.deepEqual(cleanTail(text), { text, removedLines: 0, pattern: undefined })
})

test('行数太少不判（拿不构成填充行的内容试）', () => {
  // 不能用「（做。）」之类的短句:那种现在归 filler-lines 管,门槛只有 5 行。
  // 这条要单独验的是 line-repeat 的门槛,所以内容要够长、不带填充字。
  const text = Array.from({ length: 10 }, () => '读一遍 surface 的实现过程').join('\n')
  assert.equal(cleanTail(text).removedLines, 0)
})

test('十条短填充行就该判 —— filler-lines 的门槛比 line-repeat 低', () => {
  const text = Array.from({ length: 10 }, () => '（做。）').join('\n')
  const cleaned = cleanTail(text)
  assert.equal(cleaned.pattern, 'filler-lines')
  assert.equal(cleaned.removedLines, 10)
})

test('循环文本被截断并留下说明', () => {
  const cleaned = cleanTail(loopingText())
  assert.ok(cleaned.removedLines > 0)
  assert.match(cleaned.text, /先读 surface 的实现/)
  assert.match(cleaned.text, /已清理/)
  assert.equal(cleaned.text.includes('（做。）'), false)
  assert.equal(cleaned.pattern, 'line-repeat')
})

test('同样的输入产出同样的结果 —— 缓存要的就是这个', () => {
  const text = loopingText()
  assert.deepEqual(cleanTail(text), cleanTail(text))
  // 清理过的再清一次不再变:第二次请求不会重复花缓存。
  const once = cleanTail(text).text
  assert.deepEqual(cleanTail(once), { text: once, removedLines: 0, pattern: undefined })
})

test('代码围栏行不参与统计', () => {
  const fences = Array.from({ length: 40 }, () => '```').join('\n')
  assert.equal(cleanTail(fences).removedLines, 0)
})

test('cleanMessage 只碰 reasoning 和 text 块，且不改原件', () => {
  const message = {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: loopingText() },
      { type: 'image', data: 'x' },
    ],
  }
  const cleaned = cleanMessage(message)
  assert.ok(cleaned.removedLines > 0)
  assert.notEqual(cleaned.message, message)
  assert.equal(cleaned.message.content[1].data, 'x')
  assert.equal(message.content[0].text.includes('已清理'), false)
})

test('cleanMessages 只清最后一条助手消息', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '问' }] },
    { role: 'assistant', content: [{ type: 'text', text: loopingText() }] },
    { role: 'user', content: [{ type: 'text', text: '再问' }] },
  ]
  const result = cleanMessages(messages)
  assert.ok(result.removedLines > 0)
  assert.equal(result.index, 1)
  assert.match(result.messages[1].content[0].text, /已清理/)
  assert.equal(messages[1].content[0].text.includes('已清理'), false)
})

test('没有助手消息时原样返回', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  const result = cleanMessages(messages)
  assert.equal(result.index, -1)
  assert.equal(result.messages, messages)
})

test('跟 loop-guard 串起来:检测到就清得掉', () => {
  // 假 session 跟真实会话同形:surface.nodes 上是 seq,eventAt 取回事件。
  const message = { role: 'assistant', content: [{ type: 'reasoning', text: loopingText() }] }
  const event = { type: 'assistant/message', seq: 1, time: 0, data: { turn: 1, step: 1, message, stream: [] } }
  const session = { surface: { nodes: [1] }, eventAt: () => event }

  const hit = detectLoop(session)
  assert.ok(hit !== undefined, 'loop-guard 应该认出这段循环')
  assert.equal(hit.line, '（做。）')

  const messages = [{ role: 'user', content: [] }, message]
  const cleaned = cleanMessages(messages)
  assert.ok(cleaned.removedLines > 0)
  assert.equal(cleaned.index, 1)
  assert.match(cleaned.messages[1].content[0].text, /已清理/)
  // 原文不动 —— 日志里那份还在。
  assert.equal(message.content[0].text.includes('已清理'), false)
})

test('模式表是加模式的唯一入口', () => {
  // 「打地鼠」的现实:只能一个个抓。结构要保证加一个模式只动 PATTERNS 一处。
  assert.equal(PATTERNS.length, 2)
  for (const pattern of PATTERNS) {
    assert.equal(typeof pattern.id, 'string')
    assert.equal(typeof pattern.detect, 'function')
    assert.equal(typeof pattern.clean, 'function')
  }
})

/** 第二个真实样本（2026-09-23 截图，原样抄）。 */
function fillerSample() {
  return [
    '做。',
    '嗯，简洁。',
    '做。',
    '嗯，先记忆 + 落盘，然后回复 ✓',
    '做。',
    '嗯，一次做完。',
    '做。',
    '好。',
    '做。',
    '（直接做。）',
    '做。',
  ].join('\n')
}

test('第二个真实样本:填充行成片出现，靠行的性质认出来', () => {
  // 「做。」只出现 6 次，够不到 line-repeat 的 15 次门槛 —— 它靠的是 filler-lines。
  const cleaned = cleanTail(fillerSample())
  assert.equal(cleaned.pattern, 'filler-lines')
  assert.ok(cleaned.removedLines > 0)
  assert.equal(cleaned.text.includes('做。'), false)
  assert.match(cleaned.text, /已清理/)
  // 承载信息的那两行留着。
  assert.match(cleaned.text, /先记忆 \+ 落盘/)
  assert.match(cleaned.text, /一次做完/)
})

test('填充行清理后幂等', () => {
  const once = cleanTail(fillerSample()).text
  assert.deepEqual(cleanTail(once), { text: once, removedLines: 0, pattern: undefined })
})

test('正常的短句不会被当成填充行', () => {
  const text = [
    '读一下 surface 的实现',
    '看 invariant 的约束',
    '确认 pre-step 的时序',
    '写实现',
  ].join('\n')
  assert.equal(cleanTail(text).removedLines, 0)
})

test('长句即使含「做」也不算填充行', () => {
  const text = [
    '这一步做完之后要跑一遍全部测试确认没坏',
    '然后把结果写进进度文件里免得压缩带来丢失',
    '最后再提交推送两个仓库的改动',
  ].join('\n')
  assert.equal(cleanTail(text).removedLines, 0)
})

test('代码块里的短行不会被误清', () => {
  // 中文注释 + 短代码行,全都够得着 filler-lines 的形状 —— 必须靠围栏挡住。
  const text = [
    '改这个函数:',
    '```js',
    'do()',
    'go()',
    '// 做',
    '好',
    'done()',
    '```',
    '然后跑测试',
  ].join('\n')
  assert.equal(cleanTail(text).removedLines, 0)
})

test('围栏内的重复长块也不参与 line-repeat', () => {
  const body = Array.from({ length: 40 }, () => 'result = compute(input)').join('\n')
  const text = '```python\n' + body + '\n```'
  assert.equal(cleanTail(text).removedLines, 0)
})

test('围栏外的填充行照清,围栏内的留着', () => {
  const text = [
    '做。',
    '做。',
    '做。',
    '```',
    '做。',
    '做。',
    '做。',
    '```',
    '做。',
    '做。',
  ].join('\n')
  const cleaned = cleanTail(text)
  assert.equal(cleaned.pattern, 'filler-lines')
  // 围栏里的三行留着,外面那五行清掉。
  assert.equal(cleaned.text.includes('```'), true)
  assert.match(cleaned.text, /```\n做。\n做。\n做。\n```/)
})
