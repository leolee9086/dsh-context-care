import test from 'node:test'
import assert from 'node:assert/strict'
import { runMaintenance } from '../src/maintenance-journal.js'
import { nativeSession } from './fixtures/native-session.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
const message = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

test('a failed audit reports its own error while keeping the primary maintenance failure', async t => {
  const { sessions, logs: history } = nativeSession(t), session = sessions.create()
  session.append('user/message', message('before'), { surfaceOp: 'append' })
  const reported = []; t.mock.method(console, 'error', (...args) => reported.push(args))
  const primary = Object.assign(new Error('Original provider failure'), { code: 'PROVIDER_FAILURE' }), secondary = new Error('Storage write failed')
  let writes = 0
  await assert.rejects(runMaintenance({ history, requests: { async recordAction() { if (++writes === 2) throw secondary } }, session,
    pricing: { measure: () => ({ inputTokens: 100, nodes: [{ heuristicTokens: 100 }] }) }, action: 'prune', reason: 'test',
    run: async () => { throw primary } }), error => error === primary)
  assert.equal(primary.code, 'PROVIDER_FAILURE'); assert.equal(primary.message, 'Original provider failure')
  assert.deepEqual(primary.secondaryFailures, [{ phase: 'maintenance audit', code: undefined, message: 'Storage write failed' }])
  assert.equal(reported[0][1], secondary)
})

test('failed maintenance records its committed reduction while returning the original error', async t => {
  const { sessions, logs: history } = nativeSession(t), session = sessions.create()
  const sources = ['one', 'two'].map(text => session.append('user/message', message(text), { surfaceOp: 'append' }).seq)
  let input = 1000
  const records = [], original = new Error('summary failed after committed prune')
  const pricing = { pricingBasis: { textScale: 3 }, measure: () => ({ inputTokens: input, nodes: [{ heuristicTokens: input / 3 }] }) }
  await assert.rejects(runMaintenance({ history, requests: { recordAction: async (_session, data) => records.push(data) },
    session, pricing, action: 'prune', reason: 'overflow', run: async () => {
      session.append('user/message', message('retained reduction'), { surfaceOp: { op: 'replace', startSeq: sources[0], endSeq: sources[1] }, sourceEventSeqs: sources })
      input = 400; throw original
    } }), error => error === original)
  assert.equal(records[1].progressed, true); assert.equal(records[1].beforeInput, 1000); assert.equal(records[1].afterInput, 400)
  assert.equal(records[1].operationId, records[0].operationId); assert.deepEqual(records[1].sourceSeqs, sources)
  assert.equal(records[1].replacements[0].newSeq, session.seq - 1)
})

test('deep rest records completion after its synchronous replacement commit', async t => {
  const { sessions, logs: history } = nativeSession(t), session = sessions.create()
  const source = session.append('user/message', message('before'), { surfaceOp: 'append' })
  const phases = []; let input = 1000
  const result = await runMaintenance({ history, requests: { recordAction: async (_session, data) => phases.push(data) }, session,
    pricing: { measure: () => ({ inputTokens: input, nodes: [{ heuristicTokens: input / 3 }] }), pricingBasis: { textScale: 1 } }, action: 'deep-rest', reason: 'requested',
    run: () => {
      session.append('user/message', message('after'), { surfaceOp: { op: 'replace', startSeq: source.seq, endSeq: source.seq }, sourceEventSeqs: [source.seq] })
      input = 100; return { compactionId: 'one' }
    } })
  assert.equal(result.compactionId, 'one'); assert.equal(phases[1].compactionId, 'one'); assert.equal(phases[1].phase, 'completed'); assert.equal(phases[1].progressed, true)
})
