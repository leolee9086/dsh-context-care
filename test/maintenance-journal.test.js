import test from 'node:test'
import assert from 'node:assert/strict'
import { runMaintenance } from '../src/maintenance-journal.js'

test('a failed audit reports its own error while keeping the primary maintenance failure', async t => {
  const reported = []
  t.mock.method(console, 'error', (...args) => reported.push(args))
  const primary = Object.assign(new Error('Original provider failure'), { code: 'PROVIDER_FAILURE' })
  const secondary = new Error('Storage write failed')
  let writes = 0
  const session = { id: 's', seq: 1, surface: { nodes: [0], replaceGeneration: 0 }, snapshotEvents: () => [] }
  await assert.rejects(runMaintenance({ requests: { async recordAction() { if (++writes === 2) throw secondary } }, session,
    pricing: { measure: () => ({ inputTokens: 100, nodes: [{ heuristicTokens: 100 }] }) }, action: 'prune', reason: 'test',
    run: async () => { throw primary } }), error => error === primary)
  assert.equal(primary.code, 'PROVIDER_FAILURE')
  assert.equal(primary.message, 'Original provider failure')
  assert.deepEqual(primary.secondaryFailures, [{ phase: 'maintenance audit', code: undefined, message: 'Storage write failed' }])
  assert.equal(reported[0][1], secondary)
})

test('failed maintenance records its committed reduction while returning the original error', async () => {
  const session = { id: 's1', seq: 4, surface: { nodes: [1, 2], replaceGeneration: 0 }, snapshotEvents: () => session.seq > 4 ? [{ seq: 4, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 }, sourceEventSeqs: [1, 2] }] : [] }
  let input = 1000
  const records = []
  const pricing = { pricingBasis: { textScale: 3 }, measure: () => ({ inputTokens: input, nodes: [{ heuristicTokens: input / 3 }] }) }
  const original = new Error('summary failed after committed prune')
  await assert.rejects(runMaintenance({ requests: { recordAction: async (_session, data) => records.push(data) },
    session, pricing, action: 'prune', reason: 'overflow', run: async () => {
      session.surface.replaceGeneration++
      session.seq++
      input = 400
      throw original
    } }), error => error === original)
  assert.equal(records[1].progressed, true)
  assert.equal(records[1].beforeInput, 1000)
  assert.equal(records[1].afterInput, 400)
  assert.equal(records[1].operationId, records[0].operationId)
  assert.deepEqual(records[1].sourceSeqs, [1, 2])
})

test('deep rest records completion after its synchronous replacement commit', async () => {
  const session = { id: 's1', seq: 4, surface: { nodes: [1], replaceGeneration: 0 }, snapshotEvents: () => session.surface.replaceGeneration ? [{ seq: 4, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, sourceEventSeqs: [1] }] : [] }
  const phases = []
  let input = 1000
  const result = await runMaintenance({ requests: { recordAction: async (_session, data) => phases.push(data) }, session,
    pricing: { measure: () => ({ inputTokens: input, nodes: [{ heuristicTokens: input / 3 }] }), pricingBasis: { textScale: 1 } }, action: 'deep-rest', reason: 'requested',
    run: () => { input = 100; session.surface.replaceGeneration++; return { compactionId: 'one' } } })
  assert.equal(result.compactionId, 'one')
  assert.equal(phases[1].compactionId, 'one')
  assert.equal(phases[1].phase, 'completed')
  assert.equal(phases[1].progressed, true)
})
