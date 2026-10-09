import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeltaProjection } from '../src/delta-projection.js'
const projection = options => createDeltaProjection({ sessionId: 's', requestId: 'request', attemptId: 'attempt', turnId: 'turn', ...options })
const chunk = (text, index = 0, type = 'text-delta') => ({ type, index, text })

test('Delta evidence spans chunks, separates reasoning/blocks/attempts and has no invented committed seq', () => {
  const stream = projection()
  stream.feed(chunk('ARCH'), 'p1')
  const blocks = stream.feed(chunk('IVE'), 'p1')
  assert.equal(blocks[0].text, 'ARCHIVE')
  assert.equal(blocks[0].seq, undefined)
  assert.equal(blocks[0].requestId, 'request')
  assert.equal(stream.feed(chunk('thought', 1, 'reasoning-delta'), 'p1')[0].text, 'thought')
  assert.notEqual(blocks[0].id, projection({ attemptId: 'retry' }).feed(chunk('ARCHIVE'), 'p1')[0].id)
  stream.feed({ type: 'block-end', index: 0 }, 'p1')
  assert.equal(stream.feed(chunk('fresh'), 'p1')[0].text, 'fresh')
  stream.close()
  assert.throws(() => stream.feed(chunk('later'), 'p1'), /ended/)
})

test('Changed preferences discard disabled text and a growing match is acknowledged once per block', () => {
  const stream = projection()
  stream.feed(chunk('ARCH'), 'on')
  stream.feed({ type: 'inactive' }, 'off')
  const blocks = stream.feed(chunk('IVE'), 'on-again')
  assert.equal(blocks[0].text, 'IVE')
  const event = { sourceId: 'x', ruleId: 'r', ruleRevision: 1, blockId: blocks[0].id }
  assert.equal(stream.unseen([event]).length, 1)
  stream.acknowledge([event])
  assert.equal(stream.unseen([{ ...event, ranges: [[0, 5]] }]).length, 0)
  assert.equal(stream.unseen([{ ...event, blockId: 'other' }]).length, 1)
})

test('Delta projection rejects over-budget input before retaining it and finishes deterministically', () => {
  const stream = projection({ maxChars: 4, maxBlocks: 1 })
  assert.equal(stream.feed(chunk('1234'), 'p')[0].text, '1234')
  assert.throws(() => stream.feed(chunk('5'), 'p'), /text-budget/)
  assert.throws(() => stream.feed(chunk('x', 1), 'p'), /block-budget/)
  assert.deepEqual(stream.feed({ type: 'finish' }, 'p'), [])
  assert.throws(() => stream.feed(chunk('later'), 'p'), /ended/)
})
