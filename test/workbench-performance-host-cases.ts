import test from 'node:test'
import assert from 'node:assert/strict'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Session } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'

interface Harness {
  open(t: test.TestContext): Promise<{ session: Session; configure(): Promise<void>; display(seq: number): Promise<unknown>;
    reconcile(): Promise<void>; http(): Promise<void>; probe(): Promise<void>; runs(): number; displayCalls(): number }>
}

/** Run in the real Loader composition; spy methods delegate to native Session. */
export function registerWorkbenchPerformanceCases(harness: Harness): void {
  test('long workbench history shares reads and keeps authenticated HTTP and another Agent responsive', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { session } = fixture
    const append = (text: string) => session.append('assistant/message', { turn: 1, step: 1, stream: [],
      usage: { inputTokens: 1, outputTokens: 1 }, message: createMessage({ role: 'assistant',
        source: { kind: 'model', provider: 'care-test', model: 'care-test' }, content: [{ type: 'text', text }] }) }, { surfaceOp: 'append' })
    for (let index = 0; index < 2000; index++) append(`HIST ${index} ` + 'x'.repeat(512))
    await fixture.configure()
    const snapshots = t.mock.method(session, 'snapshotEvents'), reads = t.mock.method(session, 'eventAt')
    const fullMessages = t.mock.method(session, 'deriveMessages')
    const cpuStart = process.cpuUsage(), loopStart = performance.eventLoopUtilization(), began = performance.now()
    const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable()
    t.after(() => loop.disable())
    await yieldToHost()
    const timed = async (run: () => Promise<unknown>) => { const start = performance.now(); await run(); return performance.now() - start }
    const cold = timed(() => fixture.display(session.seq - 1))
    const [coldDisplayMs, concurrentHttpMs, otherAgentMs] = await Promise.all([cold, timed(fixture.http), timed(fixture.probe)])
    const beforeWarm = reads.mock.callCount()
    const warmDisplayMs = await timed(() => fixture.display(session.seq - 1))
    assert.equal(reads.mock.callCount(), beforeWarm, 'same-cut display does not reread native events')
    const beforeRuns = fixture.runs(), beforeDisplays = fixture.displayCalls()
    for (let index = 0; index < 12; index++) append(`CURRENT_END ${index}`)
    const [reconcileMs, reconcileHttpMs] = await Promise.all([timed(fixture.reconcile), timed(fixture.http)])
    assert.equal(fixture.runs() - beforeRuns, 12, 'each current output keeps its own native occurrence')
    assert.equal(fixture.displayCalls() - beforeDisplays, 12, 'automatic display cannot replay pre-admission history')
    assert.ok(reconcileMs < 5000, `twelve new outputs took ${reconcileMs}ms`)
    const afterReconcile = reads.mock.callCount(), afterRuns = fixture.runs()
    const warmReconcileMs = await timed(fixture.reconcile)
    assert.equal(reads.mock.callCount(), afterReconcile); assert.equal(fixture.runs(), afterRuns)
    assert.equal(snapshots.mock.callCount(), 0, 'workbench never requests a complete native log snapshot')
    assert.equal(fullMessages.mock.callCount(), 0, 'workbench never derives a full transcript through a side path')
    await yieldToHost(); loop.disable()
    const cpu = process.cpuUsage(cpuStart)
    const report = { events: session.seq, coldDisplayMs, warmDisplayMs, concurrentHttpMs, otherAgentMs, reconcileMs,
      reconcileHttpMs, warmReconcileMs, wallMs: performance.now() - began, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
      loopMaxMs: loop.max / 1e6, loopUtilization: performance.eventLoopUtilization(loopStart).utilization, nativeReads: reads.mock.callCount() }
    t.diagnostic(`workbench-long-session ${JSON.stringify(report)}`)
    assert.ok(concurrentHttpMs < 1000 && reconcileHttpMs < 1000, 'unrelated authenticated HTTP must not stall for seconds')
    assert.ok(report.loopMaxMs < 1000, 'workbench must not block the Host event loop for seconds')
  })
}
