import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'

interface Scope { sessionIds?: string[]; agentPresets?: string[] }
interface Scenario { sourceScope?: Scope; ruleScope?: Scope; sharedLimit?: number }
interface Recipient {
  id: string; preset?: string; catalogRules: number; pendingBeforeTurn: number
  notices: number; requestHasNotice: boolean
}
interface Harness {
  exercise(t: TestContext, scenario: Scenario): Promise<{ recipients: Recipient[]; claims: number }>
}
const alphaOne = 'scope-alpha-one', alphaTwo = 'scope-alpha-two'
const beta = 'scope-beta', unassigned = 'scope-unassigned'

/** Results come from the real Loader, SessionStore and Agent factory. */
export function registerScopeHostCases(harness: Harness): void {
  test('reminder source preset scope intersects rule sessions using real session headers', async t => {
    const result = await harness.exercise(t, { sourceScope: { agentPresets: ['alpha'] },
      ruleScope: { sessionIds: [alphaOne, beta, unassigned] } })
    for (const recipient of result.recipients) {
      const allowed = recipient.id === alphaOne
      assert.equal(recipient.catalogRules, Number(allowed), recipient.id)
      assert.equal(recipient.pendingBeforeTurn, Number(allowed), recipient.id)
      assert.equal(recipient.notices, Number(allowed), recipient.id)
      assert.equal(recipient.requestHasNotice, allowed, recipient.id)
    }
    assert.equal(result.recipients.find(item => item.id === alphaOne)?.preset, 'alpha')
    assert.equal(result.recipients.find(item => item.id === beta)?.preset, 'beta')
    assert.equal(result.recipients.find(item => item.id === unassigned)?.preset, undefined)
  })

  test('reminder rule scope ignores spoofed event presets and requires both recipient dimensions', async t => {
    const result = await harness.exercise(t, { ruleScope: {
      sessionIds: [alphaOne, alphaTwo, beta, unassigned], agentPresets: ['alpha'],
    } })
    for (const recipient of result.recipients) {
      const allowed = recipient.id === alphaOne || recipient.id === alphaTwo
      assert.equal(recipient.catalogRules, Number(allowed), recipient.id)
      assert.equal(recipient.pendingBeforeTurn, Number(allowed), recipient.id)
      assert.equal(recipient.notices, Number(allowed), recipient.id)
      assert.equal(recipient.requestHasNotice, allowed, recipient.id)
    }
  })

  test('reminder preset recipients share one durable slot across real concurrent sessions', async t => {
    const result = await harness.exercise(t, { sourceScope: { agentPresets: ['alpha'] }, sharedLimit: 1 })
    for (const recipient of result.recipients) {
      const allowed = recipient.preset === 'alpha'
      assert.equal(recipient.catalogRules, Number(allowed), recipient.id)
      assert.equal(recipient.pendingBeforeTurn, Number(allowed), recipient.id)
      assert.equal(recipient.requestHasNotice, recipient.notices === 1, recipient.id)
      if (!allowed) assert.equal(recipient.notices, 0, recipient.id)
    }
    assert.equal(result.recipients.reduce((total, item) => total + item.notices, 0), 1)
    assert.equal(result.claims, 1)
  })
}
