import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransformLog, TRANSFORM_EVENT } from '../src/transform-log.js'

function fixture(fail = false) {
  const rows = [], warnings = [], infos = []
  const session = { id: 'one', append() { throw new Error('custom Session events are forbidden') } }
  const ctx = { sessions: { get: id => id === 'one' ? session : undefined },
    contextCareRequests: { async recordAction(owner, data) { assert.equal(owner, session); if (fail) throw new Error('ACK failed'); rows.push(data) } },
    logger: { info: message => infos.push(message), warn: message => warnings.push(message) } }
  return { ctx, rows, warnings, infos }
}

test('rule evaluations persist complete evidence in Host storage without introducing Session event types', () => {
  const f = fixture()
  const evidence = { sessionId: 'one', layer: 'notice', ruleId: 'r', outcome: 'applied', facts: { fatigue: 85 }, version: '2' }
  createTransformLog({ ctx: f.ctx }).record(evidence)
  assert.deepEqual(f.rows, [{ ...evidence, action: 'rule-evaluation', phase: 'evaluated' }])
  assert.match(f.infos[0], /ruleId=r/)
  assert.equal(TRANSFORM_EVENT, 'context-care/transform')
})

test('journal ACK failures remain observable, and evaluations without a session do not claim durable ownership', async () => {
  const f = fixture(true)
  const log = createTransformLog({ ctx: f.ctx })
  log.record({ sessionId: 'one', ruleId: 'r', outcome: 'applied' })
  await Promise.resolve()
  assert.match(f.warnings[0], /ACK failed/)
  log.record({ ruleId: 'r', outcome: 'no-consumer' })
  assert.equal(f.infos.length, 2)
  assert.equal(f.rows.length, 0)
})
