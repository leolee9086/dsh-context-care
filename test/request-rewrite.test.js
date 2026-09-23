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
  assert.equal(await rewrite({ body: '{"a":1}' }), undefined)
  assert.equal(REWRITER_NAME, 'context-care')
})

test('有 request 级规则时改 body', async () => {
  const rewrite = createRequestRewriter({ rules: () => [requestRule()], onRecord: () => {} })
  assert.equal(await rewrite({ body: '{"a":"secret"}' }), '{"a":"[已隐藏]"}')
})

test('placement 不是 request 的规则不在这一层跑', async () => {
  const rewrite = createRequestRewriter({
    rules: () => [requestRule({ placement: ['user'] })],
    onRecord: () => {},
  })
  assert.equal(await rewrite({ body: 'secret' }), undefined)
})

test('命中会留下记录', async () => {
  const records = []
  const rewrite = createRequestRewriter({ rules: () => [requestRule()], onRecord: record => records.push(record) })
  await rewrite({ body: 'secret' })
  assert.equal(records.length, 1)
  assert.equal(records[0].ruleId, 'scrub')
  assert.equal(records[0].outcome, 'applied')
})

test('规则来源是坏数据时抛错，不静默放过', async () => {
  const rewrite = createRequestRewriter({ rules: () => [{ id: 'broken' }], onRecord: () => {} })
  await assert.rejects(() => rewrite({ body: 'secret' }), /rule source/)
})
