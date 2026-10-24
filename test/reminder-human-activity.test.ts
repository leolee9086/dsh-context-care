import test from 'node:test'
import assert from 'node:assert/strict'
import { humanActivity, type HistoryEvent } from '../src/reminder-runtime/request-context.ts'

const now = 1_000_000
const windowMs = 300_000
const human = { id: 'human', role: 'user', source: { kind: 'user' } }
const arrival = (time: number, seq = 0): HistoryEvent => ({
  type: 'agent/inbox/spliced', seq, time, data: { inserted: [human] },
})

/** Count real reads of a log view, not just the size of a returned result. */
function observed(events: readonly HistoryEvent[]) {
  const reads: number[] = []
  return { reads, view: { length: events.length, at(index: number) {
    reads.push(index)
    return events.at(index)
  } } }
}

test('human activity: read only the recent suffix, not the session lifetime', () => {
  const prefix: HistoryEvent[] = Array.from({ length: 16_000 }, (_, seq) => ({
    type: 'step/end', seq, time: now - windowMs - 1, data: {},
  }))
  const { view, reads } = observed([...prefix, arrival(now - 1, prefix.length),
    { type: 'assistant/message', seq: prefix.length + 1, time: now, data: {} }])
  assert.deepEqual(humanActivity(view, now, windowMs), { at: now - 1, evidence: 'human-message' })
  assert.deepEqual(reads, [16_001, 16_000], 'the old prefix must not be read or copied')
})

test('human activity: stop at the time window even when no human is present', () => {
  const events: HistoryEvent[] = [arrival(1),
    { type: 'step/end', seq: 1, time: now - windowMs - 1, data: {} },
    { type: 'step/start', seq: 2, time: now - 1, data: {} },
    { type: 'user/message', seq: 3, time: now, data: human }]
  const { view, reads } = observed(events)
  assert.equal(humanActivity(view, now, windowMs), null)
  assert.deepEqual(reads, [3, 2, 1], 'a late surface commit is not a new human arrival')
})

test('human activity: the exact window boundary counts; older arrivals do not', () => {
  assert.deepEqual(humanActivity([arrival(now - windowMs)], now, windowMs),
    { at: now - windowMs, evidence: 'human-message' })
  assert.equal(humanActivity([arrival(now - windowMs - 1)], now, windowMs), null)
})

test('human activity: future and producer-owned inputs do not establish presence', () => {
  const events: HistoryEvent[] = [arrival(now - 1),
    { ...arrival(now, 1), data: { inserted: [{ ...human, source: { kind: 'plugin:notice' } }] } },
    arrival(now + 1, 2)]
  assert.deepEqual(humanActivity(events, now, windowMs), { at: now - 1, evidence: 'human-message' })
  assert.equal(humanActivity([arrival(now + 1)], now, windowMs), null)
})

test('human activity: inherited history is not presence in the child; a normal resume is not a new arrival', () => {
  for (const inherited of [false, true]) {
    const events: HistoryEvent[] = [arrival(now - 1),
      { type: 'session/end-seed', seq: 1, time: now, data: inherited ? { inherited: true } : {} }]
    assert.deepEqual(humanActivity(events, now, windowMs),
      inherited ? null : { at: now - 1, evidence: 'human-message' })
  }
  assert.equal(humanActivity([arrival(now - windowMs - 1),
    { type: 'session/end-seed', seq: 1, time: now, data: {} }], now, windowMs), null)
})

test('human activity: no interested rule means no history read', () => {
  const { view, reads } = observed([arrival(now)])
  assert.equal(humanActivity(view, now, 0), null)
  assert.deepEqual(reads, [])
})
