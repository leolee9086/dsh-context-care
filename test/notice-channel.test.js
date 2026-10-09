import test from 'node:test'
import assert from 'node:assert/strict'
import { createNoticeChannel, NOTICE_CHANNEL } from '../src/notice-channel.js'

test('注册一个源，collect 拿到它产出的通知', async () => {
  const channel = createNoticeChannel()
  channel.register('demo', () => [{ id: 'n1', text: '有话要说' }])
  const out = await channel.collect({ agentId: 'a1', userText: 'x' })
  assert.equal(out.length, 1)
  assert.equal(out[0].text, '有话要说')
  assert.equal(out[0].source, 'demo')
  assert.equal(NOTICE_CHANNEL, 'contextNotices')
})

test('同一个 id 在一个会话里只注入一次，换个会话又能注入', async () => {
  const channel = createNoticeChannel()
  channel.register('demo', () => [{ id: 'n1', text: 'x' }])
  assert.equal((await channel.collect({ agentId: 'a1' })).length, 1)
  assert.equal((await channel.collect({ agentId: 'a1' })).length, 0)
  assert.equal((await channel.collect({ agentId: 'a2' })).length, 1)
})

test('关掉 oncePerSurface 才看冷却', async () => {
  let now = 0
  const channel = createNoticeChannel({ now: () => now })
  channel.register('demo', () => [{ id: 'n1', text: 'x', oncePerSurface: false, cooldownMinutes: 10 }])
  assert.equal((await channel.collect({ agentId: 'a1' })).length, 1)
  now += 60000
  assert.equal((await channel.collect({ agentId: 'a1' })).length, 0)
  now += 10 * 60000
  assert.equal((await channel.collect({ agentId: 'a1' })).length, 1)
})

test('一个源出错不挡住别的源，但留下 warn', async () => {
  const warns = []
  const channel = createNoticeChannel({ warn: message => warns.push(message) })
  channel.register('broken', () => { throw new Error('炸了') })
  channel.register('ok', () => [{ id: 'n1', text: 'x' }])
  const out = await channel.collect({ agentId: 'a1' })
  assert.equal(out.length, 1)
  assert.equal(out[0].source, 'ok')
  assert.match(warns[0], /broken/)
})

test('通知说不清楚就抛错，不猜', async () => {
  const channel = createNoticeChannel()
  channel.register('no-id', () => [{ text: 'x' }])
  await assert.rejects(() => channel.collect({ agentId: 'a1' }), /没有 id/)
  const other = createNoticeChannel()
  other.register('no-text', () => [{ id: 'n', text: '' }])
  await assert.rejects(() => other.collect({ agentId: 'a1' }), /没有 text/)
})

test('源返回非数组时记 warn 并跳过', async () => {
  const warns = []
  const channel = createNoticeChannel({ warn: message => warns.push(message) })
  channel.register('weird', () => 'nope')
  assert.deepEqual(await channel.collect({ agentId: 'a1' }), [])
  assert.match(warns[0], /不是数组/)
})

test('取消注册后不再被问', async () => {
  const channel = createNoticeChannel()
  const off = channel.register('demo', () => [{ id: 'n1', text: 'x' }])
  off()
  assert.deepEqual(await channel.collect({ agentId: 'a1' }), [])
})

test('re-enabling rejects stale or unproven queued notices without consuming their delivery', async () => {
  const warnings = []
  const channel = createNoticeChannel({ warn: text => warnings.push(text) })
  let evidence
  channel.register('queued', context => {
    assert.equal(context.sinceSeq, 42)
    return [{ id: 'same', text: 'pending', ...(evidence === undefined ? {} : { sourceSeqs: evidence }) }]
  })
  const policy = { sinceSeq: () => 42, epoch: () => 'reopened' }
  assert.deepEqual(await channel.collect({ agentId: 'a' }, policy), [])
  assert.match(warnings[0], /sourceSeqs/)
  evidence = [40]
  assert.deepEqual(await channel.collect({ agentId: 'a' }, policy), [])
  evidence = [43]
  assert.equal((await channel.collect({ agentId: 'a' }, policy)).length, 1)
  evidence = [-1]
  await assert.rejects(channel.collect({ agentId: 'a' }, policy), /事件序号/)
})

test('an awaited notification cannot cross an off-on transition', async () => {
  let finish
  let epoch = 0
  const channel = createNoticeChannel()
  channel.register('pending', () => new Promise(resolve => { finish = resolve }))
  const pending = channel.collect({ agentId: 'a' }, { epoch: () => epoch })
  epoch += 2
  finish([{ id: 'same', text: 'old', sourceSeqs: [1] }])
  assert.deepEqual(await pending, [])
})

test('later source waits cannot commit an earlier source after its control edit', async () => {
  let epoch = 0
  let edit = true
  const channel = createNoticeChannel()
  channel.register('first', () => [{ id: 'same', text: 'evidence' }])
  channel.register('later', async () => { await Promise.resolve(); if (edit) epoch++; return [] })
  const policy = { epoch: () => epoch }
  assert.deepEqual(await channel.collect({ agentId: 'a' }, policy), [])
  edit = false
  assert.equal((await channel.collect({ agentId: 'a' }, policy)).length, 1)
})

test('注册参数不对就抛错', () => {
  const channel = createNoticeChannel()
  assert.throws(() => channel.register('', () => []), /要有名字/)
  assert.throws(() => channel.register('x', null), /要是一个函数/)
})
