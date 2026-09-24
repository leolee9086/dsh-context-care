import test from 'node:test'
import assert from 'node:assert/strict'
import { contentHash, changedBlocks, createRewriteJournal, NAMESPACE, REWRITE_NAME } from '../src/rewrite-journal.js'
import { contentHash as clientContentHash } from '../src/rewrite-view.js'

test('Host 与客户端的哈希实现必须一致 —— 不一致卡片就永远不出现', () => {
  const samples = [
    '',
    'hello',
    '做。\n做。\n做。',
    '中文、标点。和 emoji 🌱 混在一起',
    'a'.repeat(1000),
    JSON.stringify({ role: 'assistant', content: [{ type: 'reasoning', text: '循环' }] }),
  ]
  for (const sample of samples) {
    assert.equal(contentHash(sample), clientContentHash(sample), `哈希不一致: ${sample.slice(0, 30)}`)
  }
})

test('哈希稳定且定长', () => {
  assert.equal(contentHash('同一个输入'), contentHash('同一个输入'))
  assert.notEqual(contentHash('甲'), contentHash('乙'))
  assert.equal(contentHash('x').length, 8)
  assert.match(contentHash('x'), /^[0-9a-f]{8}$/)
})

test('changedBlocks 只报真的变了的块', () => {
  const before = [
    { role: 'user', content: [{ type: 'text', text: '问' }] },
    { role: 'assistant', content: [
      { type: 'reasoning', text: '想了一大段' },
      { type: 'text', text: '答' },
    ] },
  ]
  const after = [
    { role: 'user', content: [{ type: 'text', text: '问' }] },
    { role: 'assistant', content: [
      { type: 'reasoning', text: '想了一大段' },
      { type: 'text', text: '答(清理过)' },
    ] },
  ]
  const changed = changedBlocks(before, after)
  assert.equal(changed.length, 1)
  assert.equal(changed[0].hash, contentHash('答'))
  assert.equal(changed[0].charsBefore, 1)
  assert.equal(changed[0].charsAfter, 6)
})

test('没有变化时不报任何块', () => {
  const messages = [{ role: 'assistant', content: [{ type: 'text', text: '一样' }] }]
  assert.deepEqual(changedBlocks(messages, messages), [])
})

test('进程内记录:写进去能读出来', async () => {
  const journal = createRewriteJournal({ store: () => undefined })
  const result = await journal.record({
    sessionId: 's1', hash: 'abcd1234', pattern: 'line-repeat',
    removedLines: 12, charsBefore: 300, charsAfter: 20,
  })
  assert.equal(result.persisted, false)
  const rows = await journal.list({ sessionId: 's1' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].hash, 'abcd1234')
  assert.equal(rows[0].pattern, 'line-repeat')
  assert.equal(rows[0].removedLines, 12)
})

test('不带 sessionId 时列出所有会话 —— 客户端不知道自己在哪个会话里', async () => {
  const journal = createRewriteJournal({ store: () => undefined })
  await journal.record({ sessionId: 's1', hash: 'h1', pattern: 'p', removedLines: 1, charsBefore: 2, charsAfter: 1 })
  await journal.record({ sessionId: 's2', hash: 'h2', pattern: 'p', removedLines: 1, charsBefore: 2, charsAfter: 1 })
  assert.equal((await journal.list({})).length, 2)
  assert.equal((await journal.list({ sessionId: 's1' })).length, 1)
})

test('索引服务在时落属性表,并把持久结果报回来', async () => {
  const written = []
  const store = { putAttribute: async entry => { written.push(entry); return 'id-1' } }
  const journal = createRewriteJournal({ store: () => store })
  const result = await journal.record({
    sessionId: 's1', hash: 'h9', pattern: 'filler-lines',
    removedLines: 3, charsBefore: 50, charsAfter: 10,
  })
  assert.equal(result.persisted, true)
  assert.equal(written.length, 1)
  assert.equal(written[0].namespace, NAMESPACE)
  assert.equal(written[0].name, REWRITE_NAME)
  assert.equal(written[0].origin, 'plugin')
  assert.equal(written[0].visibility, 'user')
  assert.equal(written[0].value.hash, 'h9')
})

test('属性表写不进去时退到进程内,且不抛', async () => {
  const warns = []
  const store = { putAttribute: async () => { throw new Error('库炸了') } }
  const journal = createRewriteJournal({ store: () => store, warn: message => warns.push(message) })
  const result = await journal.record({
    sessionId: 's1', hash: 'h7', pattern: 'p', removedLines: 1, charsBefore: 2, charsAfter: 1,
  })
  assert.equal(result.persisted, false)
  assert.equal(warns.length, 1)
  assert.match(warns[0], /只留在进程内/)
  // 记录还在,读得到。
  assert.equal((await journal.list({ sessionId: 's1' })).length, 1)
})

test('属性表与进程内合并去重', async () => {
  const store = {
    putAttribute: async () => 'id',
    // 属性表里的 value 自带 sessionId（record 写入时就带），去重键靠它拼；
    // 漏了它两条同哈希的记录会被当成不同会话，去重就形同虚设。
    listAttributes: async () => [
      { sessionId: 's1', value: { sessionId: 's1', hash: 'same', pattern: 'p', removedLines: 1, charsBefore: 2, charsAfter: 1, at: 1 } },
      { sessionId: 's1', value: { sessionId: 's1', hash: 'only-stored', pattern: 'p', removedLines: 1, charsBefore: 2, charsAfter: 1, at: 2 } },
    ],
  }
  const journal = createRewriteJournal({ store: () => store })
  await journal.record({ sessionId: 's1', hash: 'same', pattern: 'p', removedLines: 1, charsBefore: 2, charsAfter: 1, at: 3 })
  const rows = await journal.list({ sessionId: 's1' })
  assert.equal(rows.length, 2)
  // 新的在前。
  assert.equal(rows[0].hash, 'same')
})
