import test from 'node:test'
import assert from 'node:assert/strict'
import { contextBudget, resolveBudgetConfig, budgetPolicy } from '../src/context-budget.js'
import { createMaintenanceController } from '../src/maintenance-policy.js'
import { recoveryProof } from '../src/recovery-proof.js'
import { nativeSession } from './fixtures/native-session.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

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
test('recovery requires a retained replacement after the failed revision, source coverage and a frozen-price decrease', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const message = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const first = session.append('user/message', message('x'.repeat(100)), { surfaceOp: 'append' })
  const second = session.append('user/message', message('y'.repeat(100)), { surfaceOp: 'append' })
  const failed = { logRevision: session.seq, sourceSeqs: [first.seq, second.seq], sourceMessages: logs.messages(session) }
  const price = messages => messages.reduce((sum, value) => sum + value.content.reduce((n, block) => n + (block.text?.length ?? 0), 0), 0)
  const proof = (failure = failed, prices = price) => logs.withLive(session, log => recoveryProof(session, failure, prices, log, logs.messages(session)))
  assert.equal(proof().progressed, false)
  const replacement = session.append('user/message', message('small'), { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] })
  assert.equal(proof().progressed, true)
  session.append('user/message', message('tiny'), { surfaceOp: { op: 'replace', startSeq: replacement.seq, endSeq: replacement.seq }, sourceEventSeqs: [replacement.seq] })
  assert.equal(proof().progressed, true, 'a summary of a replacement retains transitive failed-source coverage')
  assert.equal(proof(failed, () => 100).progressed, false, 'no frozen-price decrease')
  assert.equal(proof({ ...failed, logRevision: session.seq }).progressed, false, 'replacement predates failed revision')
  assert.equal(proof({ ...failed, sourceSeqs: [999] }).progressed, false, 'unrelated source cannot establish progress')
})
