import test from 'node:test'
import assert from 'node:assert/strict'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
import { ensureSessionLog } from '../lib/session-log.js'

interface Page { prompts: { id: string; seq: number; text: string }[]; total: number; offset: number; selectedFound?: boolean }
interface Harness { open(t: test.TestContext): Promise<{ session: Session; ctx: Context; page(offset: number, seq?: number): Promise<Page>; phase(index: number): Promise<void>; http(): Promise<void>; probe(): Promise<void> }> }

/** Real HTTP bodies and Agent work run beside actual native long-history queries. */
export function registerDiagnosticPerformanceCases(harness: Harness): void {
  test('long diagnostic pages share native reads while HTTP and another Agent remain responsive', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { session } = fixture
    const append = (index: number) => session.append('user/message', createUserMessage({ source: { kind: 'plugin:dsh-context-care:state' },
      content: [{ type: 'text', text: `PAGE ${index} ` + 'x'.repeat(4096) }] }), { surfaceOp: 'append' })
    for (let index = 0; index < 6000; index++) append(index)
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents')
    const cpuStart = process.cpuUsage(), loopStart = performance.eventLoopUtilization(), start = performance.now()
    const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); t.after(() => loop.disable())
    await yieldToHost()
    const timed = async (run: () => Promise<unknown>) => { const began = performance.now(); await run(); return performance.now() - began }
    let cold: Page | undefined
    const [coldPageMs, concurrentHttpMs, otherAgentMs] = await Promise.all([timed(async () => { cold = await fixture.page(0) }), timed(fixture.http), timed(fixture.probe)])
    assert.ok(cold); assert.equal(cold.total, 6000); assert.equal(cold.prompts.length, 20); assert.match(cold.prompts[0].text, /^PAGE 5999 /)
    const count = reads.mock.callCount()
    const warmPageMs = await timed(async () => { assert.deepEqual(await fixture.page(0), cold) })
    assert.equal(reads.mock.callCount(), count, 'HTTP shares request history and page event reads')
    const selectedPageMs = await timed(async () => {
      const page = await fixture.page(0, 10)
      assert.equal(page.offset, 5980); assert.equal(page.selectedFound, true)
      assert.ok(page.prompts.some(item => item.seq === 10))
    })
    assert.equal(reads.mock.callCount(), count, 'page navigation uses indexed metadata, not native history rereads')
    const added = append(6000)
    const incrementMs = await timed(async () => { const page = await fixture.page(0); assert.equal(page.total, 6001); assert.equal(page.prompts[0].seq, added.seq) })
    assert.equal(reads.mock.callCount() - count, 1, 'only one new native fact is fetched across all consumers')
    assert.equal(snapshots.mock.callCount(), 0)
    for (let index = 0; index < 1000; index++) session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createMessage({
      role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' }, content: [{ type: 'text', text: 'settled answer' }] }) }, { surfaceOp: 'append' })
    const settlementPageMs = await timed(async () => { assert.equal((await fixture.page(0)).total, 6001) })
    const settledReads = reads.mock.callCount()
    const work = () => ensureSessionLog(fixture.ctx).cache.report().filter(row => row.name === 'request-cache').reduce((sum, row) => sum + row.work, 0)
    const beforeWork = work()
    // Actual accepted diagnostics change while the settled request directory is
    // fixed. Neither HTTP nor subscriptions may rematerialize that directory.
    const [livePhaseMs, liveHttpMs, liveOtherAgentMs] = await Promise.all([timed(async () => {
      for (let index = 0; index < 20; index++) {
        await fixture.phase(index)
        assert.equal((await fixture.page(0)).total, 6001)
      }
    }), timed(fixture.http), timed(fixture.probe)])
    assert.equal(reads.mock.callCount(), settledReads, 'changing diagnostics never rereads native history')
    assert.equal(work(), beforeWork, 'changing unrelated diagnostics never reparses settled public records')
    await yieldToHost(); loop.disable()
    const cpu = process.cpuUsage(cpuStart)
    const report = { events: session.seq, coldPageMs, warmPageMs, selectedPageMs, incrementMs, concurrentHttpMs, otherAgentMs,
      settlementPageMs, livePhaseMs, liveHttpMs, liveOtherAgentMs,
      wallMs: performance.now() - start, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
      loopMaxMs: loop.max / 1e6, loopUtilization: performance.eventLoopUtilization(loopStart).utilization, nativeReads: reads.mock.callCount() }
    t.diagnostic(`diagnostic-page-performance ${JSON.stringify(report)}`)
    assert.ok(coldPageMs < 1500 && warmPageMs < 500 && incrementMs < 500)
    assert.ok(concurrentHttpMs < 1000 && otherAgentMs < 1500 && report.loopMaxMs < 1000)
    assert.ok(livePhaseMs < 1500 && liveHttpMs < 1000 && liveOtherAgentMs < 1500)
  })
}
