import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { nativeSession } from './fixtures/native-session.ts'
import { createSummaryProposalHistory, summaryProposalRecord } from '../lib/summary-proposal-history.js'

test('paired native compaction logs recover only an actual non-useful proposal', async t => {
  const { sessions, logs } = nativeSession(t), owner = sessions.create(SessionId('summary-proposal-native'))
  const history = createSummaryProposalHistory({ readSession: id => logs.read(id) }, logs); t.after(() => history.close())
  const observe = (event: SessionEvent) => history.observe(owner, event)
  observe(owner.append('turn/start', { turn: 1 }))
  observe(owner.append('compaction/start', { compactionId: CompactionId('bad'), turn: 1, ...summaryProposalRecord('proposal-bad') }))
  observe(owner.append('compaction/end', { compactionId: CompactionId('bad'), turn: 1, error: 'replacement grew', ...summaryProposalRecord('proposal-bad', 'SUMMARY_NOT_SMALLER') }))
  const source = owner.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'material' }] }), { surfaceOp: 'append' })
  observe(source)
  observe(owner.append('compaction/start', { compactionId: CompactionId('good'), turn: 1, ...summaryProposalRecord('proposal-good') }))
  const summary = owner.append('compaction/summary', { compactionId: CompactionId('good'), shadowedSeqs: [source.seq],
    shadowedRange: { start: source.seq, end: source.seq }, shadowedTokenCount: 1, summary: [{ type: 'text', text: 'summary' }],
    provider: 'p', model: 'm' })
  observe(summary)
  observe(owner.append('user/message', createUserMessage({ source: { kind: 'compact-checkpoint', compactionId: CompactionId('good') }, content: [{ type: 'text', text: 'summary' }] }),
    { surfaceOp: { op: 'replace', startSeq: source.seq, endSeq: source.seq }, sourceEventSeqs: [source.seq, summary.seq] }))
  observe(owner.append('compaction/end', { compactionId: CompactionId('good'), turn: 1, ...summaryProposalRecord('proposal-good') }))
  assert.equal(await history.has(owner, 'proposal-bad'), true); assert.equal(await history.has(owner, 'proposal-good'), false)
  history.close()
  const restored = createSummaryProposalHistory({ readSession: id => logs.read(id) }, logs); t.after(() => restored.close())
  assert.equal(await restored.has(owner, 'proposal-bad'), true); assert.equal(await restored.has(owner, 'proposal-good'), false)
})

test('native proposal projection ignores orphan and interrupted non-decision compactions', async t => {
  const { sessions, logs } = nativeSession(t), owner = sessions.create(SessionId('summary-proposal-interrupt'))
  owner.append('compaction/end', { compactionId: CompactionId('orphan'), turn: 0, error: 'copied failure', ...summaryProposalRecord('proposal-orphan', 'SUMMARY_NOT_SMALLER') })
  owner.append('compaction/start', { compactionId: CompactionId('cancelled'), turn: 0, ...summaryProposalRecord('proposal-cancelled') })
  owner.append('compaction/end', { compactionId: CompactionId('cancelled'), turn: 0, error: 'aborted', ...summaryProposalRecord('proposal-cancelled', 'ABORT_ERR') })
  owner.append('compaction/start', { compactionId: CompactionId('missing-proof'), turn: 0, ...summaryProposalRecord('proposal-unproven') })
  owner.append('compaction/end', { compactionId: CompactionId('missing-proof'), turn: 0, error: 'failed' })
  const projection = createSummaryProposalHistory({ readSession: id => logs.read(id) }, logs); t.after(() => projection.close())
  assert.equal(await projection.has(owner, 'proposal-orphan'), false); assert.equal(await projection.has(owner, 'proposal-cancelled'), false)
  assert.equal(await projection.has(owner, 'proposal-unproven'), false)
})

test('native proposal restore includes commits during its read and isolates reader cancellation', async t => {
  const { sessions, logs } = nativeSession(t), owner = sessions.create(SessionId('summary-proposal-race'))
  owner.append('compaction/start', { compactionId: CompactionId('race'), turn: 0, ...summaryProposalRecord('proposal-race') })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }); t.after(() => release())
  let reads = 0
  // Delay delivery of an actual bounded log. No event reads or indexing are replaced.
  const projection = createSummaryProposalHistory({ readSession: async () => {
    reads++
    const cut = logs.live(owner)
    await gate
    return cut
  } }, logs); t.after(() => projection.close())
  const controller = new AbortController()
  const cancelled = assert.rejects(projection.has(owner, 'proposal-race', controller.signal), /cancel replay reader/)
  const waiting = projection.has(owner, 'proposal-race')
  const end = owner.append('compaction/end', { compactionId: CompactionId('race'), turn: 0, error: 'empty result', ...summaryProposalRecord('proposal-race', 'SUMMARY_EMPTY') })
  projection.observe(owner, end); controller.abort(new Error('cancel replay reader')); release()
  await cancelled
  assert.equal(await waiting, true); assert.equal(await projection.has(owner, 'proposal-race'), true); assert.equal(reads, 1)
  projection.close()
  const seed = logs.withLive(owner, log => [...log.range(0)])
  const childSession = sessions.create(SessionId('summary-proposal-inherited'), { seed, meta: { isSeeded: true }, inheritedEventCount: SessionLogOffset(seed.length) })
  let childReads = 0
  const child = createSummaryProposalHistory({ readSession: async id => { childReads++; return logs.read(id) } }, logs); t.after(() => child.close())
  assert.equal(await child.has(childSession, 'proposal-race'), false, 'inherited attempts do not become child-owned decisions')
  assert.equal(await child.has(childSession, 'proposal-race'), false); assert.equal(childReads, 1)
})

test('native proposal commit between restore fulfillment and its reader is observed', async t => {
  const { sessions, logs } = nativeSession(t), owner = sessions.create(SessionId('summary-proposal-publish'))
  owner.append('compaction/start', { compactionId: CompactionId('publish'), turn: 0, ...summaryProposalRecord('proposal-publish') })
  const projection = createSummaryProposalHistory({ readSession: id => logs.read(id) }, logs); t.after(() => projection.close())
  const reading = projection.has(owner, 'proposal-publish')
  queueMicrotask(() => {
    const end = owner.append('compaction/end', { compactionId: CompactionId('publish'), turn: 0, error: 'replacement grew', ...summaryProposalRecord('proposal-publish', 'SUMMARY_NOT_SMALLER') })
    projection.observe(owner, end)
  })
  assert.equal(await reading, true)
})

test('invalid native proposal evidence remains an error after later commits', async t => {
  const { sessions, logs } = nativeSession(t), owner = sessions.create(SessionId('summary-proposal-invalid'))
  const projection = createSummaryProposalHistory({ readSession: id => logs.read(id) }, logs); t.after(() => projection.close())
  // Plugin metadata is decoded at the consumer; the native compaction fields remain valid.
  const data = { compactionId: CompactionId('invalid'), turn: 0,
    contextCareSummary: { format: 'context-care/summary-proposal/v1', proposalKey: 5 } }
  const invalid = owner.append('compaction/start', data)
  assert.throws(() => projection.observe(owner, invalid), /proposalKey/)
  projection.observe(owner, owner.append('step/start', { turn: 0, step: 0 }))
  await assert.rejects(projection.has(owner, 'proposal-invalid'), /proposalKey/)
  await assert.rejects(projection.has(owner, 'proposal-invalid'), /proposalKey/)
})
