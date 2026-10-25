import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionCache, type CacheKey } from '../lib/session-cache.js'

test('shared cache owns dependencies, domain clearing and independent native identities', () => {
  const cache = createSessionCache(), one = { id: 'same' }, two = { id: 'same' }
  let builds = 0
  const key: CacheKey<typeof one, { value: number }> = { name: 'projection', validity: 'identity and content generation',
    create: () => ({ value: ++builds }) }
  const first = cache.use(one, key, [0])
  assert.equal(cache.use(one, key, [0]), first)
  assert.notEqual(cache.use(two, key, [0]), first)
  const changed = cache.use(one, key, [1])
  assert.notEqual(changed, first); assert.equal(first.value, 1)
  cache.worked(key, 2)
  assert.deepEqual(cache.report(), [{ name: 'projection', validity: key.validity, entries: 2, hits: 1, builds: 3, invalidations: 1, failures: 0, work: 2 }])
  cache.release(one)
  assert.equal(cache.report()[0].entries, 1)
  assert.equal(cache.use(two, key, [0]).value, 2)
  const independent: CacheKey<typeof two, object> = { name: 'other', validity: 'immutable', create: () => ({}) }
  const other = cache.use(two, independent)
  cache.clear(key)
  assert.equal(cache.report().some(row => row.name === 'projection'), false)
  assert.equal(cache.use(two, independent), other)
  assert.notEqual(cache.use(two, key, [0]).value, 2)
  cache.close(); cache.close(); cache.clear(key)
  assert.throws(() => cache.use(one, key), /cache-closed/)
  assert.throws(() => cache.report(), /cache-closed/)
})

test('cache peeks never allocate owners or rebuild mismatched dependencies', () => {
  const cache = createSessionCache(), owner = {}
  let builds = 0
  const key: CacheKey<object, object> = { name: 'peeked', validity: 'explicit revision', create() { builds++; return {} } }
  assert.equal(cache.peek(owner, key, [0]), undefined)
  assert.deepEqual(cache.report(), [])
  assert.equal(builds, 0)
  const value = cache.use(owner, key, [0])
  assert.equal(cache.peek(owner, key, [0]), value)
  assert.equal(cache.peek(owner, key, [1]), undefined)
  assert.equal(builds, 1, 'a dependency mismatch does not build during peek')
  assert.equal(cache.peek(owner, key, [0]), value, 'a mismatched reader does not evict the accepted entry')
  cache.release(owner)
  assert.equal(cache.peek(owner, key, [0]), undefined)
  assert.equal(cache.report()[0].entries, 0)
  cache.close()
  assert.throws(() => cache.peek(owner, key), /cache-closed/)
})

test('failed cache builds never publish values and explicit invalidation retries independently', () => {
  const cache = createSessionCache(), owner = {}
  let fail = true
  const key: CacheKey<object, object> = { name: 'failable', validity: 'stable identity', create() {
    if (fail) throw new Error('projection failed')
    return {}
  } }
  assert.throws(() => cache.use(owner, key), /projection failed/)
  assert.equal(cache.report()[0].entries, 0)
  fail = false
  const first = cache.use(owner, key)
  assert.equal(cache.use(owner, key), first)
  cache.invalidate(owner, key)
  assert.notEqual(cache.use(owner, key), first)
  assert.equal(cache.report()[0].failures, 1)
  cache.close()
})
