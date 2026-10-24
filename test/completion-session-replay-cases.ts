import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { CompletionNotice } from '../src/session-completions.ts'

interface Seed {
  id: SessionId
  events: SessionEvent[]
  inheritedEventCount?: SessionLogOffset
  meta?: { isSeeded?: boolean; parentSession?: SessionId }
}
interface Output {
  blocks: { type: 'text'; text: string }[]
  failure?: { code: string; message: string }
}
interface Host {
  turn(): Promise<void>
  notices(): CompletionNotice[]
  clear(): void
  seed(): Promise<Seed>
  requests(): readonly { messages: readonly object[] }[]
}
interface Harness {
  open(t: TestContext, outputs: Output[], seed?: Seed, fork?: boolean): Promise<Host>
}
const done: Output = { blocks: [{ type: 'text', text: 'DONE' }] }
const work: Output = { blocks: [{ type: 'text', text: 'Continue the remaining authorized work.' }] }
const failed: Output = { blocks: [], failure: { code: 'NATIVE_RECEIPT_UNKNOWN', message: 'No provider output was received.' } }
const hasNotice = (request: ReturnType<Host['requests']>[number]) => /上一份输出使用了/.test(JSON.stringify(request.messages))

/** All inputs and unknown outcomes come from an actual Adapter and native Agent commits. */
export function registerCompletionReplayCases(harness: Harness) {
  test('Session completion unknown receipts remain bounded after cache clear and independent Host replay', async t => {
    const hot = await harness.open(t, [done, failed, failed, work])
    await hot.turn()
    assert.equal(hot.notices()[0]?.status, 'pending')
    await hot.turn()
    const once = hot.notices()
    assert.equal(once[0]?.status, 'delivery-unknown')
    assert.equal(once[0]?.deliveries, 1)
    assert.ok(hasNotice(hot.requests()[1]))
    hot.clear()
    assert.deepEqual(hot.notices(), once)
    const cold = await harness.open(t, [failed, work], await hot.seed())
    assert.deepEqual(cold.notices(), once)
    assert.equal(cold.requests().length, 0, 'replay does not call a model')
    await hot.turn(); await cold.turn()
    assert.ok(hasNotice(hot.requests()[2])); assert.ok(hasNotice(cold.requests()[0]))
    assert.equal(hot.notices()[0]?.deliveries, 2)
    assert.equal(cold.notices()[0]?.deliveries, 2)
    for (const host of [hot, cold]) {
      const before = host.notices()
      host.clear()
      assert.deepEqual(host.notices(), before)
      await host.turn()
      assert.equal(hasNotice(host.requests().at(-1)!), false, 'two native unknown receipts exhaust the configured allowance')
    }
  })

  test('Session completion fork ignores parent observation cooldown and preserves the child prefix on resume', async t => {
    const parent = await harness.open(t, [done])
    await parent.turn()
    assert.equal(parent.notices().length, 1)
    const child = await harness.open(t, [done], await parent.seed(), true)
    assert.deepEqual(child.notices(), [], 'readable parent wording is not a child-local observation')
    await child.turn()
    assert.equal(hasNotice(child.requests()[0]), false)
    const local = child.notices()
    assert.equal(local.length, 1)
    assert.notEqual(local[0]?.sessionId, parent.notices()[0]?.sessionId)
    child.clear()
    assert.deepEqual(child.notices(), local)
    const cold = await harness.open(t, [work], await child.seed())
    assert.deepEqual(cold.notices(), local)
    await cold.turn()
    assert.ok(hasNotice(cold.requests()[0]))
    assert.equal(cold.notices()[0]?.status, 'dispatched')
    assert.equal(cold.notices()[0]?.deliveries, 1)
  })
}
