import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaintenanceController, pruneThenMeasure, resolveMaintenanceConfig } from '../src/maintenance-policy.js'

test('hard pressure arms once and hysteresis clears below recovery', () => {
  const controller = createMaintenanceController({ softBudgetRatio: 0.7, hardBudgetRatio: 0.8, hysteresisRatio: 0.1 })
  assert.equal(controller.observe(790, 1000).shouldMaintain, false)
  assert.equal(controller.observe(800, 1000).shouldMaintain, true)
  assert.equal(controller.observe(750, 1000).shouldMaintain, true)
  assert.equal(controller.observe(599, 1000).shouldMaintain, false)
  assert.equal(controller.observe(600, 1000).shouldMaintain, false)
})

test('unknown capacity never triggers maintenance', () => {
  const controller = createMaintenanceController()
  assert.deepEqual(controller.observe(999, undefined), {
    phase: 'unknown', ratio: null, shouldMaintain: false, armed: false,
  })
})

test('configuration rejects inverted budgets and non-positive pass counts', () => {
  assert.throws(() => resolveMaintenanceConfig({ softBudgetRatio: 0.9, hardBudgetRatio: 0.8 }), /softBudgetRatio/)
  assert.throws(() => resolveMaintenanceConfig({ maxPasses: 0 }), /maxPasses/)
})

test('pruneThenMeasure always measures after a committed prune', async () => {
  const values = [
    { totalTokens: 900, capacity: 1000 },
    { totalTokens: 500, capacity: 1000 },
  ]
  let calls = 0
  const session = {}
  const controller = createMaintenanceController()
  const result = await pruneThenMeasure({
    session,
    controller,
    measure: async () => values[calls++],
    pruner: { pruneSession(received) { assert.equal(received, session); return { pruned: [{ originalSeq: 1 }] } } },
  })
  assert.equal(calls, 2)
  assert.equal(result.pruned.pruned.length, 1)
  assert.equal(result.after.totalTokens, 500)
  assert.equal(result.pressure.shouldMaintain, false)
})

test('prune failure remains visible and skips the compaction decision', async () => {
  const error = new Error('prune failed')
  await assert.rejects(() => pruneThenMeasure({
    session: {},
    controller: createMaintenanceController(),
    measure: async () => ({ totalTokens: 900, capacity: 1000 }),
    pruner: { pruneSession() { throw error } },
  }), error)
})
