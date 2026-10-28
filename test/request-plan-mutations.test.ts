import test from 'node:test'
import assert from 'node:assert/strict'
import { createArgumentPatchState, mergeRequestInsertions } from '@leolee9086/dsh-rule-engine'

function oldPatch(original: unknown, pointer: string, value: unknown): unknown {
  const out: unknown = structuredClone(original)
  if (!pointer.startsWith('/') || !pointer.slice(1)) throw new Error('tool-argument-patch-requires-property')
  const keys = pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('tool-argument-patch-unsafe-path')
  let parent = out
  for (const key of keys.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error('tool-argument-patch-missing-path')
    parent = (parent as Record<string, unknown>)[key]
  }
  const key = keys[keys.length - 1]
  if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error('tool-argument-patch-missing-path')
  ;(parent as Record<string, unknown>)[key] = value
  return out
}

test('argument mutation keeps exact snapshots, raw-pointer conflicts and original ownership', () => {
  const original = { tree: { x: 1, y: { leaf: 'old' } }, array: [0, 1, 2], 'a/b': { '~value': 3 }, prefix: 1, prefixMore: 2 }
  const saved = structuredClone(original), state = createArgumentPatchState(original), paths: string[] = []
  let current: unknown = original
  for (const [path, value] of [['/tree/x', { replaced: true }], ['/array/0', 9], ['/a~1b/~0value', null], ['/prefix', 4], ['/prefixMore', 5],
    ['/tree', {}], ['/tree/x/child', 2], ['/tree/y/leaf', 'new'], ['/array/2', 8], ['/a~1b', {}], ['/prefix', 6]] as const) {
    const conflict = paths.some(old => old === path || old.startsWith(path + '/') || path.startsWith(old + '/'))
    assert.equal(state.conflicts(path), conflict, path)
    if (conflict) continue
    const next = oldPatch(current, path, value), result = state.apply(path, value)
    assert.equal(result.before, JSON.stringify(current)); assert.equal(result.after, JSON.stringify(next))
    paths.push(path); current = next
  }
  assert.deepEqual(original, saved)
})

test('argument paths retain validation errors, array semantics and failed edits leave state unchanged', () => {
  const original = { nested: { x: 1 }, items: [0, 1], '': { empty: 2 }, 'tilde~2': 3 }
  const state = createArgumentPatchState(original)
  for (const path of ['', '/', 'nested/x', '/__proto__/x', '/nested/constructor', '/prototype', '/missing', '/nested/missing/x']) {
    let message = ''
    try { oldPatch(original, path, 9) } catch (error) { if (!(error instanceof Error)) throw error; message = error.message }
    assert.ok(message); assert.throws(() => state.apply(path, 9), (error: Error) => error.message === message)
    assert.equal(state.conflicts(path), false)
  }
  const circular: { self?: object } = {}; circular.self = circular
  assert.throws(() => state.apply('/nested/x', circular), /circular/i)
  assert.equal(state.conflicts('/nested/x'), false)
  assert.deepEqual(state.apply('//empty', 8), { before: JSON.stringify(original), after: JSON.stringify(oldPatch(original, '//empty', 8)) })
  assert.equal(state.conflicts('//empty'), true)
  const arrays = createArgumentPatchState(original)
  assert.equal(arrays.apply('/items/length', 1).after, JSON.stringify(oldPatch(original, '/items/length', 1)))
  // Raw encoded aliases intentionally remain separate, as in the old startsWith policy.
  const aliases = createArgumentPatchState(original)
  aliases.apply('/tilde~2', 7); assert.equal(aliases.conflicts('/tilde~02'), false)
  assert.equal(JSON.parse(aliases.apply('/tilde~02', 8).after!)['tilde~2'], 8)
})

test('thousands of argument properties clone once and check paths in bounded depth', () => {
  let reads = 0, work = 0
  const original = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`p${index}`, index]))
  Object.defineProperty(original, 'sentinel', { enumerable: true, get() { reads++; return 'untouched' } })
  const state = createArgumentPatchState(original, amount => { work += amount })
  for (let index = 0; index < 1000; index++) { const path = `/p${index}`; assert.equal(state.conflicts(path), false); state.apply(path, index + 1) }
  assert.equal(reads, 1, 'one owned clone, not a full clone for each property')
  assert.ok(work <= 5001, `path work ${work} is linear in depth, not history length`)
  assert.equal(original.p0, 0)
})

test('request insertion merge equals original splice and system concatenation including ties', () => {
  for (const system of [undefined, '', 'SYSTEM']) {
    const messages = Array.from({ length: 31 }, (_, index) => `original:${index}`), expected = [...messages]
    const insertions = Array.from({ length: 2000 }, (_, index) => ({ at: index % 32, priority: index % 7 - 3, key: `key:${index % 17}`, role: index % 11 ? 'user' : 'system', text: `TEXT🙂:${index}` }))
    let expectedSystem = system
    for (const item of [...insertions].sort((a, b) => b.at - a.at || a.priority - b.priority || b.key.localeCompare(a.key))) {
      if (item.role === 'system') expectedSystem = item.at === 0 ? item.text + '\n' + (expectedSystem ?? '') : (expectedSystem ?? '') + '\n' + item.text
      else expected.splice(item.at, 0, item.text)
    }
    let made = 0
    const actual = mergeRequestInsertions(messages, system, insertions, item => { made++; return item.text })
    assert.deepEqual(actual.messages, expected); assert.equal(actual.system, expectedSystem)
    assert.equal(made, insertions.filter(item => item.role !== 'system').length); assert.equal(messages.length, 31)
  }
  const empty = mergeRequestInsertions(['one'], undefined, [], () => 'unused')
  assert.equal(empty.system, undefined); assert.equal(empty.hasSystem, false)
  assert.deepEqual(mergeRequestInsertions<string, { at: number; priority: number; key: string; role: string; text: string }>([], '', [{ at: 0, priority: 0, key: 'a', role: 'user', text: 'only' }], item => item.text).messages, ['only'])
})
