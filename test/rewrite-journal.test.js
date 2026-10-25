import test from 'node:test'
import assert from 'node:assert/strict'
import { contentHash, changedBlocks, createRewriteJournal, NAMESPACE, REWRITE_NAME } from '../src/rewrite-journal.js'
import { contentHash as clientContentHash } from '../src/rewrite-view.js'
import { createSessionCache } from '../lib/session-cache.js'
import { rewriteCut, rewriteSnapshot } from '../lib/rewrite-feed.js'

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

test('Host-owned rewrite records survive reconstruction without an optional index plugin', async () => {
  const stored = []
  const durable = { async put(value) { stored.push(JSON.parse(JSON.stringify(value))) }, async list(sessionId) { return stored.filter(row => sessionId === undefined || row.sessionId === sessionId) } }
  const create = () => createRewriteJournal({ store: () => undefined, durable })
  assert.equal((await create().record({ sessionId: 'one', hash: 'stable', pattern: 'loop', charsBefore: 50, charsAfter: 20 })).persisted, true)
  assert.equal((await create().list({ sessionId: 'one' }))[0].hash, 'stable')
  assert.deepEqual(await create().list({ sessionId: 'two' }), [])
  const failed = createRewriteJournal({ store: () => undefined, durable: { put: async () => { throw new Error('Host journal failure') }, list: durable.list } })
  await assert.rejects(failed.record({ sessionId: 'one', hash: 'fail' }), /Host journal failure/)
  assert.doesNotMatch(JSON.stringify(await failed.list({ sessionId: 'one' })), /"fail"/)
})

test('pending rewrite ACKs are hidden and backend rows are constrained to the requested session', async () => {
  let acknowledge
  const mixed = [{ sessionId: 'one', hash: 'stored' }, { sessionId: 'two', hash: 'private' }]
  const journal = createRewriteJournal({ store: () => undefined, durable: {
    put: () => new Promise(resolve => { acknowledge = resolve }), list: async () => mixed } })
  const writing = journal.record({ sessionId: 'one', hash: 'pending' })
  assert.deepEqual((await journal.list({ sessionId: 'one' })).map(row => row.hash), ['stored'])
  acknowledge(); await writing
  assert.deepEqual(new Set((await journal.list({ sessionId: 'one' })).map(row => row.hash)), new Set(['stored', 'pending']))
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

test('内部诊断支持列出全部会话，指定 sessionId 时约束结果', async () => {
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

test('managed rewrite reads preserve legacy precedence, concurrent reads, removals and failed writes', async () => {
  const cache = createSessionCache(), owner = {}, sessionId = 'one'
  const durableRows = [{ sessionId, hash: 'same', at: 2, pattern: 'native' }]
  let stored = [{ sessionId, value: { hash: 'same', at: 2, pattern: 'legacy-tie' } },
    { sessionId, value: { hash: 'external', at: 1 } }]
  let reads = 0, failWrite = false
  const journal = createRewriteJournal({ logs: { cache }, owner: () => owner,
    store: () => ({ async listAttributes(query) { reads++; assert.equal(query.sessionId, sessionId); return stored } }),
    durable: { list: async () => durableRows, put: async () => { if (failWrite) throw new Error('rejected-rewrite') } } })
  const [one, two] = await Promise.all([journal.view(sessionId), journal.view(sessionId)])
  assert.equal(one, two); assert.equal(reads, 1)
  const cursor = {}, initial = rewriteCut(one).feed.consume(cursor)
  assert.equal(initial.added.find(row => row.hash === 'same').pattern, 'native')
  const old = await journal.list({ sessionId })
  assert.equal(rewriteSnapshot(one), rewriteSnapshot(two), 'first readers share the full wire cut')
  stored = [{ sessionId, value: { hash: 'same', at: 3, pattern: 'new-external' } },
    { sessionId: 'private', value: { hash: 'private', at: 20 } }]
  const after = await journal.view(sessionId), delta = rewriteCut(after).feed.consume(cursor)
  assert.deepEqual(delta.added.map(row => row.hash), ['same']); assert.equal(delta.removed.length, 2)
  assert.equal(delta.added[0].pattern, 'new-external'); assert.equal(old.length, 2)
  await journal.record({ sessionId, hash: 'same', at: 4, pattern: 'local' })
  assert.equal((await journal.list({ sessionId }))[0].pattern, 'local')
  failWrite = true
  await assert.rejects(journal.record({ sessionId, hash: 'rejected' }), /rejected-rewrite/)
  assert.equal((await journal.list({ sessionId })).some(row => row.hash === 'rejected'), false)
  journal.close(); assert.equal(cache.report().some(row => row.name.startsWith('rewrite-')), false); cache.close()
})

test('managed rewrite failure discards partially advanced cursors and retries all selected facts', async () => {
  const cache = createSessionCache(), owner = {}, sessionId = 'one'
  let rows = [{ sessionId, hash: 'first', at: 1 }], invalid = true
  const journal = createRewriteJournal({ logs: { cache }, owner: () => owner, store: () => undefined,
    durable: { put: async () => {}, list: async () => invalid ? [...rows, { sessionId, hash: 'bad', at: 2, extra: () => {} }] : rows } })
  // JSON intentionally excludes functions; invalid JSON numbers are normalized too.
  const cold = await journal.view(sessionId), cursor = {}; rewriteCut(cold).feed.consume(cursor)
  rows = [...rows, { sessionId, hash: 'later', at: 3 }]
  const circular = { sessionId, hash: 'circular' }; circular.self = circular
  rows.push(circular); invalid = false
  await assert.rejects(journal.view(sessionId), /circular/i)
  rows.pop()
  const rebuilt = await journal.view(sessionId)
  assert.notEqual(rewriteCut(rebuilt).feed, rewriteCut(cold).feed)
  assert.deepEqual(rewriteSnapshot(rebuilt).map(row => row.hash), ['later', 'first'])
  journal.close(); cache.close()
})

test('managed rewrite explicit lists retain durable, index and local tie ordering', async () => {
  const cache = createSessionCache(), owner = {}, sessionId = 'one'
  const journal = createRewriteJournal({ logs: { cache }, owner: () => owner,
    store: () => ({ listAttributes: async () => [{ sessionId, value: { hash: 'index', at: 1 } }] }),
    durable: { put: async () => {}, list: async () => [{ sessionId, hash: 'durable', at: 1 }] } })
  await journal.record({ sessionId, hash: 'local', at: 1 })
  assert.deepEqual((await journal.list({ sessionId })).map(row => row.hash), ['durable', 'index', 'local'])
  journal.close(); cache.close()
})

test('managed rewrite close rejects pending reads and writes without resurrecting cache owners', async () => {
  const cache = createSessionCache(), owner = {}; let releaseRead, releaseWrite
  const journal = createRewriteJournal({ logs: { cache }, owner: () => owner, store: () => undefined,
    durable: { list: () => new Promise(resolve => { releaseRead = resolve }), put: () => new Promise(resolve => { releaseWrite = resolve }) } })
  const reading = journal.view('one'), writing = journal.record({ sessionId: 'one', hash: 'pending' })
  const rejectedRead = assert.rejects(reading, /journal closed/), rejectedWrite = assert.rejects(writing, /journal closed/)
  journal.close(); releaseRead([]); releaseWrite()
  await Promise.all([rejectedRead, rejectedWrite])
  assert.equal(cache.report().length, 0); await assert.rejects(journal.list({ sessionId: 'one' }), /journal closed/)
  cache.close()
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
