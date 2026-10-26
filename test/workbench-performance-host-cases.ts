import test from 'node:test'
import assert from 'node:assert/strict'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Session } from '@deepseek-ai/dsh-session'
import { createMessage, createToolResultMessage, ToolCallId, type GenerateOptions } from '@deepseek-ai/dsh-llm'

interface Harness {
  open(t: test.TestContext): Promise<{ session: Session; configure(filters?: boolean | 'cascade'): Promise<void>; display(seq: number): Promise<unknown>;
    preview(request: GenerateOptions): Promise<{ request: GenerateOptions; applied: unknown[]; records: { cascadePass?: number }[] }>; cacheNames(): string[]; projectionWork(): number; actionWork(): number; byteSerializations(request: GenerateOptions): number; numericComparisons(): number; removalCollators(): number; catalogReads(): number; recordReads(): number; tokenReads(): number; pauseFilter(paused: boolean): Promise<void>;
    reconcile(): Promise<void>; http(): Promise<void>; probe(): Promise<void>; runs(): number; displayCalls(): number }>
}

/** Run in the real Loader composition; spy methods delegate to native Session. */
export function registerWorkbenchPerformanceCases(harness: Harness): void {
  test('long native cascade projects each unchanged message body once and only adds new injected bodies', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { session } = fixture
    const request: GenerateOptions = { provider: 'care-test', model: 'care-test', system: 'SYSTEM', messages: [] }
    for (let index = 0; index < 1000; index++) {
      const message = createMessage({ role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: index === 999 ? 'START_CHAIN' : `HIST ${index} ` + 'x'.repeat(256) }] })
      session.append('user/message', message, { surfaceOp: 'append' }); request.messages.push(message)
    }
    await fixture.configure('cascade')
    const before = structuredClone(request), initiallyFrozen = Object.isFrozen(request.messages[0].content[0]), nativeReads = t.mock.method(session, 'eventAt')
    const snapshots = t.mock.method(session, 'snapshotEvents'), derive = t.mock.method(session, 'deriveMessages')
    const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); t.after(() => loop.disable())
    await yieldToHost(); const cpuStart = process.cpuUsage(), began = performance.now(), workBefore = fixture.projectionWork()
    const timed = async (run: () => Promise<unknown>) => { const start = performance.now(); const value = await run(); return { ms: performance.now() - start, value } }
    const [planned, http, other] = await Promise.all([timed(() => fixture.preview(request)), timed(fixture.http), timed(fixture.probe)])
    const result = planned.value as Awaited<ReturnType<typeof fixture.preview>>
    t.diagnostic(`workbench-model-cascade-timing ${JSON.stringify({ planMs: planned.ms, httpMs: http.ms, otherAgentMs: other.ms, bodyProjections: fixture.projectionWork() - workBefore })}`)
    assert.equal(result.applied.length, 3, JSON.stringify(result.records)); assert.equal(result.records.filter(row => row.cascadePass).length, 2)
    assert.equal(result.request.messages.length, 1003)
    assert.deepEqual(result.request.messages.slice(-3).map(message => message.content[0]).map(block => block.type === 'text' ? block.text : ''), ['SECOND_LINK', 'THIRD_LINK', 'FINAL_LINK'])
    const byteSerializations = fixture.byteSerializations(request)
    assert.equal(byteSerializations, 4, 'complete baseline plus three distinct cascade candidates are each serialized once')
    const projected = fixture.projectionWork() - workBefore
    assert.equal(projected, 1003, '1000 input messages + one system + two newly inspected injections, never the cloned historical bodies again')
    assert.deepEqual(request, before); assert.equal(Object.isFrozen(request.messages[0].content[0]), initiallyFrozen)
    const first = result.request.messages[0].content[0]
    if (first.type === 'text') first.text = 'Owned result remains writable'
    assert.deepEqual(request, before)
    assert.equal(snapshots.mock.callCount(), 0); assert.equal(derive.mock.callCount(), 0)
    assert.equal(nativeReads.mock.callCount(), 1000)
    assert.ok(!fixture.cacheNames().some(name => name.startsWith('request-plan-') || name === 'request-model-projection'))
    await yieldToHost(); loop.disable(); const cpu = process.cpuUsage(cpuStart)
    t.diagnostic(`workbench-model-cascade ${JSON.stringify({ events: session.seq, messages: 1000, bodyProjections: projected, byteSerializations, planMs: planned.ms, httpMs: http.ms, otherAgentMs: other.ms, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6, wallMs: performance.now() - began })}`)
    assert.ok(planned.ms < 5000 && http.ms < 1000 && other.ms < 1500 && loop.max / 1e6 < 1000)
  })

  test('long paired tool filtering uses native workbench planning without retaining lookup caches', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { session } = fixture
    const request: GenerateOptions = { provider: 'care-test', model: 'care-test', messages: [] }
    for (let index = 0; index < 500; index++) {
      const callId = ToolCallId(`plan-call-${index}`), text = `${index % 2 ? 'KEEP' : 'REMOVE'} ${index} ` + 'x'.repeat(512)
      session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 1, outputTokens: 1 },
        message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' },
          content: [{ type: 'text', text: `HIST ${index}` }] }) }, { surfaceOp: 'append' })
      request.messages.push(createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' },
        content: [{ type: 'tool-call', id: callId, name: 'inspect', arguments: '{}' }] }),
      createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text }, { type: 'text', text }] }))
    }
    await fixture.configure(true)
    const before = structuredClone(request), reads = t.mock.method(session, 'eventAt')
    const beforeCatalog = fixture.catalogReads(), beforeRecords = fixture.recordReads(), beforeTokens = fixture.tokenReads()
    const beforeNumeric = fixture.numericComparisons(), beforeCollators = fixture.removalCollators(), beforeActionWork = fixture.actionWork()
    const snapshots = t.mock.method(session, 'snapshotEvents'), fullMessages = t.mock.method(session, 'deriveMessages')
    const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); t.after(() => loop.disable())
    const cpuStart = process.cpuUsage(); await yieldToHost()
    const timed = async (run: () => Promise<unknown>) => { const start = performance.now(); const value = await run(); return { ms: performance.now() - start, value } }
    const [planned, http, other] = await Promise.all([timed(() => fixture.preview(request)), timed(fixture.http), timed(fixture.probe)])
    const result = planned.value as Awaited<ReturnType<typeof fixture.preview>>
    assert.equal(result.applied.length, 500, 'both matching child occurrences retain their action records')
    const numericComparisons = fixture.numericComparisons() - beforeNumeric, removalCollators = fixture.removalCollators() - beforeCollators
    assert.equal(numericComparisons, 0, 'native filtering no longer configures numeric locale options for each comparison')
    assert.equal(removalCollators, 1, 'all selected removal paths share one local numeric collator')
    const catalogReads = fixture.catalogReads() - beforeCatalog, recordReads = fixture.recordReads() - beforeRecords, tokenReads = fixture.tokenReads() - beforeTokens
    assert.ok(tokenReads < 20, `500 evidence records must not serialize a full policy token each time: ${tokenReads}`)
    assert.ok(catalogReads < 20, `500 evidence records must not cause per-action catalog reads: ${catalogReads}`)
    assert.ok(recordReads < 50, `500 evidence records must not clone per-action runtime state: ${recordReads}`)
    assert.equal(result.request.messages.length, 500, 'only the 250 complete KEEP tool pairs remain')
    assert.equal(result.request.messages.filter(message => message.role === 'tool').length, 250)
    assert.ok(result.request.messages.filter(message => message.role === 'tool').every(message => message.content.every(block => block.type === 'text' && block.text.startsWith('KEEP'))))
    assert.deepEqual(request, before, 'planned result cannot mutate the source request')
    assert.equal(fixture.actionWork() - beforeActionWork, 1, '500 evidence occurrences share one immutable single-action dependency index')
    const beforeWarm = reads.mock.callCount(), again = await fixture.preview(request)
    const actionWork = fixture.actionWork() - beforeActionWork
    assert.equal(actionWork, 2, 'independent second preview owns exactly one new action structure')
    assert.deepEqual(again.request, result.request)
    assert.equal(reads.mock.callCount(), beforeWarm, 'repeat preview borrows the existing native cut')
    assert.equal(snapshots.mock.callCount(), 0); assert.equal(fullMessages.mock.callCount(), 0)
    assert.ok(!fixture.cacheNames().some(name => name === 'request-plan-analysis' || name === 'request-plan-block-index' || name === 'request-model-projection'))
    await yieldToHost(); loop.disable(); const cpu = process.cpuUsage(cpuStart)
    t.diagnostic(`workbench-tool-filter ${JSON.stringify({ events: session.seq, messages: request.messages.length, matchedChildren: 500, actionWork, numericComparisons, removalCollators, catalogReads, recordReads, tokenReads, planMs: planned.ms, httpMs: http.ms, otherAgentMs: other.ms, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6, nativeReads: reads.mock.callCount() })}`)
    assert.ok(planned.ms < 5000 && http.ms < 1000 && other.ms < 1500 && loop.max / 1e6 < 1000)
    await fixture.pauseFilter(true)
    const paused = await fixture.preview(request)
    assert.equal(paused.applied.length, 0); assert.deepEqual(paused.request, request)
    await fixture.pauseFilter(false)
    const resumed = await fixture.preview(request)
    assert.equal(resumed.applied.length, 500); assert.deepEqual(resumed.request, result.request)
    assert.equal(reads.mock.callCount(), beforeWarm, 'new policy batches reuse native reads but never stale action controls')
  })

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
