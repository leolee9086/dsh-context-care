import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { createOutputInterrupt } from '../src/reminder-runtime/interrupt.ts'
import type { OutputEvidence } from '../lib/reminder-runtime/output-stream.js'

/** Matching and candidate admission use the real Worker; only race timing is controlled. */
async function fixture(t: TestContext) {
  const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000, maxIdle: 1 })
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    dispatches: true, execute: (input, signal, timing) => matcher.detect(input, signal, timing) })
  t.after(async () => { await runtime.close(); await matcher.close() })
  await matcher.warmup()
  runtime.registerSource({ sourceId: 'interrupt-race', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'output', on: 'assistant.output', text: 'OUTPUT_NOTICE',
    when: { blockTypes: ['text'], pattern: { kind: 'literal', text: 'ARCHIVE' } },
    effect: { kind: 'remind', deliver: { model: { once: 'surface', interrupt: 'abort-resume' } } },
  }] })
  const output: OutputEvidence = { attemptId: 'attempt', turn: 0, step: 0, index: 0,
    type: 'text', text: 'ARCHIVE', full: 'ARCHIVE', offset: 0 }
  await runtime.submit({ type: 'assistant.output', sessionId: 's', callId: 'output-call',
    rootCallId: 'output-call', output })
  assert.equal(runtime.snapshot('s').candidates.length, 1)
  return { runtime, output }
}

test('interrupt cold load owns the lane and does not cancel an attempt that finishes while reading', async t => {
  const { runtime, output } = await fixture(t)
  let release!: () => void, started!: () => void
  const loading = new Promise<void>(resolve => { started = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  let current = true, reads = 0, cancels = 0, steers = 0
  const interrupt = createOutputInterrupt({ runtime, maxInterrupts: 1, sessionId: () => 's',
    prepareHumanTurn: async () => { reads++; started(); await pending },
    humanTurn: () => 'human', visible: () => [], isCurrent: () => current,
    cancel: () => { cancels++ }, steer: () => { steers++ } })
  const first = interrupt({}, output)
  await loading
  await interrupt({}, output)
  current = false; release(); await first
  assert.equal(reads, 1)
  assert.equal(cancels, 0); assert.equal(steers, 0)
  assert.equal(runtime.snapshot('s').candidates[0]?.status, 'pending')
  assert.equal(runtime.snapshot('s').candidates[0]?.messageId, undefined)
})

for (const nextTurn of ['new-human', undefined]) {
  test(`interrupt rolls back when final clock is ${nextTurn ?? 'not current'}`, async t => {
    const { runtime, output } = await fixture(t)
    let turn: string | undefined = 'human', checks = 0, cancels = 0, steers = 0
    const interrupt = createOutputInterrupt({ runtime: { ...runtime, async filterMessages(...args) {
      const messages = await runtime.filterMessages(...args)
      if (++checks === 2) turn = nextTurn
      return messages
    } }, maxInterrupts: 1, sessionId: () => 's', humanTurn: () => turn,
    visible: () => [], isCurrent: () => true, cancel: () => { cancels++ }, steer: () => { steers++ } })
    await interrupt({}, output)
    assert.equal(checks, 2)
    assert.equal(cancels, 0); assert.equal(steers, 0)
    assert.equal(runtime.snapshot('s').candidates[0]?.status, 'pending')
    assert.equal(runtime.snapshot('s').candidates[0]?.messageId, undefined)
  })
}

test('zero interrupt budget never loads history or reads the human clock', async t => {
  const { runtime, output } = await fixture(t)
  const interrupt = createOutputInterrupt({ runtime, maxInterrupts: 0, sessionId: () => 's',
    prepareHumanTurn: async () => { assert.fail('unexpected cold read') },
    humanTurn: () => { assert.fail('unexpected clock read') }, visible: () => [], isCurrent: () => true,
    cancel: () => { assert.fail('unexpected cancellation') }, steer: () => { assert.fail('unexpected steering') } })
  await interrupt({}, output)
  assert.equal(runtime.snapshot('s').candidates[0]?.status, 'pending')
})
