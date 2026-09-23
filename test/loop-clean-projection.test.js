import test from 'node:test'
import assert from 'node:assert/strict'
import { LOOP_CLEAN_EVENT, loopCleanProjection, pendingLoopClean } from '../src/loop-clean-projection.js'

/** 造一段像真实循环的文本:前面正常,尾巴上同一行刷了几十遍。 */
function loopingText() {
  const head = ['先读 surface 的实现', '再看 invariant 的约束', '这里有几个点要查'].join('\n')
  const spin = Array.from({ length: 40 }, () => '（做。）').join('\n')
  return head + '\n' + spin
}

/**
 * 假会话:跟真实会话同形 —— surface.nodes 上是 seq,eventAt 取回事件。
 * derived 模拟 deriveEventMessage 已经带上投影的情形。
 */
function fakeSession(message, { derived } = {}) {
  const event = { type: 'assistant/message', seq: 1, time: 0, data: { turn: 1, step: 1, message, stream: [] } }
  return {
    event,
    surface: { nodes: [1] },
    eventAt: seq => (seq === 1 ? event : undefined),
    deriveEventMessage: () => (derived === undefined ? message : derived),
  }
}

/** 造一条决策事件。 */
function decision(seq, ruleId) {
  return { type: LOOP_CLEAN_EVENT, seq: 9, time: 0, data: { targets: [{ seq, ruleId }] } }
}

/** 投影的 context —— 真会话在 fold 时给的形状。baseSeq 为 0,events[seq] 就是源事件。 */
function contextOf(session) {
  return {
    nodes: session.surface.nodes,
    events: [undefined, session.event],
    baseSeq: 0,
    messages: new Map(),
  }
}

test('投影把指的助手输出换成清理版,且只换内容', () => {
  const message = { role: 'assistant', id: 'm1', content: [{ type: 'reasoning', text: loopingText() }] }
  const session = fakeSession(message)
  const out = loopCleanProjection.project(decision(1, 'line-repeat'), contextOf(session))
  assert.equal(out.size, 1)
  const cleaned = out.get(1)
  assert.match(cleaned.content[0].text, /已清理/)
  assert.equal(cleaned.content[0].text.includes('（做。）'), false)
  // 保持身份:只换内容,不换 id。
  assert.equal(cleaned.id, 'm1')
  // 原件不动 —— 日志里那份还在。
  assert.equal(message.content[0].text.includes('已清理'), false)
  // 投影共享出去的消息要是冻结的。
  assert.equal(Object.isFrozen(cleaned), true)
  assert.equal(Object.isFrozen(cleaned.content), true)
})

test('已经清过的再投影一次得到空表 —— 不重复废缓存', () => {
  const message = { role: 'assistant', content: [{ type: 'reasoning', text: loopingText() }] }
  const cleanedOnce = loopCleanProjection.project(decision(1, 'line-repeat'), contextOf(fakeSession(message))).get(1)
  const context = contextOf(fakeSession(message))
  // 上一次投影的结果已经在这条消息上。
  context.messages.set(1, cleanedOnce)
  assert.equal(loopCleanProjection.project(decision(1, 'line-repeat'), context).size, 0)
})

test('data 形状不对就抛错,不猜', () => {
  const session = fakeSession({ role: 'assistant', content: [] })
  const context = contextOf(session)
  const bad = [
    undefined, null, [], {},
    { targets: [] },
    { targets: [{ seq: 1 }] },
    { targets: [{ seq: -1, ruleId: 'x' }] },
    { targets: [{ seq: 1.5, ruleId: 'x' }] },
    { targets: [{ seq: 1, ruleId: '' }] },
    { targets: [{ seq: 1, ruleId: 'x', extra: 1 }] },
    { targets: [{ seq: 1, ruleId: 'x' }, { seq: 1, ruleId: 'y' }] },
    { targets: [{ seq: 1, ruleId: 'x' }], extra: 1 },
  ]
  for (const data of bad) {
    assert.throws(
      () => loopCleanProjection.project({ type: LOOP_CLEAN_EVENT, seq: 9, time: 0, data }, context),
      error => error.message.startsWith(LOOP_CLEAN_EVENT),
      `应该拒绝 ${JSON.stringify(data)}`,
    )
  }
})

test('指到不存在或类型不对的节点就抛错', () => {
  const session = fakeSession({ role: 'assistant', content: [] })
  // 7 号不在 surface 上。
  assert.throws(() => loopCleanProjection.project(decision(7, 'line-repeat'), contextOf(session)), /不是当前 surface 节点/)
  // 是节点,但不是 assistant/message。
  const systemContext = {
    ...contextOf(session),
    events: [undefined, { type: 'system/message', seq: 1, time: 0, data: { message: {} } }],
  }
  assert.throws(() => loopCleanProjection.project(decision(1, 'line-repeat'), systemContext), /不是 assistant\/message/)
})

test('决策记的模式和实际命中的对不上就抛错', () => {
  const message = { role: 'assistant', content: [{ type: 'reasoning', text: loopingText() }] }
  assert.throws(
    () => loopCleanProjection.project(decision(1, 'filler-lines'), contextOf(fakeSession(message))),
    /实际命中 line-repeat/,
  )
})

test('pendingLoopClean 认出最后一条助手输出的循环', () => {
  const session = fakeSession({ role: 'assistant', content: [{ type: 'reasoning', text: loopingText() }] })
  const pending = pendingLoopClean(session)
  assert.equal(pending.seq, 1)
  assert.equal(pending.ruleId, 'line-repeat')
  assert.ok(pending.removedLines > 0)
})

test('pendingLoopClean 对正常输出不动作', () => {
  const session = fakeSession({ role: 'assistant', content: [{ type: 'text', text: '第一行\n第二行' }] })
  assert.equal(pendingLoopClean(session), undefined)
})

test('已经清过的不再重复决定 —— 幂等靠的是看当前可见的那份', () => {
  const raw = { role: 'assistant', content: [{ type: 'reasoning', text: loopingText() }] }
  // 真会话里 deriveEventMessage 返回的就是投影后的版本。
  const cleanedOnce = loopCleanProjection.project(decision(1, 'line-repeat'), contextOf(fakeSession(raw))).get(1)
  assert.equal(pendingLoopClean(fakeSession(raw, { derived: cleanedOnce })), undefined)
})

test('没有助手输出就什么都不做', () => {
  const session = { surface: { nodes: [] }, eventAt: () => undefined, deriveEventMessage: () => null }
  assert.equal(pendingLoopClean(session), undefined)
})

test('决策事件 → 投影 一整条链路走通', () => {
  const message = { role: 'assistant', content: [{ type: 'reasoning', text: loopingText() }] }
  const session = fakeSession(message)
  const pending = pendingLoopClean(session)
  assert.ok(pending !== undefined)
  // pre-step 落的就是这条。
  const event = {
    type: LOOP_CLEAN_EVENT, seq: 2, time: 1,
    data: { targets: [{ seq: pending.seq, ruleId: pending.ruleId }] },
  }
  const out = loopCleanProjection.project(event, contextOf(session))
  assert.equal(out.size, 1)
  assert.match(out.get(pending.seq).content[0].text, /已清理/)
})

test('投影的形状跟 DSH 要的一致', () => {
  assert.equal(LOOP_CLEAN_EVENT, 'context-care/loop-clean')
  assert.equal(loopCleanProjection.type, LOOP_CLEAN_EVENT)
  assert.equal(typeof loopCleanProjection.project, 'function')
})
