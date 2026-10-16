import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

interface ToolExecution { signal: AbortSignal }
type Outcome = 'timeout' | 'failure' | 'success' | 'cancel'
interface Observation { errorCode?: string; notices: number; requests: string[] }
interface Harness {
  exercise(t: TestContext, outcome: Outcome, execute: (args: object, exec: ToolExecution) => Promise<string>): Promise<Observation>
}

/** Exercise the real timeout policy and request delivery through the caller's Loader. */
export function registerTimeoutHostCases(harness: Harness): void {
  for (const outcome of ['timeout', 'failure', 'success', 'cancel'] as const) {
    test(`tool timeout reminder through real Loader: ${outcome}`, { timeout: 30000 }, async t => {
      const observation = await harness.exercise(t, outcome, async (_args, exec) => {
        if (outcome === 'failure') throw new Error('ordinary failure mentioning TOOL_TIMEOUT')
        if (outcome === 'success') return 'successful content mentioning TOOL_TIMEOUT'
        await delay(10000, undefined, { signal: exec.signal })
        return 'finished'
      })
      assert.equal(observation.notices, outcome === 'timeout' ? 1 : 0)
      if (outcome === 'timeout') {
        assert.equal(observation.errorCode, 'TOOL_TIMEOUT')
        assert.doesNotMatch(observation.requests[0] ?? '', /TIMEOUT_ONLY_NOTICE/)
        assert.match(observation.requests[1] ?? '', /TIMEOUT_ONLY_NOTICE/)
      } else {
        assert.notEqual(observation.errorCode, 'TOOL_TIMEOUT')
        assert.ok(observation.requests.every(request => !request.includes('TIMEOUT_ONLY_NOTICE')))
      }
    })
  }
}
