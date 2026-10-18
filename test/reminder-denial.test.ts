import test from 'node:test'
import assert from 'node:assert/strict'
import { createDenialTickets } from '../lib/reminder-runtime/denial.js'

const verdict = { sourceId: 's', ruleId: 'r', reason: '不得删除文件' }
const tickets = (now = () => 1000) => createDenialTickets(50, now)

test('只有评估完成且未命中的票据才授权执行', () => {
  const api = tickets()
  const clean = {}, denied = {}, unfinished = {}
  api.record(clean, undefined, true)
  api.record(denied, verdict, true)
  // A round cut short before finishing cannot authorize: an unfinished check is not permission.
  api.record(unfinished, undefined, false)
  assert.deepEqual(api.decide(clean, 1000), { kind: 'allow' })
  assert.deepEqual(api.decide(denied, 1000), { kind: 'deny', reason: '不得删除文件' })
  assert.equal(api.decide(unfinished, 1000).kind, 'deny')
})

test('缺少或过期票据都拒绝，不因为没记录就放行', () => {
  const api = tickets()
  assert.equal(api.decide({}, 1000).kind, 'deny')
  const stale = {}
  api.record(stale, undefined, true)
  // TTL is 50ms; a guard reached after that cannot rely on the evaluation.
  assert.equal(api.decide(stale, 1050).kind, 'deny')
  assert.deepEqual(api.decide(stale, 1049), { kind: 'allow' })
})

test('票据按执行令牌区分，调用ID重用不会继承他人结论', () => {
  const api = tickets()
  const first = {}
  api.record(first, undefined, true)
  // The second call has its own token and was never evaluated.
  assert.equal(api.decide({}, 1000).kind, 'deny')
  assert.deepEqual(api.decide(first, 1000), { kind: 'allow' })
})

test('政策变更后旧票据立即失效，已结算的票据不再生效', () => {
  const api = tickets()
  const allowed = {}
  api.record(allowed, undefined, true)
  api.revoke()
  assert.equal(api.decide(allowed, 1000).kind, 'deny')
  // A revoked registry must not accept new evaluations either.
  const late = {}
  api.record(late, undefined, true)
  assert.equal(api.decide(late, 1000).kind, 'deny')
  const fresh = tickets()
  const settled = {}
  fresh.record(settled, undefined, true)
  fresh.settle(settled)
  assert.equal(fresh.decide(settled, 1000).kind, 'deny')
})
