import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestRewriter, REWRITER_NAME } from '../src/request-rewrite.js'

/** 一条 request 级的 transform 规则。 */
function requestRule(overrides = {}) {
  return {
    id: 'scrub', order: 1, placement: ['request'], action: { kind: 'transform' },
    when: { findRegex: '/secret/', replaceString: '[已隐藏]' },
    budget: { maxCacheLoss: 1 },
    ...overrides,
  }
}

test('没有 request 级规则时不改 body', async () => {
  const rewrite = createRequestRewriter({ rules: () => [], onRecord: () => {} })
  assert.equal(await rewrite({ body: '{"a":1}', url: 'https://api.example.com/v1/chat' }), undefined)
  assert.equal(REWRITER_NAME, 'context-care')
})

test('有 request 级规则时改 body', async () => {
  const rewrite = createRequestRewriter({ rules: () => [requestRule()], onRecord: () => {} })
  assert.equal(await rewrite({ body: '{"a":"secret"}', url: 'https://api.example.com/v1/chat' }), '{"a":"[已隐藏]"}')
})

test('placement 不是 request 的规则不在这一层跑', async () => {
  const rewrite = createRequestRewriter({
    rules: () => [requestRule({ placement: ['user'] })],
    onRecord: () => {},
  })
  assert.equal(await rewrite({ body: 'secret', url: 'https://api.example.com/v1/chat' }), undefined)
})

test('命中会留下记录', async () => {
  const records = []
  const rewrite = createRequestRewriter({ rules: () => [requestRule()], onRecord: record => records.push(record) })
  await rewrite({ body: 'secret', url: 'https://api.example.com/v1/chat' })
  assert.equal(records.length, 1)
  assert.equal(records[0].ruleId, 'scrub')
  assert.equal(records[0].outcome, 'applied')
})

test('规则来源是坏数据时抛错，不静默放过', async () => {
  const rewrite = createRequestRewriter({ rules: () => [{ id: 'broken' }], onRecord: () => {} })
  await assert.rejects(() => rewrite({ body: 'secret', url: 'https://api.example.com/v1/chat' }), /rule source/)
})

test('规则第一次生效时费一次缓存，之后不再费', async () => {
  // 缓存只跟上一次同接口的请求比。
  // 规则刚生效那一次:上一条是没改过的原文,前缀在改动处断掉,所以要花缓存;
  // 从那以后:上一条已经是改过的文本,前缀对得上,不再花。
  const records = []
  let active = false
  const rewrite = createRequestRewriter({
    rules: () => (active ? [requestRule()] : []),
    onRecord: record => records.push(record),
  })
  const url = 'https://api.example.com/v1/chat'
  // 规则还没生效,原文发出去 —— 没有上一次可比,不算废缓存。
  await rewrite({ body: 'secret', url })
  assert.equal(records.length, 0)

  active = true
  await rewrite({ body: 'secret', url })
  assert.equal(records[0].loss, 1)

  await rewrite({ body: 'secret', url })
  assert.equal(records[1].loss, 0)
})

test('不同接口各记各的上一次', async () => {
  const records = []
  let active = false
  const rewrite = createRequestRewriter({
    rules: () => (active ? [requestRule()] : []),
    onRecord: record => records.push(record),
  })
  await rewrite({ body: 'secret', url: 'https://a.example.com/v1/chat' })
  await rewrite({ body: 'secret', url: 'https://b.example.com/v1/chat' })

  active = true
  // 两个接口各自的上一次都还是原文,所以两边都要花一次。
  await rewrite({ body: 'secret', url: 'https://a.example.com/v1/chat' })
  await rewrite({ body: 'secret', url: 'https://b.example.com/v1/chat' })
  assert.equal(records[0].loss, 1)
  assert.equal(records[1].loss, 1)
})
