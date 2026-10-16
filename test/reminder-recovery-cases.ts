import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'

interface Scenario {
  restart: boolean
  replace: boolean
  changed: boolean
}
interface Result { notices: number; text?: string }
interface Harness { exercise(t: TestContext, scenario: Scenario): Promise<Result> }

/** Assertions run against real persisted Loader instances supplied by the integration suite. */
export function registerRecoveryHostCases(harness: Harness): void {
  const scenarios = [
    { name: 'identical definition restores pending after restart', restart: true, replace: false, changed: false, expected: 1 },
    { name: 'changed definition discards pending after restart', restart: true, replace: false, changed: true, expected: 0 },
    { name: 'live replacement cannot revive recovered pending', restart: true, replace: true, changed: false, expected: 0 },
    { name: 'live replacement cannot revive current pending', restart: false, replace: true, changed: false, expected: 0 },
  ]
  for (const scenario of scenarios) {
    test(`reminder source recovery: ${scenario.name}`, async t => {
      const result = await harness.exercise(t, scenario)
      assert.equal(result.notices, scenario.expected)
      if (scenario.expected) assert.equal(result.text, 'RECOVERED_NOTICE')
    })
  }
}
