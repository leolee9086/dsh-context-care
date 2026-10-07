import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaintenanceOperations } from '../src/maintenance-operations.js'

function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('a complete maintenance operation serializes by Session while other sessions keep progressing', async () => {
  const operations = createMaintenanceOperations()
  const session = {}
  const gate = deferred()
  const entered = deferred()
  const order = []
  const first = operations.run(session, new AbortController().signal, async () => { order.push('prune'); entered.resolve(); await gate.promise; order.push('summary'); throw new Error('first failed') })
  const rejected = assert.rejects(first, /first failed/)
  await entered.promise
  const second = operations.run(session, new AbortController().signal, async () => { order.push('deep'); return 2 })
  assert.equal(await operations.run({}, new AbortController().signal, async () => 3), 3)
  assert.deepEqual(order, ['prune'])
  gate.resolve()
  await rejected
  assert.equal(await second, 2)
  assert.deepEqual(order, ['prune', 'summary', 'deep'])
  await operations.dispose()
})

test('unload cancels active work, prevents queued execution and waits for cancellation cleanup', async () => {
  const operations = createMaintenanceOperations()
  const session = {}
  const entered = deferred()
  const cleanup = deferred()
  let queued = false
  const first = operations.run(session, new AbortController().signal, async signal => {
    entered.resolve()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    await cleanup.promise
    signal.throwIfAborted()
  })
  const firstRejected = assert.rejects(first, { name: 'AbortError' })
  await entered.promise
  const second = operations.run(session, new AbortController().signal, () => { queued = true })
  const secondRejected = assert.rejects(second, { name: 'AbortError' })
  let disposed = false
  const done = operations.dispose().then(() => { disposed = true })
  await Promise.resolve()
  assert.equal(disposed, false)
  cleanup.resolve()
  await Promise.all([firstRejected, secondRejected, done])
  assert.equal(queued, false)
  await assert.rejects(operations.run(session, new AbortController().signal, () => {}), { name: 'AbortError' })
})
