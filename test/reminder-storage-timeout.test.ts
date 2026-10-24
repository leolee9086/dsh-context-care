import test from 'node:test'
import assert from 'node:assert/strict'
import { isDefiniteStorageFailure, PersistenceTimeoutError } from '../lib/reminder-runtime/persistence.js'

// The former fake save/execute scenarios are now exercised against the real
// JSON backend in reminder-persistence-real.test.ts: serial late ACK, expired
// queued work, compensated reservations, and close retaining its actual owner.
// Coalescing or blindly retrying a rejected whole-state snapshot is not a safe
// durability contract. This file tests only the pure evidence classifier.
test('only known native rename failures establish a pre-commit rejection', () => {
  for (const code of ['EPERM', 'EISDIR', 'EEXIST', 'ENOTEMPTY', 'EACCES',
    'ENOENT', 'ENOTDIR', 'EXDEV', 'EROFS', 'EBUSY']) {
    const error = Object.assign(new Error('native rename failed'), { syscall: 'rename', code })
    assert.equal(isDefiniteStorageFailure(error), true, code)
    assert.equal(isDefiniteStorageFailure(new Error('wrapper', { cause: error })), true, code)
  }
})

test('generic rejection and post-rename fsync failure do not prove no commit', () => {
  const samples: unknown[] = [new Error('disk'), undefined, null,
    { syscall: 'rename', code: 'EPERM' },
    Object.assign(new Error('ambiguous rename'), { syscall: 'rename', code: 'EIO' }),
    Object.assign(new Error('directory sync failed'), { syscall: 'fsync', code: 'EIO' }),
    Object.assign(new Error('no errno'), { syscall: 'rename' })]
  for (const sample of samples) assert.equal(isDefiniteStorageFailure(sample), false)
})

test('aggregate, cyclic, and conflicting error evidence stays uncertain', () => {
  const rename = Object.assign(new Error('rename failed'), { syscall: 'rename', code: 'EPERM' })
  assert.equal(isDefiniteStorageFailure(new AggregateError([rename])), false)
  const cycle = new Error('cycle')
  cycle.cause = cycle
  assert.equal(isDefiniteStorageFailure(cycle), false)
  const sync = Object.assign(new Error('sync failed', { cause: rename }), { syscall: 'fsync', code: 'EIO' })
  assert.equal(isDefiniteStorageFailure(sync), false)
})

test('timeout values distinguish unstarted work, unknown commits, and close', () => {
  const queued = new PersistenceTimeoutError('transaction', 's', 'not-started')
  const running = new PersistenceTimeoutError('transaction', 's', 'unknown')
  const close = new PersistenceTimeoutError('close', undefined, 'unknown')
  assert.equal(queued.outcome, 'not-started')
  assert.equal(running.outcome, 'unknown')
  assert.equal(running.code, 'CONTEXT_CARE_PERSISTENCE_TIMEOUT')
  assert.equal(close.message, 'reminder-persistence-close-timeout')
  for (const error of [queued, running, close]) assert.equal(isDefiniteStorageFailure(error), false)
})
