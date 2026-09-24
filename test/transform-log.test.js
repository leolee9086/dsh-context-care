import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransformLog, TRANSFORM_EVENT } from '../src/transform-log.js'

/** 一个够用的假 ctx:只要 logger。 */
function fakeCtx() {
  const infos = []
  return {
    infos,
    logger: { info: message => infos.push(message) },
    get: () => undefined,
  }
}

// 2026-09-23 起变换记录**不写会话日志**(自定义事件被读侧拒载,见 transform-log.js 头注释),
// 只进插件日志。事件类型名保留,等 C 方案(Session.append 开 ignorable 写入口)落地再恢复。

test('记一条变换到插件日志', () => {
  const ctx = fakeCtx()
  createTransformLog({ ctx }).record({
    sessionId: 's1', layer: 'notice', ruleId: 'r1', outcome: 'applied', loss: 0.25, detail: '去掉了 3 行',
  })
  assert.equal(ctx.infos.length, 1)
  const line = ctx.infos[0]
  assert.match(line, /layer=notice/)
  assert.match(line, /ruleId=r1/)
  assert.match(line, /outcome=applied/)
  assert.match(line, /loss=0\.25/)
  assert.match(line, /detail=去掉了 3 行/)
  assert.match(line, /session=s1/)
  assert.equal(TRANSFORM_EVENT, 'context-care/transform')
})

test('没有可选字段时不带那些片段', () => {
  const ctx = fakeCtx()
  createTransformLog({ ctx }).record({ layer: 'notice', ruleId: 'r', outcome: 'applied' })
  const line = ctx.infos[0]
  assert.equal(line.includes(' loss='), false)
  assert.equal(line.includes(' detail='), false)
  assert.equal(line.includes(' session='), false)
})

test('拿不到会话也不报错 —— 不再依赖 sessions 服务', () => {
  const ctx = fakeCtx()
  // get 返回 undefined:换以前会 warn「拿不到会话」,现在 record 根本不查会话。
  createTransformLog({ ctx }).record({ sessionId: undefined, layer: 'notice', ruleId: 'r', outcome: 'applied' })
  assert.equal(ctx.infos.length, 1)
})

test('record 不再 append 会话事件', () => {
  const ctx = fakeCtx()
  const appended = []
  const sessionLike = { append: (type, data) => appended.push([type, data]) }
  const ctxWithSessions = {
    infos: ctx.infos,
    logger: ctx.logger,
    get: name => (name === 'sessions' ? { get: () => sessionLike } : undefined),
  }
  createTransformLog({ ctx: ctxWithSessions }).record({ sessionId: 's1', layer: 'request', ruleId: 'r', outcome: 'applied' })
  assert.equal(appended.length, 0)
})
