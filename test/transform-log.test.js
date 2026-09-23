import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransformLog, TRANSFORM_EVENT } from '../src/transform-log.js'

/** 一个够用的假 ctx:sessions 服务 + logger。 */
function fakeCtx(sessions = {}) {
  const warns = []
  return {
    warns,
    logger: { warn: message => warns.push(message) },
    get: name => (name === 'sessions' ? { get: id => sessions[id] } : undefined),
  }
}

test('写一条 log-only 事件到会话', () => {
  const appended = []
  const ctx = fakeCtx({ s1: { append: (type, data) => appended.push([type, data]) } })
  createTransformLog({ ctx }).record({
    sessionId: 's1', layer: 'notice', ruleId: 'r1', outcome: 'applied', loss: 0.25,
  })
  assert.equal(appended.length, 1)
  assert.equal(appended[0][0], 'context-care/transform')
  assert.equal(TRANSFORM_EVENT, 'context-care/transform')
  assert.equal(appended[0][1].ruleId, 'r1')
  assert.equal(appended[0][1].layer, 'notice')
  assert.equal(appended[0][1].loss, 0.25)
  assert.equal(typeof appended[0][1].at, 'number')
  assert.deepEqual(ctx.warns, [])
})

test('没有 detail 时不写这个字段', () => {
  const appended = []
  const ctx = fakeCtx({ s1: { append: (_type, data) => appended.push(data) } })
  createTransformLog({ ctx }).record({ sessionId: 's1', layer: 'notice', ruleId: 'r', outcome: 'applied' })
  assert.equal('detail' in appended[0], false)
  assert.equal(appended[0].loss, 0)
})

test('拿不到会话 id 时只 warn，不抛', () => {
  const ctx = fakeCtx({})
  createTransformLog({ ctx }).record({ sessionId: undefined, layer: 'notice', ruleId: 'r', outcome: 'applied' })
  assert.match(ctx.warns[0], /拿不到会话/)
})

test('会话不在时只 warn，不抛', () => {
  const ctx = fakeCtx({})
  createTransformLog({ ctx }).record({ sessionId: 'gone', layer: 'request', ruleId: 'r', outcome: 'applied' })
  assert.match(ctx.warns[0], /找不到会话/)
})

test('append 失败时只 warn，不抛 —— 记录不该毁掉这次请求', () => {
  const ctx = fakeCtx({ s1: { append: () => { throw new Error('炸了') } } })
  createTransformLog({ ctx }).record({ sessionId: 's1', layer: 'notice', ruleId: 'r', outcome: 'applied' })
  assert.match(ctx.warns[0], /写不进会话日志/)
})
