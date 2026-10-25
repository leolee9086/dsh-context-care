import test from 'node:test'
import assert from 'node:assert/strict'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { createClientChanges } from '../lib/client-changes.js'
import { createRewriteRecords } from '../src/rewrite-records.js'
import { ensureSessionLog } from '../lib/session-log.js'

interface Harness { open(t: test.TestContext): Promise<{ ctx: Context; session: Session; base: string; cookie: string;
  forbidFullReads(): void; rewrite(index: number): Promise<unknown>; http(): Promise<void>; probe(): Promise<void> }> }
export function registerRewritePerformanceCases(harness: Harness) {
  test('long rewrite subscriptions send only exact revisions without full request history or body rescans', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t), { ctx, session, base, cookie } = fixture, errors: unknown[] = [], routes: string[] = []
    const frames: { type: string; value?: { records: object[]; removed?: string[] } }[] = []
    for (let index = 0; index < 1000; index++) session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createMessage({
      role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' }, content: [{ type: 'text', text: 'original native answer' }] }) }, { surfaceOp: 'append' })
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents')
    fixture.forbidFullReads()
    // This is the real registered request rewriter and its Host-owned journal.
    for (let index = 0; index < 1000; index++) await fixture.rewrite(index)
    const cpuStart = process.cpuUsage(), began = performance.now(), loop = monitorEventLoopDelay({ resolution: 10 })
    loop.enable(); t.after(() => loop.disable()); await yieldToHost()
    const changes = createClientChanges({ fetcher: (input, options) => { const url = new URL(input instanceof Request ? input.url : String(input), base); routes.push(url.pathname);
      return fetch(url, { ...options, headers: { ...options?.headers, cookie } }) }, report: (error: unknown) => errors.push(error) })
    const records = createRewriteRecords({ changes, report: (error: unknown) => errors.push(error) })
    const release = records.watch(String(session.id)), releaseFrames = changes.subscribe({ sessionId: String(session.id), topic: 'rewrites' }, frame => {
      if (frame.type !== 'error') frames.push(frame as typeof frames[number])
    })
    t.after(() => { releaseFrames(); release(); records.dispose(); changes.dispose() })
    const wait = (predicate: () => boolean) => new Promise<void>((resolve, reject) => {
      if (predicate()) { resolve(); return }
      const timer = setTimeout(() => { stop(); reject(new Error(`rewrite update timeout: ${errors.map(String)}`)) }, 10000)
      const stop = records.records.subscribe(() => { if (predicate()) { clearTimeout(timer); stop(); resolve() } })
    })
    await wait(() => records.records.getSnapshot().size === 1000)
    const coldMs = performance.now() - began, beforeReads = reads.mock.callCount()
    const work = () => ensureSessionLog(ctx).cache.report().find(row => row.name === 'rewrite-view')?.work ?? 0
    const beforeWork = work(); assert.equal(beforeWork, 1000)
    const timed = async (run: () => Promise<unknown>) => { const at = performance.now(); await run(); return performance.now() - at }
    const [liveMs, httpMs, otherAgentMs] = await Promise.all([timed(async () => {
      for (let index = 1000; index < 1020; index++) {
        await fixture.rewrite(index)
        await wait(() => records.records.getSnapshot().size === index + 1)
        const frame = frames.at(-1)!
        assert.equal(frame.type, 'delta'); assert.equal(frame.value?.records.length, 1)
      }
    }), timed(fixture.http), timed(fixture.probe)])
    assert.equal(reads.mock.callCount(), beforeReads); assert.equal(snapshots.mock.callCount(), 0)
    assert.equal(work() - beforeWork, 20); assert.equal(records.records.getSnapshot().size, 1020)
    assert.deepEqual(routes, ['/context-care/changes']); assert.deepEqual(errors, [])
    await yieldToHost(); loop.disable(); const cpu = process.cpuUsage(cpuStart)
    t.diagnostic(`rewrite-stream-performance ${JSON.stringify({ nativeEvents: session.seq, rewrites: 1020, coldMs, liveMs, httpMs, otherAgentMs,
      cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, loopMaxMs: loop.max / 1e6, nativeReads: reads.mock.callCount(), frames: frames.length })}`)
    assert.ok(coldMs < 1500 && liveMs < 2500 && httpMs < 1000 && otherAgentMs < 1500 && loop.max / 1e6 < 1000)
  })
}
