import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { ToolCallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-session-controller'

interface Harness {
  open(t: test.TestContext): Promise<{ ctx: Context; base: string; cookie: string; session: Session; nativeLog: boolean;
    collect(session: Session): Promise<unknown[]>; probe(): Promise<void>; match(session: Session): Promise<void> }>
}

/** Ordinary collection never discovers triggers in old tool outcomes. */
export function registerHistoryPerformanceCases(harness: Harness): void {
  test('cold reminder collection does not replay history and keeps HTTP and Agent creation responsive', { timeout: 120000 }, async t => {
    const fixture = await harness.open(t)
    const { ctx, base, cookie, nativeLog, collect, probe, match } = fixture
    let session = fixture.session
    if (!nativeLog) {
      // Prepare before publication: these outcomes happened before the plugin's
      // live subscription and must not become new work when collection runs.
      const seed = ctx.sessions.prepare(undefined)
      seed.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'OLD_CONTEXT' }] }), { surfaceOp: 'append' })
      for (let index = 0; index < 2000; index++) {
        const callId = ToolCallId(`history-perf-${index}`)
        const call = seed.append('tool/call', { turn: 1, step: index, callId,
          name: 'history_performance_probe', arguments: JSON.stringify({ index }) })
        seed.append('tool/result', { turn: 1, step: index,
          message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'OLD_RESULT:' + 'x'.repeat(256) }] })
        }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      }
      session = ctx.sessions.create(SessionId('history-performance-cold'), { seed: seed.snapshotEvents() })
    }
    // Spies retain the real service implementation. Count only the long Session;
    // a concurrently created Agent has independent, legitimate reads.
    const read = t.mock.method(ctx.sessionQuery, 'readSession')
    const observe = t.mock.method(ctx.sessionQuery, 'observeSession')
    const request = async () => {
      const began = performance.now()
      const response = await fetch(`${base}/context-care/rules?sessionId=${encodeURIComponent(session.id)}`, { headers: { cookie } })
      assert.equal(response.status, 200)
      await response.json()
      return performance.now() - began
    }
    const started = performance.now(), cpuStart = process.cpuUsage(), loopStart = performance.eventLoopUtilization()
    let finished = false
    const turnMs: number[] = []
    const turns = (async () => {
      do { const began = performance.now(); await yieldToHost(); turnMs.push(performance.now() - began) } while (!finished)
    })()
    const cold = (async () => {
      const began = performance.now(), messages = await collect(session)
      assert.deepEqual(messages, [], 'old matching outcomes are not pending reminder work')
      return performance.now() - began
    })()
    const agent = (async () => { const began = performance.now(); await probe(); return performance.now() - began })()
    let measurements: [number, number, number]
    try { measurements = await Promise.all([cold, request(), agent]) }
    finally { finished = true; await turns }
    const warmStart = performance.now()
    assert.deepEqual(await collect(session), [])
    const warmCollectMs = performance.now() - warmStart, cpu = process.cpuUsage(cpuStart)
    const historyReads = [...read.mock.calls, ...observe.mock.calls].filter(call => call.arguments[0] === session.id).length
    const report = { source: nativeLog ? 'real-session-readonly' : 'generated-native-events', events: session.seq,
      historyReads, coldCollectMs: measurements[0], httpMs: measurements[1], agentCreateAndSendMs: measurements[2],
      warmCollectMs, elapsedMs: performance.now() - started, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
      eventLoopUtilization: performance.eventLoopUtilization(loopStart).utilization,
      eventLoopMaxMs: Math.max(...turnMs), eventLoopTurns: turnMs.length }
    t.diagnostic(`native-runtime-performance ${JSON.stringify(report)}`)
    if (process.env.DSH_NATIVE_RECOVERY_REPORT) await writeFile(process.env.DSH_NATIVE_RECOVERY_REPORT, JSON.stringify(report, null, 2) + '\n')
    assert.equal(historyReads, 0, 'collection and the rule catalog do not open the old event log')
    assert.ok(report.coldCollectMs < 1000, 'a first collection cannot initiate historical work')
    assert.ok(report.httpMs < 1000, 'authenticated rule HTTP remains responsive')
    assert.ok(report.agentCreateAndSendMs < 2000, 'another real Agent can be created and complete its request')
    assert.ok(report.eventLoopMaxMs < 1000, 'ordinary collection does not block Host dispatch')
    assert.ok(warmCollectMs < 1000, 'later collection remains independent of history length')
    // A present matching tool exercises actual Host listeners and Worker admission,
    // not merely the idle fast path. Only this detached test Session is appended.
    const matchStarted = performance.now(), matchCpuStart = process.cpuUsage()
    const matchTurns: number[] = []
    let matchFinished = false
    const observeTurns = (async () => {
      do { const began = performance.now(); await yieldToHost(); matchTurns.push(performance.now() - began) } while (!matchFinished)
    })()
    let matched: [void, number]
    try { matched = await Promise.all([match(session), request()]) }
    finally { matchFinished = true; await observeTurns }
    const matchCpu = process.cpuUsage(matchCpuStart)
    const current = { elapsedMs: performance.now() - matchStarted, httpMs: matched[1],
      cpuUserMs: matchCpu.user / 1000, cpuSystemMs: matchCpu.system / 1000, eventLoopMaxMs: Math.max(...matchTurns) }
    t.diagnostic('native-current-match-performance ' + JSON.stringify(current))
    assert.ok(current.elapsedMs < 2000, 'a current hit is evaluated and collected promptly')
    assert.ok(current.httpMs < 1000, 'authenticated HTTP is not blocked by a current hit')
    assert.ok(current.eventLoopMaxMs < 1000, 'current matching does not monopolize Host dispatch')
    assert.equal([...read.mock.calls, ...observe.mock.calls].filter(call => call.arguments[0] === session.id).length, 0)
  })
}
