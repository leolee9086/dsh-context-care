import test from 'node:test'
import assert from 'node:assert/strict'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

interface Page { prompts: { id: string; seq: number; text: string }[]; total: number; offset: number; selectedFound?: boolean }
interface Harness { open(t: test.TestContext): Promise<{ session: Session; ctx: Context; page(offset: number, seq?: number): Promise<Page>; http(): Promise<void>; probe(): Promise<void> }> }

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
    await yieldToHost(); loop.disable()
    const cpu = process.cpuUsage(cpuStart)
    const report = { events: session.seq, coldPageMs, warmPageMs, selectedPageMs, incrementMs, concurrentHttpMs, otherAgentMs,
      wallMs: performance.now() - start, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
      loopMaxMs: loop.max / 1e6, loopUtilization: performance.eventLoopUtilization(loopStart).utilization, nativeReads: reads.mock.callCount() }
    t.diagnostic(`diagnostic-page-performance ${JSON.stringify(report)}`)
    assert.ok(coldPageMs < 1500 && warmPageMs < 500 && incrementMs < 500)
    assert.ok(concurrentHttpMs < 1000 && otherAgentMs < 1500 && report.loopMaxMs < 1000)
  })
}
