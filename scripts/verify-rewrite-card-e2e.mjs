// 验证改写卡片这条链路的**两侧对接**，而不是字段形状。
//
// 走的路：真实规则改写真实请求体 → 记录真的写进**索引插件的库**（openStore，不是假 store）
// → 从库里读回来 → 客户端 createRewriteDefinition().buildViewNode() 对同一条助手消息
// 算哈希 → 哈希必须命中那条记录，并且片段就是真实差异。
//
// 任何一侧改了字段名、指纹算法或配对方式，这里都会红 —— 这正是原来的字段断言做不到的。
//
// 用法：node scripts/verify-rewrite-card-e2e.mjs
// 索引插件路径可用 DSH_INDEX_PLUGIN 覆盖（默认 D:/dev/SAC_search/dsh-better-session-query）。
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createRequestRewriter } from '../src/request-rewrite.js'
import { createRewriteJournal } from '../src/rewrite-journal.js'
import { createRewriteDefinition, REWRITE_NODE } from '../src/rewrite-view.js'

const INDEX_PLUGIN = process.env.DSH_INDEX_PLUGIN ?? 'D:/dev/SAC_search/dsh-better-session-query'
const { openStore } = await import(pathToFileURL(INDEX_PLUGIN + '/lib/store.js').href)

// 真实的索引插件库（内存），扮演 context-care 认的那个 sessionBlockQuery 服务。
const store = await openStore({ path: ':memory:' })
const journal = createRewriteJournal({ store: () => store, warn: message => console.log('[warn]', message) })

const SESSION = 'session-card-e2e'
const assistantText = '助手输出里带着 SECRET-MARKER 这一段，它应当被规则换掉。'

// ---------------------------------------------------------------- host 侧
const applied = []
const rewrite = createRequestRewriter({
  rules: () => [{
    id: 'scrub-marker', order: 1, placement: ['request'],
    when: { findRegex: '/SECRET-MARKER/g', replaceString: 'REDACTED' },
    action: { kind: 'transform' },
    budget: { maxCacheLoss: 1 },
  }],
  onRecord: record => applied.push(record),
  journal,
})

const body = JSON.stringify({
  messages: [
    { role: 'user', content: '随便一句' },
    { role: 'assistant', content: [{ type: 'text', text: assistantText }] },
  ],
})

const rewritten = await rewrite({ body, url: 'https://example.test/chat/completions', scope: { sessionId: SESSION } })
assert.ok(typeof rewritten === 'string', '规则应当改了请求体')
assert.match(rewritten, /REDACTED/)
assert.ok(applied.some(record => record.outcome === 'applied'), '引擎应当记下规则生效')

// 记录真的落进了索引插件的属性表 —— 直接问库，不看 journal 的内存副本。
const stored = await store.listAttributes({ namespace: 'context-care', name: 'request-rewrite', sessionId: SESSION })
assert.equal(stored.length, 1, `索引插件的库里应当恰好有一条改写记录，实际 ${stored.length}`)
const record = stored[0].value
assert.equal(record.pattern, 'scrub-marker')
// 片段是真实差异算出来的，不是写死的字符串。
assert.equal(record.removed, 'SECRET-MARKER')
assert.equal(record.added, 'REDACTED')
assert.equal(record.charsBefore, assistantText.length)
console.log('真实改写已落进索引插件的属性表，并带着真实的改动片段')

// ---------------------------------------------------------------- client 侧
const definition = createRewriteDefinition()
const location = { kind: 'session' }
const nodeFor = (seq, text) => {
  const event = { type: 'assistant/message', seq, data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } }
  const match = definition.match(event)
  assert.deepEqual(match, { id: 'rewrite:' + seq, role: 'start' })
  const start = { event, role: 'start', location }
  return definition.buildViewNode({
    key: REWRITE_NODE, kind: REWRITE_NODE, id: match.id,
    matches: [], current: new Map(), start, state: definition.start({}, start),
  })
}

// 卡片渲染时查的就是这张表：sessionId + ':' + hash。
const rows = await journal.list({})
const table = new Map(rows.map(row => [row.sessionId + ':' + row.hash, row]))

const node = nodeFor(42, assistantText)
assert.ok(node !== null, '节点应当为这条助手消息产出')
const hits = node.data.hashes.map(hash => table.get(SESSION + ':' + hash)).filter(hit => hit !== undefined)
assert.equal(hits.length, 1, `卡片应当命中恰好一条记录，实际 ${hits.length}`)
assert.equal(hits[0].removed, 'SECRET-MARKER')
assert.equal(hits[0].added, 'REDACTED')
console.log('客户端节点产出的哈希命中了索引插件里的那条记录')

// 没被改过的消息不该长出卡片。
const cleanNode = nodeFor(43, '这段没被改过')
const cleanHits = cleanNode.data.hashes.map(hash => table.get(SESSION + ':' + hash)).filter(hit => hit !== undefined)
assert.equal(cleanHits.length, 0, '没被改写过的消息不该匹配到记录')
console.log('未被改写的消息不会命中任何记录')

console.log('改写卡片端到端：host 落库与 client 匹配两侧对接正常')
