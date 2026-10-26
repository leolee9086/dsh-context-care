import test from 'node:test'
import assert from 'node:assert/strict'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Session } from '@deepseek-ai/dsh-session'
import { createMessage, createToolResultMessage, ToolCallId, type GenerateOptions } from '@deepseek-ai/dsh-llm'

interface Plan { request: GenerateOptions; applied: { key: string }[]; entryTransitions: { key: string }[]; records: { cascadePass?: number }[] }
interface EntryState { materialization?: { text: string }; lastInactiveAt?: number; status?: string }
interface Harness {
  open(t: test.TestContext): Promise<{ session: Session; configureEntries(count: number): Promise<void>; setEntriesActive(value: boolean): Promise<void>;
    entryState(): Record<string, EntryState>; confirm(planned: Plan): Promise<void>; pauseEntry(paused: boolean): Promise<void>; configureCatalog(count: number): () => void;
    catalog(): { sourceId: string; plugin: string; registration: string; rules: { id: string; title: string; actions: { id: string; available: boolean }[] }[] }[]; anchorLookups(): number; anchorScans(): number; configureAnchors(anchor: string): Promise<void>; configure(filters?: boolean | 'cascade'): Promise<void>; display(seq: number): Promise<unknown>;
    preview(request: GenerateOptions): Promise<Plan>; cacheNames(): string[]; projectionWork(): number; pairBuilds(): number; pairWork(): number; pairMessages(): number; actionWork(): number; controlIdentityFinds(): number; byteSerializations(request: GenerateOptions): number; numericComparisons(): number; removalCollators(): number; catalogReads(): number; recordReads(): number; tokenReads(): number; pauseFilter(paused: boolean): Promise<void>;
    reconcile(): Promise<void>; http(): Promise<void>; probe(): Promise<void>; runs(): number; displayCalls(): number }>
}

/** Run in the real Loader composition; spy methods delegate to native Session. */
export function registerWorkbenchPerformanceCases(harness: Harness): void {
  test('native entry batch shares policy and deactivation cuts while durable ACKs remain authoritative', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { session } = fixture
    await fixture.configureEntries(32)
    const request: GenerateOptions = { provider: 'care-test', model: 'care-test', messages: [] }
    for (let index = 0; index < 1000; index++) {
      const message = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `ENTRY_HISTORY ${index}` }] })
      session.append('user/message', message, { surfaceOp: 'append' }); request.messages.push(structuredClone(message))
    }
    const activate = await fixture.preview(request); assert.equal(activate.applied.length, 33, JSON.stringify(activate.records.slice(0, 3)))
    await fixture.confirm(activate)
    const key = (index: number) => JSON.stringify(['context-care:document:entry-batch', `entry:held-${index}`, 1, 'inject'])
    for (let index = 0; index < 32; index++) assert.equal(fixture.entryState()[key(index)].materialization?.text, `HELD_${index}`)
    await fixture.setEntriesActive(false)
    const before = fixture.entryState(), reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents'), derive = t.mock.method(session, 'deriveMessages')
    const beforeRecords = fixture.recordReads(), beforeCatalogs = fixture.catalogReads(), loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); t.after(() => loop.disable())
    await yieldToHost(); const cpuStart = process.cpuUsage()
    const timed = async <T>(run: () => Promise<T>) => { const start = performance.now(); const value = await run(); return { ms: performance.now() - start, value } }
    const [preview, http, other] = await Promise.all([timed(() => fixture.preview(request)), timed(fixture.http), timed(fixture.probe)])
    const planned = preview.value, recordReads = fixture.recordReads() - beforeRecords, catalogReads = fixture.catalogReads() - beforeCatalogs
    assert.equal(planned.applied.length, 1); assert.equal(planned.entryTransitions.length, 32)
    assert.ok(recordReads < 20, '32 inactive policies and decisions must not clone the store per entry')
    assert.ok(catalogReads < 10, 'deactivation uses a synchronous decision batch, not 32 separate catalogs')
    assert.deepEqual(fixture.entryState(), before, 'preview cannot acknowledge deactivation')
    const warmReads = reads.mock.callCount(), again = await fixture.preview(request)
    assert.equal(again.entryTransitions.length, 32); assert.equal(reads.mock.callCount(), warmReads)
    await fixture.pauseEntry(true)
    const paused = await fixture.preview(request); assert.equal(paused.entryTransitions.length, 31)
    assert.ok(!paused.entryTransitions.some(item => item.key === key(0)))
    await fixture.confirm(paused)
    const confirmed = fixture.entryState(); assert.deepEqual(confirmed[key(0)], before[key(0)], 'paused entry retains its held slice')
    for (let index = 1; index < 32; index++) {
      assert.equal(confirmed[key(index)].materialization, undefined); assert.ok((confirmed[key(index)].lastInactiveAt ?? 0) > 0)
      assert.equal(confirmed[`$dispatch:${key(index)}`].status, 'settled')
    }
    await fixture.pauseEntry(false); await fixture.setEntriesActive(true)
    const historical = await fixture.preview(request)
    assert.equal(historical.applied.length, 1, 'resuming cannot replay old evidence for the paused entry')
    const fresh = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'FRESH_ENTRY_EVIDENCE' }] })
    session.append('user/message', fresh, { surfaceOp: 'append' }); request.messages.push(structuredClone(fresh))
    const cooled = await fixture.preview(request)
    assert.equal(cooled.applied.length, 2, 'fresh evidence restores the paused held slice while deactivated entries remain cooling')
    assert.equal(cooled.entryTransitions.length, 0); assert.deepEqual(fixture.entryState()[key(1)], confirmed[key(1)])
    assert.equal(reads.mock.callCount(), warmReads + 1, 'fresh evidence reads only the newly appended native event')
    assert.equal(snapshots.mock.callCount(), 0); assert.equal(derive.mock.callCount(), 0)
    await yieldToHost(); loop.disable(); const cpu = process.cpuUsage(cpuStart)
    t.diagnostic(`workbench-entry-batch ${JSON.stringify({ entries: 32, nativeReadsAfterWarm: reads.mock.callCount(), recordReads, catalogReads, planMs: preview.ms, httpMs: http.ms, otherAgentMs: other.ms, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6 })}`)
    assert.ok(preview.ms < 5000 && http.ms < 1000 && other.ms < 1500 && loop.max / 1e6 < 1000)
  })

  test('native workbench catalog reads one state cut for every source and action', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { session } = fixture
    for (let index = 0; index < 1000; index++) session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: `CATALOG_HISTORY ${index} ` + 'x'.repeat(256) }] }), { surfaceOp: 'append' })
    const dispose = fixture.configureCatalog(32)
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents'), derive = t.mock.method(session, 'deriveMessages')
    const beforeReads = fixture.recordReads(), loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); t.after(() => loop.disable())
    await yieldToHost(); const cpuStart = process.cpuUsage(), start = performance.now()
    const catalog = fixture.catalog(), catalogMs = performance.now() - start
    assert.equal(fixture.recordReads() - beforeReads, 1, '32 documents and 128 actions share one actual store read')
    assert.equal(catalog.length, 32)
    for (let index = 0; index < 32; index++) {
      const source = catalog[index]
      assert.equal(source.sourceId, `context-care:document:catalog-${index}`); assert.equal(source.plugin, 'catalog-owner'); assert.equal(source.registration, 'catalog-cut')
      assert.deepEqual(source.rules.map(rule => rule.id), ['r:0', 'r:1', 'r:2', 'r:3'])
      assert.ok(source.rules.every(rule => rule.actions.length === 1 && rule.actions[0].available))
    }
    catalog[0].rules[0].title = 'CALLER_MUTATION'
    const again = fixture.catalog(); assert.equal(again[0].rules[0].title, 'Rule 0:0')
    assert.equal(fixture.recordReads() - beforeReads, 2, 'a new catalog call gets a fresh owned state, not mutable identity caching')
    const timed = async (run: () => Promise<void>) => { const began = performance.now(); await run(); return performance.now() - began }
    const [httpMs, otherAgentMs] = await Promise.all([timed(fixture.http), timed(fixture.probe)])
    dispose(); assert.deepEqual(fixture.catalog(), [], 'unregistered definitions disappear immediately')
    assert.equal(reads.mock.callCount(), 0); assert.equal(snapshots.mock.callCount(), 0); assert.equal(derive.mock.callCount(), 0)
    await yieldToHost(); loop.disable(); const cpu = process.cpuUsage(cpuStart)
    t.diagnostic(`workbench-catalog-cut ${JSON.stringify({ documents: 32, rules: 128, stateReadsPerCatalog: 1, catalogMs, httpMs, otherAgentMs, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6 })}`)
    assert.ok(catalogMs < 1000 && httpMs < 1000 && otherAgentMs < 1500 && loop.max / 1e6 < 1000)
  })

  test('long native explicit anchors preserve placement without per-action block scans', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { session } = fixture
    const request: GenerateOptions = { provider: 'care-test', model: 'care-test', messages: [] }
    let anchor = ''
    for (let index = 0; index < 1000; index++) {
      const message = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text',
        text: `${index < 500 ? 'ANCHOR_MATCH' : 'KEEP'} ${index} ` + 'x'.repeat(256) }] })
      const event = session.append('user/message', message, { surfaceOp: 'append' })
      request.messages.push(message); anchor = `${session.id}#${event.seq}#0`
    }
    await fixture.configureAnchors(anchor)
    const before = structuredClone(request), reads = t.mock.method(session, 'eventAt')
    const snapshots = t.mock.method(session, 'snapshotEvents'), derive = t.mock.method(session, 'deriveMessages')
    const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); t.after(() => loop.disable())
    await yieldToHost(); const cpuStart = process.cpuUsage()
    const timed = async (run: () => Promise<unknown>) => { const start = performance.now(); const value = await run(); return { ms: performance.now() - start, value } }
    const [planned, http, other] = await Promise.all([timed(() => fixture.preview(request)), timed(fixture.http), timed(fixture.probe)])
    const result = planned.value as Awaited<ReturnType<typeof fixture.preview>>
    assert.equal(result.applied.length, 500); assert.equal(result.request.messages.length, 1500)
    assert.deepEqual(result.request.messages.slice(0, 999), before.messages.slice(0, 999))
    assert.deepEqual(result.request.messages.at(-1), before.messages.at(-1))
    assert.ok(result.request.messages.slice(999, 1499).every(message => message.content[0].type === 'text' && message.content[0].text === 'PINNED'))
    assert.deepEqual(request, before)
    const warmReads = reads.mock.callCount(), again = await fixture.preview(request)
    assert.deepEqual(again.request, result.request); assert.equal(reads.mock.callCount(), warmReads)
    assert.equal(warmReads, 1000); assert.equal(snapshots.mock.callCount(), 0); assert.equal(derive.mock.callCount(), 0)
    assert.equal(fixture.anchorLookups(), 1000, 'two real previews each resolve 500 exact anchors')
    assert.equal(fixture.anchorScans(), 0, 'no injection action calls the model block array find')
    assert.ok(!fixture.cacheNames().some(name => name.startsWith('request-plan-') || name === 'request-model-projection'))
    const first = result.request.messages[0].content[0]
    if (first.type === 'text') first.text = 'INDEPENDENT'
    assert.deepEqual(request, before); assert.deepEqual(again.request.messages[0], before.messages[0])
    await yieldToHost(); loop.disable(); const cpu = process.cpuUsage(cpuStart)
    t.diagnostic(`workbench-explicit-anchors ${JSON.stringify({ messages: 1000, injections: 500, nativeReads: warmReads, anchorLookups: fixture.anchorLookups(), anchorScans: fixture.anchorScans(), planMs: planned.ms, httpMs: http.ms, otherAgentMs: other.ms, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6 })}`)
    assert.ok(planned.ms < 5000 && http.ms < 1000 && other.ms < 1500 && loop.max / 1e6 < 1000)
  })

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
    const pairBuilds = fixture.pairBuilds(), pairWork = fixture.pairWork(), pairMessages = fixture.pairMessages()
    assert.equal(pairBuilds, 4, 'baseline and three final cascade candidates each build one pair cut')
    assert.equal(pairWork, 4006, '1000+1001+1002+1003 message contributions, not each candidate twice as output then input')
    assert.equal(pairMessages, 1003, '1000 input bodies and three injections, never the unchanged cloned history again')
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
    t.diagnostic(`workbench-model-cascade ${JSON.stringify({ events: session.seq, messages: 1000, bodyProjections: projected, byteSerializations, pairBuilds, pairWork, pairMessages, planMs: planned.ms, httpMs: http.ms, otherAgentMs: other.ms, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6, wallMs: performance.now() - began })}`)
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
    const controlIdentityFinds = fixture.controlIdentityFinds()
    assert.equal(controlIdentityFinds, 0, '500 live control selections do not recursively search rule/action arrays')
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
    assert.equal(fixture.pairBuilds(), 2, 'one baseline and one final filtered candidate, never a cut per occurrence')
    assert.equal(fixture.pairWork(), 1500, 'all 1000 baseline messages and all 500 final messages are checked')
    const beforeWarm = reads.mock.callCount(), again = await fixture.preview(request)
    const actionWork = fixture.actionWork() - beforeActionWork
    assert.equal(actionWork, 2, 'independent second preview owns exactly one new action structure')
    const pairBuilds = fixture.pairBuilds(), pairWork = fixture.pairWork(), pairMessages = fixture.pairMessages()
    assert.equal(pairBuilds, 4, 'independent previews build their own pair cuts, not a mutable-identity cross-operation cache')
    assert.equal(pairWork, 3000)
    assert.equal(pairMessages, 2000, 'each independent preview reads 1000 source messages once; unchanged KEEP clones borrow metadata')
    assert.deepEqual(again.request, result.request)
    assert.equal(reads.mock.callCount(), beforeWarm, 'repeat preview borrows the existing native cut')
    assert.equal(snapshots.mock.callCount(), 0); assert.equal(fullMessages.mock.callCount(), 0)
    assert.ok(!fixture.cacheNames().some(name => name.startsWith('request-plan-') || name === 'request-model-projection'))
    await yieldToHost(); loop.disable(); const cpu = process.cpuUsage(cpuStart)
    t.diagnostic(`workbench-tool-filter ${JSON.stringify({ events: session.seq, messages: request.messages.length, matchedChildren: 500, actionWork, pairBuilds, pairWork, pairMessages, controlIdentityFinds, numericComparisons, removalCollators, catalogReads, recordReads, tokenReads, planMs: planned.ms, httpMs: http.ms, otherAgentMs: other.ms, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6, nativeReads: reads.mock.callCount() })}`)
    assert.ok(planned.ms < 5000 && http.ms < 1000 && other.ms < 1500 && loop.max / 1e6 < 1000)
    await fixture.pauseFilter(true)
    const paused = await fixture.preview(request)
    assert.equal(paused.applied.length, 0); assert.deepEqual(paused.request, request)
    assert.equal(fixture.pairBuilds(), pairBuilds, 'unchanged notification-free plan does not build any pair cut')
    await fixture.pauseFilter(false)
    const resumed = await fixture.preview(request)
    assert.equal(resumed.applied.length, 500); assert.deepEqual(resumed.request, result.request)
    assert.equal(fixture.pairBuilds(), pairBuilds + 2, 'new enabled plan gets fresh immutable pair cuts')
    assert.ok(!fixture.cacheNames().some(name => name.startsWith('request-plan-') || name === 'request-model-projection'))
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
