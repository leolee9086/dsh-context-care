import test from 'node:test'
import assert from 'node:assert/strict'
import { completionStateKey, createCompletionObserver, createCompletionStateStore, parseCompletion } from '../src/completion-observer.js'


test('completion state keys stay safe for the JSON per-record backend', () => {
  const key = completionStateKey('session/一', 'attempt:2')
  assert.match(key, /^[a-z0-9_]+$/u)
  assert.notEqual(key, completionStateKey('session/一', 'attempt:3'))
  const uuidKey = completionStateKey('12345678-1234-1234-1234-123456789abc', 'assistant')
  assert.equal(uuidKey.length, 71)
  assert.match(uuidKey, /^sha256_[a-f0-9]{64}$/)
  assert.notEqual(uuidKey, completionStateKey('12345678-1234-1234-1234-123456789abd', 'assistant'))
})

test('parser accepts English and Chinese labels but ignores quotes, fences, and negation', () => {
  assert.equal(parseCompletion('DONE')?.label, 'DONE')
  assert.equal(parseCompletion('任务已经完成了')?.label, '完成了')
  assert.equal(parseCompletion('> DONE\n```\ncompleted\n```'), undefined)
  assert.equal(parseCompletion('The task is not done.'), undefined)
  assert.equal(parseCompletion('还没完成，请继续'), undefined)
})

test('observer persists pending before completion and applies source cooldown', async () => {
  const store = new Map()
  let time = 100
  const observer = createCompletionObserver({
    now: () => time,
    cooldownMs: 50,
    load: async key => store.get(key),
    save: async (key, value) => store.set(key, value),
  })
  const input = { sessionId: 's1', sourceId: 'source-a', occurrenceId: 'o1', text: 'DONE' }
  assert.equal((await observer.observe(input)).status, 'pending')
  assert.equal((await observer.observe(input)).status, 'pending')
  assert.equal((await observer.settle(input)).status, 'completed')
  assert.equal((await observer.observe({ ...input, text: 'completed' })).status, 'cooldown')
  time += 51
  assert.equal((await observer.observe({ ...input, text: 'completed' })).status, 'pending')
  assert.equal((await observer.observe({ ...input, sourceId: 'source-b' })).status, 'pending')
})

test('configured storage failures retain their original error and never acknowledge a memory write', async () => {
  const original = new Error('backend open failed')
  const store = createCompletionStateStore({ storageDomain: { open: async () => { throw original } } })
  await assert.rejects(store.ready, error => error === original)
  await assert.rejects(store.load('key'), error => error === original)
  await assert.rejects(store.save('key', { version: 1, cooldownUntil: 0 }), error => error === original)
  assert.throws(() => createCompletionStateStore(), /requires storageDomain/)
})

test('settlement from an older occurrence cannot consume a newer pending observation', async () => {
  const store = new Map()
  const observer = createCompletionObserver({ load: async key => store.get(key), save: async (key, value) => store.set(key, value) })
  const old = { sessionId: 's', sourceId: 'assistant', occurrenceId: 'old', text: 'DONE' }
  const current = { ...old, occurrenceId: 'current' }
  await observer.observe(old)
  await observer.observe(current)
  assert.equal((await observer.settle(old)).status, 'recovery')
  assert.equal((await observer.recover(old)).state.pending.occurrenceId, 'current')
  assert.equal((await observer.settle(current)).state.completedOccurrenceId, 'current')
})

test('recovery clears an interrupted pending observation', async () => {
  const store = new Map()
  const observer = createCompletionObserver({ load: async key => store.get(key), save: async (key, value) => store.set(key, value) })
  const input = { sessionId: 's1', sourceId: 'source-a', text: '搞定' }
  await observer.observe(input)
  assert.equal((await observer.recover(input)).status, 'recovered')
  assert.equal((await observer.settle(input)).status, 'recovery')
})
