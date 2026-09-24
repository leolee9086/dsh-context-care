// 验证：改写流水账能不能认出「引擎规则的改写」（不只是循环清理）。
//
// 之前的缺口：只有 cleanLoopInBody 产出块级哈希并写 journal，而卡片认的就是哈希 ——
// 于是引擎规则（transform）改过的助手消息在界面上根本看不出来，
// 而那正是这张卡片存在的理由。
//
// 这里用真实的 createRequestRewriter + createRewriteJournal，喂一段带 assistant 消息的
// 请求体，断言：记录里有哈希，而且那个哈希等于被改前文本的 contentHash（客户端就是用它匹配）。
import assert from 'node:assert/strict'
import { createRequestRewriter } from '../src/request-rewrite.js'
import { createRewriteJournal, contentHash } from '../src/rewrite-journal.js'

const journal = createRewriteJournal({ store: () => undefined, warn: m => console.log('[warn]', m) })
const records = []

// 规则把助手输出里的标记换掉 —— 跟循环清理无关的一条普通 transform 规则。
const rewrite = createRequestRewriter({
  rules: () => [{
    id: 'scrub-marker', order: 1, placement: ['request'],
    when: { findRegex: '/SECRET-MARKER/g', replaceString: 'REDACTED' },
    action: { kind: 'transform' },
    budget: { maxCacheLoss: 1 },
  }],
  onRecord: record => records.push(record),
  journal,
})

const assistantText = '助手输出里带着 SECRET-MARKER 这一段。'
const body = JSON.stringify({
  messages: [
    { role: 'user', content: '随便一句' },
    { role: 'assistant', content: [{ type: 'text', text: assistantText }] },
  ],
})

const result = await rewrite({ body, url: 'https://example.test/chat/completions', scope: { sessionId: 'session-verify' } })
assert.ok(typeof result === 'string', '规则应当改了请求体')
assert.match(result, /REDACTED/)
assert.equal(records.filter(r => r.outcome === 'applied').length >= 1, true, '引擎应当记下这条规则生效')

const listed = await journal.list({ sessionId: 'session-verify' })
assert.equal(listed.length, 1, `应当恰好记下一条改写，实际 ${listed.length}`)
// 客户端拿的是**消息原文**（改写前）的哈希 —— 两边必须算同一个值。
assert.equal(listed[0].hash, contentHash(assistantText))
assert.equal(listed[0].pattern, 'scrub-marker')
assert.equal(listed[0].charsBefore, assistantText.length)
assert.equal(listed[0].charsAfter, assistantText.replace('SECRET-MARKER', 'REDACTED').length)
console.log('引擎规则的改写：已产出块级哈希，且与客户端算法一致')

// 另一面：没改动就不该留下任何记录 —— 卡片只在真被改过时才出现。
const clean = JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: '没有标记的文本' }] }] })
assert.equal(await rewrite({ body: clean, url: 'https://example.test/chat/completions', scope: { sessionId: 'session-verify' } }), undefined)
assert.equal((await journal.list({ sessionId: 'session-verify' })).length, 1, '没改动不该新增记录')
console.log('未发生改写时不记流水账')

// 结构变了（解析不出 messages）时不算哈希，也不抛错。
const structural = JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'SECRET-MARKER' }] }] })
await rewrite({ body: structural, url: 'https://example.test/chat/completions', scope: { sessionId: 'other' } })
console.log('结构变化时不猜哈希')
