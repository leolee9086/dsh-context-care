import test from 'node:test'
import assert from 'node:assert/strict'
import { contextBudget, resolveBudgetConfig, budgetPolicy } from '../src/context-budget.js'
import { createMaintenanceController } from '../src/maintenance-policy.js'
import { recoveryProof } from '../src/recovery-proof.js'

const deployment = { physicalCapacity: 1048576, policyCapacity: 262144, maxTokens: 8192, safetyTokens: 2048, burstTokens: 8192, releaseMarginTokens: 4096, softRatio: 0.8, retainRatio: 0.16 }
test('combined policy limits preserve actual capacity and reserve output once', () => {
  const budget = contextBudget({ ...deployment, inputTokens: 280000 })
  assert.equal(budget.capacity, 262144)
  assert.equal(budget.physicalCapacity, 1048576)
  assert.equal(budget.hardInput, 251904)
  assert.equal(budget.softInput, 209715)
  assert.equal(budget.releaseTarget, 205619)
  assert.equal(budget.budgetKind, 'policy')
  assert.equal(budget.physicalDeficit, 0)
  assert.equal(contextBudget({ ...deployment, inputTokens: 1100000 }).budgetKind, 'both')
})
test('billing ceiling applies safety once and unknown capacity still allows dispatch', () => {
  assert.equal(contextBudget({ ...deployment, billingInputCeilingTokens: 240000, inputTokens: 235000 }).hardInput, 237952)
  assert.equal(contextBudget({ inputTokens: 50000 }).hardInput, undefined)
  assert.equal(contextBudget({ ...deployment, maxTokens: undefined, defaultMaxTokens: 4000, inputTokens: 1 }).completionSource, 'adapter-default')
  assert.equal(contextBudget({ physicalCapacity: 10000, inputTokens: 1 }).completionSource, 'absent')
  assert.throws(() => contextBudget({ ...deployment, maxTokens: 262144, inputTokens: 1 }), /invalid resolved budget/)
  assert.throws(() => resolveBudgetConfig({ safetyTokens: -1 }), /safetyTokens/)
})
test('maintenance starts at soft and continues below soft until strictly below release', () => {
  const controller = createMaintenanceController()
  const observe = inputTokens => controller.observeBudget(contextBudget({ ...deployment, inputTokens }))
  assert.equal(observe(209714).shouldMaintain, false)
  assert.equal(observe(209715).shouldMaintain, true)
  assert.equal(observe(205619).shouldMaintain, true)
  assert.equal(observe(205618).shouldMaintain, false)
})
test('exact route and purpose policies reject duplicate declarations', () => {
  const route = { provider: 'p', model: 'm', purpose: 'conversation', contextBudgetTokens: 262144 }
  assert.throws(() => resolveBudgetConfig({ routeBudgets: [route, route] }), /duplicate/)
  const spec = resolveBudgetConfig({ routeBudgets: [route] })
  assert.equal(budgetPolicy(spec, route).contextBudgetTokens, 262144)
  assert.equal(budgetPolicy(spec, route, 'compaction').contextBudgetTokens, undefined)
  assert.equal(budgetPolicy(spec, { provider: 'other', model: 'm' }).contextBudgetTokens, undefined)
})
test('recovery requires a retained replacement after the failed revision, source coverage and a frozen-price decrease', () => {
  const failed = { logRevision: 10, sourceSeqs: [1, 2], sourceMessages: [{ cost: 100 }] }
  let event = { seq: 11, sourceEventSeqs: [1], surfaceOp: { op: 'replace' } }
  let cost = 50
  let ancestors = []
  const session = { surface: { nodes: [11, 2] }, snapshotEvents: () => [event, ...ancestors], deriveMessages: () => [{ cost }] }
  const price = messages => messages.reduce((sum, value) => sum + value.cost, 0)
  assert.equal(recoveryProof(session, failed, price).progressed, true)
  event = { ...event, sourceEventSeqs: [10] }
  ancestors = [{ seq: 10, sourceEventSeqs: [1] }]
  assert.equal(recoveryProof(session, failed, price).progressed, true, 'Summary of a pruned replacement retains transitive failed-source coverage')
  ancestors = []
  event = { ...event, sourceEventSeqs: [1] }
  cost = 100
  assert.equal(recoveryProof(session, failed, price).progressed, false)
  cost = 50
  event = { ...event, seq: 9 }
  assert.equal(recoveryProof(session, failed, price).progressed, false)
  event = { ...event, seq: 11, sourceEventSeqs: [7] }
  assert.equal(recoveryProof(session, failed, price).progressed, false)
})
