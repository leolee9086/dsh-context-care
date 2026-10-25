import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { eventLog } from './fixtures/event-log.js'
import { createSummaryProposalHistory, summaryProposalRecord } from '../lib/summary-proposal-history.js'
import { createSessionCache } from '../lib/session-cache.js'

function createCachedProposalHistory(history: Parameters<typeof createSummaryProposalHistory>[0]) {
  return createSummaryProposalHistory(history, { cache: createSessionCache() })
}

test('paired native compaction logs recover only an actual non-useful proposal', async () => {
  const owner = Session.create(SessionId('summary-proposal-native'))
  const events: SessionEvent[] = []
  const history = createCachedProposalHistory({ readSession: async id => {
    assert.equal(id, owner.id)
    return eventLog(events)
  } })
  const observe = (event: SessionEvent) => { events.push(event); history.observe(owner, event) }
  observe(owner.append('step/start', { turn: 0, step: 0 }))
  observe(owner.append('compaction/start', { compactionId: CompactionId('bad'), turn: 0,
    ...summaryProposalRecord('proposal-bad') }))
  observe(owner.append('compaction/end', { compactionId: CompactionId('bad'), turn: 0, error: 'replacement grew',
    ...summaryProposalRecord('proposal-bad', 'SUMMARY_NOT_SMALLER') }))
  observe(owner.append('compaction/start', { compactionId: CompactionId('good'), turn: 0,
    ...summaryProposalRecord('proposal-good') }))
  observe(owner.append('compaction/end', { compactionId: CompactionId('good'), turn: 0,
    ...summaryProposalRecord('proposal-good') }))
  assert.equal(await history.has(owner, 'proposal-bad'), true)
  assert.equal(await history.has(owner, 'proposal-good'), false)

  history.close()
  const cold = createCachedProposalHistory({ readSession: async id => {
    assert.equal(id, owner.id)
    return eventLog(events)
  } })
  assert.equal(await cold.has(owner, 'proposal-bad'), true)
  assert.equal(await cold.has(owner, 'proposal-good'), false)
  cold.close()
})

test('native proposal projection ignores orphan and interrupted non-decision compactions', async () => {
  const owner = Session.create(SessionId('summary-proposal-interrupt'))
  const events = [
    owner.append('compaction/end', { compactionId: CompactionId('orphan'), turn: 0, error: 'copied failure',
      ...summaryProposalRecord('proposal-orphan', 'SUMMARY_NOT_SMALLER') }),
    owner.append('compaction/start', { compactionId: CompactionId('cancelled'), turn: 0,
      ...summaryProposalRecord('proposal-cancelled') }),
    owner.append('compaction/end', { compactionId: CompactionId('cancelled'), turn: 0, error: 'aborted',
      ...summaryProposalRecord('proposal-cancelled', 'ABORT_ERR') }),
    owner.append('compaction/start', { compactionId: CompactionId('missing-proof'), turn: 0,
      ...summaryProposalRecord('proposal-unproven') }),
    owner.append('compaction/end', { compactionId: CompactionId('missing-proof'), turn: 0, error: 'failed' }),
  ]
  const projection = createCachedProposalHistory({ readSession: async () => (eventLog(events)) })
  assert.equal(await projection.has(owner, 'proposal-orphan'), false)
  assert.equal(await projection.has(owner, 'proposal-cancelled'), false)
  assert.equal(await projection.has(owner, 'proposal-unproven'), false)
  projection.close()
})

test('native proposal restore includes commits during its read and isolates reader cancellation', async () => {
  const owner = Session.create(SessionId('summary-proposal-race'))
  const events: SessionEvent[] = [owner.append('compaction/start', { compactionId: CompactionId('race'), turn: 0,
    ...summaryProposalRecord('proposal-race') })]
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let reads = 0
  const projection = createCachedProposalHistory({ readSession: async () => {
    reads++
    const snapshot = events.slice()
    await gate
    return eventLog(snapshot)
  } })
  const controller = new AbortController()
  const cancelled = assert.rejects(projection.has(owner, 'proposal-race', controller.signal), /cancel replay reader/)
  const waiting = projection.has(owner, 'proposal-race')
  const end = owner.append('compaction/end', { compactionId: CompactionId('race'), turn: 0, error: 'empty result',
    ...summaryProposalRecord('proposal-race', 'SUMMARY_EMPTY') })
  events.push(end); projection.observe(owner, end)
  controller.abort(new Error('cancel replay reader'))
  release()
  await cancelled
  assert.equal(await waiting, true)
  assert.equal(await projection.has(owner, 'proposal-race'), true)
  assert.equal(reads, 1, 'concurrent readers share one native cut; no side record is needed')
  projection.close()
  const childId = SessionId('summary-proposal-inherited')
  const childSession = Session.create(childId, events, { ...owner.header, id: childId, isSeeded: true }, SessionLogOffset(events.length))
  let childReads = 0
  const child = createCachedProposalHistory({ readSession: async () => {
    childReads++; return eventLog(childSession.snapshotEvents(), childSession.inheritedEventCount)
  } })
  assert.equal(await child.has(childSession, 'proposal-race'), false, 'inherited attempts do not become child-owned decisions')
  assert.equal(await child.has(childSession, 'proposal-race'), false)
  assert.equal(childReads, 1, 'the native inherited offset stays stable across readers')
  child.close()
})

test('native proposal commit between restore fulfillment and its reader is observed', async () => {
  const owner = Session.create(SessionId('summary-proposal-publish'))
  const events: SessionEvent[] = [owner.append('compaction/start', { compactionId: CompactionId('publish'), turn: 0,
    ...summaryProposalRecord('proposal-publish') })]
  const projection = createCachedProposalHistory({ readSession: async () => (eventLog(events.slice())) })
  const reading = projection.has(owner, 'proposal-publish')
  // The native read resumes first. Its readers resume after this actual commit.
  queueMicrotask(() => {
    const end = owner.append('compaction/end', { compactionId: CompactionId('publish'), turn: 0, error: 'replacement grew',
      ...summaryProposalRecord('proposal-publish', 'SUMMARY_NOT_SMALLER') })
    events.push(end); projection.observe(owner, end)
  })
  assert.equal(await reading, true)
  projection.close()
})

test('invalid native proposal evidence remains an error after later commits', async () => {
  const owner = Session.create(SessionId('summary-proposal-invalid'))
  const events: SessionEvent[] = []
  const projection = createCachedProposalHistory({ readSession: async () => (eventLog(events)) })
  const data = { compactionId: CompactionId('invalid'), turn: 0,
    contextCareSummary: { format: 'context-care/summary-proposal/v1', proposalKey: 5 } }
  const invalid = owner.append('compaction/start', data)
  events.push(invalid)
  assert.throws(() => projection.observe(owner, invalid), /proposalKey/)
  const later = owner.append('step/start', { turn: 0, step: 0 })
  events.push(later); projection.observe(owner, later)
  await assert.rejects(projection.has(owner, 'proposal-invalid'), /proposalKey/)
  await assert.rejects(projection.has(owner, 'proposal-invalid'), /proposalKey/)
  projection.close()
})
