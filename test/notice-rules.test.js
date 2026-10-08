import test from 'node:test'
import assert from 'node:assert/strict'
import { installNoticeRules } from '../src/notice-rules.js'

/** 一个够用的假 ctx：这条路径只需要 logger 和 get。 */
function fakeCtx(services = {}) {
  const warns = []
  return {
    warns,
    logger: { warn: message => warns.push(message) },
    get: name => services[name],
  }
}

function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** 和 dsh-better-session-query 声明的「记住」规则同形。 */
const REMEMBER_RULE = {
  id: 'memory-remember-request',
  order: 10,
  placement: ['user'],
  when: { said: '/记住|记一下/' },
  action: {
    kind: 'notify',
    by: 'context-care',
    say: '用户说了「记住」，用 session_blocks_remember 写下来。',
  },
  cooldownMinutes: 5,
  oncePerSurface: true,
}

test('命中提示规则时注入一条提醒', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [REMEMBER_RULE] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  const messages = rules.collect({ agent: { id: 'a1' }, messages: [userMessage('记住：我在长沙')] })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].content[0].text, REMEMBER_RULE.action.say)
  assert.equal(messages[0].source.kind, 'plugin:dsh-context-care:rules:memory-remember-request')
  assert.equal(messages[0].source.form, 'notice')
  assert.equal(messages[0].source.plugin, undefined)
  const trace = messages[0].source.contextCareTrace
  assert.equal(trace.userText, '记住：我在长沙')
  assert.equal(trace.evaluation.outcome, 'applied')
  assert.deepEqual(trace.rule, REMEMBER_RULE)
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), messages[0])
})

test('通知关联相同评估编号并只引用实际输入的持久事件', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [REMEMBER_RULE] })
  const captured = []
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care', onHit: record => captured.push(record) })
  const events = [{ seq: 10, type: 'user/message', data: { id: 'current' } }, { seq: 11, type: 'assistant/message' }]
  const agent = { id: 'a', session: { id: 'a', snapshotEvents: () => events } }
  const injected = rules.collect({ agent, messages: [{ ...userMessage('记住：原始输入'), id: 'current' }], facts: { fatigue: 85 } })
  const trace = injected[0].source.contextCareTrace
  assert.equal(trace.evaluationId, captured[0].evaluationId)
  assert.deepEqual(trace.sourceSeqs, [10, 11])
  assert.deepEqual(captured[0].facts, { fatigue: 85 })
  const later = rules.collect({ agent: { ...agent, id: 'other' }, messages: [{ ...userMessage('记住：尚未入日志'), id: 'pending' }] })
  assert.deepEqual(later[0].source.contextCareTrace.sourceSeqs, [11], '不能用上一条输入冒充尚未落盘的本次输入')
})

test('没命中就不注入', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [REMEMBER_RULE] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  assert.deepEqual(rules.collect({ agent: { id: 'a1' }, messages: [userMessage('今天天气不错')] }), [])
})

test('没装索引插件时什么都不做，也不报错', () => {
  const ctx = fakeCtx({})
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  assert.deepEqual(rules.collect({ agent: { id: 'a1' }, messages: [userMessage('记住：我在长沙')] }), [])
  assert.deepEqual(ctx.warns, [])
})

test('同一段用户输入只提醒一次', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [REMEMBER_RULE] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  const messages = [userMessage('记住：我在长沙')]
  assert.equal(rules.collect({ agent: { id: 'a1' }, messages }).length, 1)
  assert.equal(rules.collect({ agent: { id: 'a1' }, messages }).length, 0)
  // 没生效的那次也留下记录，不是静默。
  assert.equal(ctx.warns.length, 1)
  assert.match(ctx.warns[0], /duplicate/)
})

test('冷却期内换一段输入也不提醒（冷却管时间）', () => {
  const cooling = { ...REMEMBER_RULE, cooldownMinutes: 5 }
  const ctx = fakeCtx({ memoryNoticeRules: [cooling] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  assert.equal(rules.collect({ agent: { id: 'a1' }, messages: [userMessage('记住：我在长沙')] }).length, 1)
  // 内容不同，去重拦不住，但冷却拦得住。
  assert.equal(rules.collect({ agent: { id: 'a1' }, messages: [userMessage('记住：我喜欢吃白饭')] }).length, 0)
  assert.match(ctx.warns[0], /cooldown/)
})

test('冷却和去重都是按会话算的，会话之间互不影响', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [REMEMBER_RULE] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  const messages = [userMessage('记住：我在长沙')]
  assert.equal(rules.collect({ agent: { id: 'a1' }, messages }).length, 1)
  assert.equal(rules.collect({ agent: { id: 'a2' }, messages }).length, 1)
})

test('没有真人说话的边界不判', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [REMEMBER_RULE] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  assert.deepEqual(rules.collect({ agent: { id: 'a1' }, messages: [] }), [])
})

test('规则没说清楚要提醒什么就抛错，不静默跳过', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [{ ...REMEMBER_RULE, action: { kind: 'notify', by: 'context-care' } }] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  assert.throws(() => rules.collect({ agent: { id: 'a1' }, messages: [userMessage('记住：我在长沙')] }), /action\.say/)
})

test('规则是坏数据时抛错，并指出是哪个来源', () => {
  const ctx = fakeCtx({ memoryNoticeRules: [{ id: 'broken' }] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  assert.throws(() => rules.collect({ agent: { id: 'a1' }, messages: [userMessage('记住：我在长沙')] }), /rule source/)
})

test('规则里指名别的消费者时不落到本插件，也不报错', () => {
  const other = { ...REMEMBER_RULE, id: 'other', action: { ...REMEMBER_RULE.action, by: 'some-other-plugin' } }
  const ctx = fakeCtx({ memoryNoticeRules: [other] })
  const rules = installNoticeRules(ctx, { plugin: 'dsh-context-care' })
  assert.deepEqual(rules.collect({ agent: { id: 'a1' }, messages: [userMessage('记住：我在长沙')] }), [])
  assert.match(ctx.warns[0], /no-consumer/)
})
