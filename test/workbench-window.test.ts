import { createBlockWindow as createWorkbenchWindow, selectBlocksV2 } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

interface Block { id: string; seq: number; messageId: string; turnId: string; view: string; role: string; type: string }
const block = (seq: number, child = 0): Block => ({ id: `${seq}:${child}`, seq, messageId: `m:${seq}`, turnId: `t:${Math.floor(seq / 3)}`,
  view: 'original', role: seq % 2 ? 'assistant' : 'user', type: child ? 'reasoning' : 'text' })
const rules = [
  { select: { view: 'original', roles: ['assistant'], blockTypes: ['text'], depth: { unit: 'message' as const, limit: 2 } } },
  { select: { view: 'original', roles: ['user'], blockTypes: ['text'], depth: { unit: 'turn' as const, limit: 2 } } },
  { select: { view: 'original', roles: ['assistant'], blockTypes: ['reasoning'], depth: { unit: 'block' as const, limit: 2 } } },
]

test('workbench indexed windows preserve depth before role/type selection and old cuts', () => {
  const select = createWorkbenchWindow<Block>(), rows: Block[] = []
  let reads = 0, copies = 0
  const source = { get length() { return rows.length }, at(index: number) { reads++; return rows[index] },
    slice(from: number, to: number) { copies++; return rows.slice(from, to) } }
  for (let seq = 0; seq < 1200; seq++) rows.push(block(seq), block(seq, 1))
  for (const seq of [1100, 1199, 20, 1198]) {
    const full = rows.filter(row => row.seq <= seq), window = select(source, rules, seq)
    for (const rule of rules) assert.deepEqual(selectBlocksV2(window, rule.select), selectBlocksV2(full, rule.select))
    assert.ok(window.length <= 12, 'materialization follows the declared windows, not the full prefix')
  }
  const first = select(source, rules, 1199), before = reads, beforeCopies = copies
  assert.equal(select(source, rules, 1199), first)
  assert.ok(reads - before < 30, 'warm selection uses indexed bounds instead of a history walk')
  assert.equal(copies, beforeCopies)
  rows.push(block(1200), block(1200, 1))
  const growStart = reads
  const grown = select(source, rules, 1200)
  assert.ok(reads - growStart < 35, 'only newly appended identities are indexed')
  for (const rule of rules) assert.deepEqual(selectBlocksV2(grown, rule.select), selectBlocksV2(rows, rule.select))
})

test('workbench windows preserve noncontiguous identities and rebuild after replacements', () => {
  const select = createWorkbenchWindow<Block>()
  let rows = [block(0), block(1), { ...block(2), messageId: 'm:0' }, block(3)]
  const source = { get length() { return rows.length }, at: (index: number) => rows[index], slice: (from: number, to: number) => rows.slice(from, to) }
  const messageRule = [rules[0]]
  assert.deepEqual(selectBlocksV2(select(source, messageRule), rules[0].select), selectBlocksV2(rows, rules[0].select))
  rows = [block(5), block(6)]
  assert.deepEqual(select(source, messageRule, Infinity, 1), rows)
  const unbounded = [{ select: { view: 'original', roles: ['user'], blockTypes: ['text'], depth: undefined } }]
  assert.deepEqual(select(source, unbounded, Infinity, 1), rows)
})

test('workbench block windows retain a complete current message for display output', () => {
  const rows = [block(0), block(1), block(1, 1), block(1, 2)]
  const source = { length: rows.length, at: (index: number) => rows[index], slice: (from: number, to: number) => rows.slice(from, to) }
  assert.deepEqual(createWorkbenchWindow<Block>()(source, [rules[2]]).map(value => value.id), ['1:0', '1:1', '1:2'])
})
