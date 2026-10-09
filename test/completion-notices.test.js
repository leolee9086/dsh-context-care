import test from 'node:test'
import assert from 'node:assert/strict'
import { openCompletionNotices } from '../src/completion-notices.js'

const session = { id: 's' }
const route = { provider: 'p', model: 'm' }
function storage() {
  const tables = new Map()
  return { open: async () => ({ table(name) {
    if (!tables.has(name)) tables.set(name, new Map())
    const records = tables.get(name)
    return { entries: () => records.entries(), get: key => records.get(key), put: async (key, value) => records.set(key, value) }
  }, close: async () => {} }) }
}

test('a natural dispatch consumes the newest completion notice and supersedes older ones', async () => {
  const outbox = await openCompletionNotices(storage())
  await outbox.publish(session, 8, route, { label: '完成了', line: '任务完成了。' }, 2)
  await outbox.publish(session, 2, route, { label: 'DONE', line: 'DONE' }, 2)
  const segments = outbox.collect(session, route)
  assert.deepEqual(segments[0].sourceSeqs, [8])
  assert.equal(outbox.collect(session, { ...route, purpose: 'compaction' }).length, 0)
  assert.equal(outbox.collect(session, { ...route, model: 'another' }).length, 0)
  await outbox.reserve(session, segments, 'natural')
  await outbox.dispatched(session, segments, 'natural', route)
  assert.equal(outbox.collect(session, route).length, 0)
  assert.deepEqual(outbox.list().map(value => value.status), ['dispatched', 'superseded'])
  await outbox.close()
})

test('known unstarted completion handoff restores the prior unknown allowance and cannot undo a sent notice', async () => {
  const outbox = await openCompletionNotices(storage())
  await outbox.publish(session, 2, route, { label: 'DONE', line: 'DONE' }, 3)
  const segments = outbox.collect(session, route)
  await outbox.reserve(session, segments, 'older-unknown')
  const previous = structuredClone(outbox.list())
  await outbox.reserve(session, segments, 'known-unstarted')
  await outbox.rollback(session, 'known-unstarted')
  await outbox.rollback(session, 'known-unstarted')
  assert.deepEqual(outbox.list(), previous)
  await outbox.reserve(session, segments, 'sent')
  await outbox.dispatched(session, segments, 'sent', route)
  await outbox.rollback(session, 'sent')
  assert.equal(outbox.list()[0].status, 'dispatched')
  await outbox.close()
})

test('an unknown completion delivery retains its id after restart, with a bounded allowance', async () => {
  const store = storage()
  let outbox = await openCompletionNotices(store)
  await outbox.publish(session, 2, route, { label: 'DONE', line: 'DONE' }, 1)
  const segments = outbox.collect(session, route)
  await outbox.reserve(session, segments, 'unknown')
  await outbox.mark(session, 2)
  await outbox.close()
  outbox = await openCompletionNotices(store)
  assert.equal(outbox.seen(session, 2), true)
  assert.equal(outbox.collect(session, route).length, 0)
  assert.equal(outbox.list()[0].status, 'delivery-unknown')
  await outbox.publish(session, 3, route, { label: 'completed', line: 'completed' }, 1)
  assert.deepEqual(outbox.collect(session, route)[0].sourceSeqs, [3])
  await outbox.close()
})
