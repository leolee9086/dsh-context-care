import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMaintenanceRange } from '../src/selection.js'
import { checkpointCoverage } from '../src/checkpoint-coverage.js'
import { createProposalExecutor } from '../src/summary-proposals.js'
import { resolveConfig } from '../src/policy.js'

const user = (seq, kind = 'user') => ({ seq, type: 'user/message', data: { role: 'user', source: { kind }, content: [{ type: 'text', text: `Material ${seq}` }] } })
function history(events) {
  return { id: 's', surface: { nodes: events.map(event => event.seq) }, eventAt: seq => events.find(event => event.seq === seq),
    deriveEventMessage: event => event.data, snapshotEvents: () => events }
}
const policy = { retainTokens: 100, minFreshTokens: 100, pluginName: 'dsh-context-care', rangeStrategy: 'basic-prefix' }
const measure = session => ({ nodes: session.surface.nodes.map(seq => ({ seq, tokens: 100 })) })

test('fresh prefixes precede checkpoint merges and target selection uses the smallest covering prefix', () => {
  const session = history([user(1), user(2), user(3), user(4)])
  assert.equal(selectMaintenanceRange(session, measure(session), policy).end, 3)
  const target = selectMaintenanceRange(session, measure(session), { ...policy, rangeStrategy: 'target-prefix', expectedCheckpointTokens: 50, deficitTokens: 130 })
  assert.equal(target.end, 2)
  assert.equal(target.expectedSaving, 150)
  assert.equal(target.coversDeficit, true)
  assert.equal(selectMaintenanceRange(session, measure(session), { ...policy, rangeStrategy: 'target-prefix', expectedCheckpointTokens: 50, deficitTokens: 1000 }).end, 3)
  assert.throws(() => resolveConfig({ rangeStrategy: 'target-prefix' }), /requires expectedCheckpointTokens/)
  assert.throws(() => resolveConfig({ maxSummaryRepairRetries: -1 }), /invalid maxSummaryRepairRetries/)
})

test('two checkpoints separated by status can merge, one cannot satisfy explicit rest, and pressure retains its fallback', () => {
  const session = history([user(1, 'compact-checkpoint'), user(2, 'plugin:dsh-context-care:state'), user(3, 'compact-checkpoint'), user(4)])
  assert.equal(selectMaintenanceRange(session, measure(session), { ...policy, allowFallback: false }).rule, 'checkpoint-merge')
  session.surface.nodes = [1, 2, 4]
  assert.equal(selectMaintenanceRange(session, measure(session), { ...policy, allowFallback: false }), null)
  assert.equal(selectMaintenanceRange(session, measure(session), policy).rule, 'basic-prefix')
  session.surface.nodes = [1, 2, 3, 4]
  session.eventAt(2).data.source.kind = 'user'
  assert.equal(selectMaintenanceRange(session, measure(session), policy).rule, 'fresh-summary')
})

test('checkpoint coverage expands prior summaries and prune references in source order without transaction leaves', () => {
  const events = [user(1), { seq: 2, type: 'tool/result', data: {} }, { ...user(3), sourceEventSeqs: [2], surfaceOp: { op: 'replace' } },
    { seq: 4, type: 'compaction/start', data: { compactionId: 'a' } },
    { seq: 5, type: 'compaction/summary', data: { compactionId: 'a', shadowedSeqs: [1, 3] } },
    { ...user(6, 'compact-checkpoint'), data: { ...user(6).data, source: { kind: 'compact-checkpoint', compactionId: 'a' } }, sourceEventSeqs: [4, 5, 1, 3], surfaceOp: { op: 'replace' } },
    user(7), { seq: 8, type: 'compaction/summary', data: { compactionId: 'b', shadowedSeqs: [6, 7] } },
    { ...user(9, 'compact-checkpoint'), data: { ...user(9).data, source: { kind: 'compact-checkpoint', compactionId: 'b' } }, sourceEventSeqs: [8, 6, 7], surfaceOp: { op: 'replace' } }]
  assert.deepEqual(checkpointCoverage(history(events), 9), { leafSeqs: [1, 2, 7], parentCheckpointSeqs: [6], depth: 2 })
})

test('durable no-useful decisions ignore status and log growth but reset on task material or frozen prices', async () => {
  const session = history([user(1), user(2, 'plugin:dsh-context-care:state')])
  const records = []
  const requests = { list: () => records, recordAction: async (_session, data) => records.push({ kind: 'maintenance', data }) }
  let calls = 0
  const execute = createProposalExecutor(requests, async () => { calls++; throw Object.assign(new Error('larger checkpoint'), { code: 'SUMMARY_NOT_SMALLER' }) })
  let scale = 1
  const operation = { pricingBasis: { header: { config: { provider: 'p', model: 'm' } } }, priceMessages: () => 100 * scale }
  const proposal = { sourceSeqs: [1, 2], start: 1, end: 2, rule: 'fresh-summary', comparisons: [] }
  const run = () => execute({ config: {} }, proposal, { session }, new AbortController().signal, operation, {})
  await assert.rejects(run(), /larger checkpoint/)
  session.eventAt(2).data.content[0].text = 'New status, same actual task'
  assert.equal(await run(), null)
  assert.equal(calls, 1)
  scale = 2
  await assert.rejects(run(), /larger checkpoint/)
  session.eventAt(1).data.content[0].text = 'New actual work'
  await assert.rejects(run(), /larger checkpoint/)
  assert.equal(calls, 3)
})
