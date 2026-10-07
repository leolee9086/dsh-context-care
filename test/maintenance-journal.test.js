import test from 'node:test'
import assert from 'node:assert/strict'
import { runMaintenance } from '../src/maintenance-journal.js'

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
