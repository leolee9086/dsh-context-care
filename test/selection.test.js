import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMaintenanceRange } from '../src/selection.js'
import { checkpointCoverage } from '../src/checkpoint-coverage.js'
import { createProposalExecutor } from '../src/summary-proposals.js'
import { resolveConfig } from '../src/policy.js'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createSummaryProposalHistory, summaryProposalRecord } from '../lib/summary-proposal-history.js'
import { nativeSession } from './fixtures/native-session.ts'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
const user = (text, kind = 'user') => createUserMessage({ source: { kind }, content: [{ type: 'text', text: `Material ${text}` }] })
const appendUsers = (session, kinds) => kinds.map((kind, index) => session.append('user/message', user(index, kind), { surfaceOp: 'append' }))
const select = (logs, session, measurement, policy) => logs.withLive(session, log => selectMaintenanceRange(session, measurement, policy, log))

const policy = { retainTokens: 100, minFreshTokens: 100, pluginName: 'dsh-context-care', rangeStrategy: 'basic-prefix' }
const measure = session => ({ nodes: session.surface.nodes.map(seq => ({ seq, tokens: 100 })) })

test('fresh prefixes precede checkpoint merges and target selection uses the smallest covering prefix', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const events = appendUsers(session, ['user', 'user', 'user', 'user'])
  assert.equal(select(logs, session, measure(session), policy).end, events[2].seq)
  const target = select(logs, session, measure(session), { ...policy, rangeStrategy: 'target-prefix', expectedCheckpointTokens: 50, deficitTokens: 130 })
  assert.equal(target.end, events[1].seq)
  assert.equal(target.expectedSaving, 150)
  assert.equal(target.coversDeficit, true)
  assert.equal(select(logs, session, measure(session), { ...policy, rangeStrategy: 'target-prefix', expectedCheckpointTokens: 50, deficitTokens: 1000 }).end, events[2].seq)
  assert.throws(() => resolveConfig({ rangeStrategy: 'target-prefix' }), /requires expectedCheckpointTokens/)
  assert.throws(() => resolveConfig({ maxSummaryRepairRetries: -1 }), /invalid maxSummaryRepairRetries/)
})

test('large maintenance selection accumulates candidate metrics in linear work without prefix arrays', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const events = appendUsers(session, Array(2000).fill('user')), reads = t.mock.method(session, 'eventAt')
  const selected = select(logs, session, measure(session), policy)
  assert.equal(selected.end, events[1998].seq)
  assert.equal(selected.sourceSeqs.length, 1999)
  assert.equal(selected.comparisons.length, 1999)
  assert.equal(selected.comparisons.every(candidate => !Object.hasOwn(candidate, 'sourceSeqs')), true,
    'diagnostic comparisons retain scalar metrics, not overlapping copied prefixes')
  assert.ok(reads.mock.callCount() <= events.length * 4, `native event reads remain linear: ${reads.mock.callCount()}`)
})

test('two checkpoints separated by status can merge, one cannot satisfy explicit rest, and pressure retains its fallback', t => {
  const { sessions, logs } = nativeSession(t), merged = sessions.create()
  appendUsers(merged, ['compact-checkpoint', 'plugin:dsh-context-care:state', 'compact-checkpoint', 'user'])
  assert.equal(select(logs, merged, measure(merged), { ...policy, allowFallback: false }).rule, 'checkpoint-merge')
  const single = sessions.create(); appendUsers(single, ['compact-checkpoint', 'plugin:dsh-context-care:state', 'user'])
  assert.equal(select(logs, single, measure(single), { ...policy, allowFallback: false }), null)
  assert.equal(select(logs, single, measure(single), policy).rule, 'basic-prefix')
  const fresh = sessions.create(); appendUsers(fresh, ['compact-checkpoint', 'user', 'compact-checkpoint', 'user'])
  assert.equal(select(logs, fresh, measure(fresh), policy).rule, 'fresh-summary')
})

test('checkpoint coverage expands prior summaries and prune references in source order without transaction leaves', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const first = session.append('user/message', user('first'), { surfaceOp: 'append' })
  const callId = ToolCallId('covered'), result = session.append('tool/result', { turn: 0, step: 0, message: createToolResultMessage({ callId, content: [], isError: false }) }, { surfaceOp: 'append' })
  const pruned = session.append('user/message', user('pruned'), { surfaceOp: { op: 'replace', startSeq: result.seq, endSeq: result.seq }, sourceEventSeqs: [result.seq] })
  const start = session.append('compaction/start', { compactionId: 'a', turn: 0 })
  const summary = session.append('compaction/summary', { compactionId: 'a', shadowedSeqs: [first.seq, pruned.seq] })
  const parent = session.append('user/message', createUserMessage({ source: { kind: 'compact-checkpoint', compactionId: 'a' }, content: [{ type: 'text', text: 'first summary' }] }),
    { sourceEventSeqs: [start.seq, summary.seq, first.seq, pruned.seq], surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: pruned.seq } })
  const last = session.append('user/message', user('last'), { surfaceOp: 'append' })
  const second = session.append('compaction/summary', { compactionId: 'b', shadowedSeqs: [parent.seq, last.seq] })
  const final = session.append('user/message', createUserMessage({ source: { kind: 'compact-checkpoint', compactionId: 'b' }, content: [{ type: 'text', text: 'second summary' }] }),
    { sourceEventSeqs: [second.seq, parent.seq, last.seq], surfaceOp: { op: 'replace', startSeq: parent.seq, endSeq: last.seq } })
  assert.deepEqual(logs.withLive(session, log => checkpointCoverage(session, final.seq, log)),
    { leafSeqs: [first.seq, result.seq, last.seq], parentCheckpointSeqs: [parent.seq], depth: 2 })
})

test('native no-useful decisions ignore status and log growth but reset on task material or frozen prices', async t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create(SessionId('proposal-fingerprint')), records = []
  const rejected = createSummaryProposalHistory({ readSession: id => logs.read(id) }, logs); t.after(() => rejected.close())
  const append = (type, data, options) => { const event = session.append(type, data, options); rejected.observe(session, event); return event }
  const task = append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Initial task' }] }), { surfaceOp: 'append' })
  const status = append('user/message', createUserMessage({ source: { kind: 'plugin:dsh-context-care:state' }, content: [{ type: 'text', text: 'Initial status' }] }), { surfaceOp: 'append' })
  const requests = { list: () => { throw new Error('action cache must not decide proposal eligibility') },
    wasProposalRejected: (owner, key, signal) => rejected.has(owner, key, signal),
    recordAction: async (_session, data) => records.push({ kind: 'maintenance', data }) }
  let calls = 0
  const execute = createProposalExecutor(requests, async (...args) => {
    calls++
    const audit = args[6], compactionId = `non-shrinking-${calls}`
    append('compaction/start', { compactionId, turn: 0, ...summaryProposalRecord(audit.proposalKey) })
    append('compaction/end', { compactionId, turn: 0, error: 'larger checkpoint', ...summaryProposalRecord(audit.proposalKey, 'SUMMARY_NOT_SMALLER') })
    throw Object.assign(new Error('larger checkpoint'), { code: 'SUMMARY_NOT_SMALLER' })
  }, logs)
  let scale = 1
  const operation = { pricingBasis: { header: { config: { provider: 'p', model: 'm' } } }, priceMessages: () => 100 * scale }
  const proposal = { sourceSeqs: [task.seq, status.seq], start: task.seq, end: status.seq, rule: 'fresh-summary', comparisons: [] }
  const run = () => execute({ config: {} }, proposal, { session }, new AbortController().signal, operation, {})
  await assert.rejects(run(), /larger checkpoint/)
  const nextStatus = append('user/message', createUserMessage({ source: { kind: 'plugin:dsh-context-care:state' }, content: [{ type: 'text', text: 'New status, same actual task' }] }), { surfaceOp: 'append' })
  proposal.sourceSeqs[1] = nextStatus.seq
  assert.equal(await run(), null)
  assert.equal(calls, 1)
  scale = 2
  await assert.rejects(run(), /larger checkpoint/)
  const nextTask = append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'New actual work' }] }), { surfaceOp: 'append' })
  proposal.sourceSeqs[0] = nextTask.seq
  await assert.rejects(run(), /larger checkpoint/)
  assert.equal(calls, 3)
  const first = records[0].data
  assert.ok(first.operationId)
  assert.equal(records[1].data.operationId, first.operationId)
  assert.equal(records[1].data.phase, 'no-useful-range')
  rejected.close()
})

test('selection and executor share trigger identity and settle failures before a summary transaction starts', async t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create(), records = []
  let captured
  const source = session.append('user/message', user('source'), { surfaceOp: 'append' })
  const requests = { wasProposalRejected: async () => false, recordAction: async (_session, data) => records.push(data) }
  const execute = createProposalExecutor(requests, async (...args) => { captured = args[6]; throw new Error('failed before start') }, logs)
  await assert.rejects(execute({ config: {} }, { sourceSeqs: [source.seq], rule: 'fresh-summary' }, { session }, new AbortController().signal,
    { priceMessages: () => 100, pricingBasis: { header: {} } }, {}, 'requested'), /failed before start/)
  assert.equal(captured.operationId, records[0].operationId)
  assert.equal(captured.reason, 'requested')
  assert.equal(records.at(-1).operationId, captured.operationId)
  assert.equal(records.at(-1).phase, 'failed')
})
