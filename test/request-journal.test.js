import test from 'node:test'
import assert from 'node:assert/strict'
import { openRequestJournal, requestFingerprint, REQUEST_JOURNAL_DOMAIN } from '../src/request-journal.js'

function domain(write) {
  const records = new Map()
  return { records, open: async spec => {
    assert.equal(spec.name, REQUEST_JOURNAL_DOMAIN.name)
    return { table: () => ({ entries: () => records.entries(), put: async (key, value) => {
      await write?.(key, value)
      records.set(key, REQUEST_JOURNAL_DOMAIN.tables.records.valueSchema.parse(value))
    } }), close: async () => {} }
  } }
}

test('request journal detaches queued data and serializes phases through durable acknowledgement', async () => {
  let unblock
  const blocked = new Promise(resolve => { unblock = resolve })
  const order = []
  const store = domain(async (key, value) => { if (value.data.phase === 'ready') await blocked; order.push(value.data.phase) })
  const journal = await openRequestJournal({ storageDomain: store, now: () => 100 })
  const data = { phase: 'ready', route: { provider: 'actual', model: 'bound' }, budget: { hardInput: 500 } }
  const first = journal.put('call_one', 's1', 'request', data)
  data.route.model = 'later mutation'
  const second = journal.put('call_one', 's1', 'request', { phase: 'dispatched' })
  await Promise.resolve()
  assert.equal(store.records.size, 0)
  unblock()
  await first
  assert.equal(store.records.get('call_one').data.route.model, 'bound')
  await second
  await journal.flush('s1')
  assert.deepEqual(order, ['ready', 'dispatched'])
  assert.equal(journal.list('s2').length, 0)
  assert.equal(journal.list('s1')[0].data.phase, 'dispatched')
  assert.notEqual(requestFingerprint({ messages: ['a'] }), requestFingerprint({ messages: ['b'] }))
  await journal.close()
})

test('request journal exposes original write failure through put, flush and disposal', async () => {
  const failure = new Error('original durable write failure')
  const reports = []
  const journal = await openRequestJournal({ storageDomain: domain(async () => { throw failure }), report: error => reports.push(error) })
  await assert.rejects(journal.put('call_one', 's1', 'request', { phase: 'ready' }), error => error === failure)
  await assert.rejects(journal.flush('s1'), error => error === failure)
  await assert.rejects(journal.close(), error => error === failure)
  assert.equal(reports[0], failure)
})
