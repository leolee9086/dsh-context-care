import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SessionStore, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createSessionLog } from '../lib/session-log.js'
import { ToolCallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { createToolEvents } from '../lib/reminder-runtime/tool-events.js'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createTemplates } from '../src/templates.js'
import { eventLog } from './fixtures/event-log.js'

const config = { maxContextChars: 256, maxContextMessages: 8, maxQueued: 2, maxConcurrent: 1 }

function logFixture(t: test.TestContext) {
  const ctx = new Context(), sessions = new SessionStore(ctx), logs = createSessionLog(ctx)
  t.after(async () => { logs.close(); await ctx.fiber.dispose() })
  return { logs, sessions }
}

test('native anchored trigger reconstructs its historical prefix after cache loss and later context', async t => {
  const { logs, sessions } = logFixture(t)
  const prepare = t.mock.method(sessions, 'prepare')
  const session = Session.create(SessionId('native-tool-prefix')), events: SessionEvent[] = []
  let reads = 0
  const history: NonNullable<Parameters<typeof createToolEvents>[1]> = {
    logs, sessions: { get: id => id === session.id ? session : undefined },
    readSession: async id => { assert.equal(id, session.id); reads++; return eventLog(events) },
  }
  const source = createToolEvents(config, history)
  events.push(session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'EARLY_CONTEXT' }],
    source: { kind: 'user' } }), { surfaceOp: 'append' }))
  const callId = ToolCallId('prefix-call')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'read', arguments: '{"file_path":"original.ts"}' })
  events.push(call); source.observe(session, call)
  const terminal = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'CURRENT_RESULT' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  events.push(terminal)
  const hot = source.observe(session, terminal)
  assert.ok(hot)
  const expected = structuredClone(hot.event)
  assert.deepEqual(expected.context?.messages.map(message => message.text), ['EARLY_CONTEXT'])
  events.push(session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'LATER_CONTEXT' }],
    source: { kind: 'user' } }), { surfaceOp: 'append' }))
  const tampered = { ...hot.event, name: 'wrong-tool', callId: 'wrong-call', rootCallId: 'wrong-root',
    arguments: { file_path: 'forged.ts' }, context: { messages: [], truncated: false }, clock: { at: 0 } }
  // Even the returned submission is an independent copy of the private cache.
  hot.event.context = { messages: [], truncated: false }
  const cached = await source.resolve(tampered)
  assert.deepEqual(cached, expected)
  cached.context = { messages: [], truncated: false }
  assert.deepEqual(await source.resolve(tampered), expected)
  assert.equal(reads, 0)
  source.close()
  assert.throws(() => source.observe(session, terminal), /context-is-not-current/)
  assert.deepEqual(await source.resolve(tampered), expected)
  assert.equal(reads, 1); assert.equal(prepare.mock.callCount(), 1)
  assert.deepEqual(await source.resolve(tampered), expected)
  assert.equal(reads, 1, 'the reconstructed value is also a disposable bounded cache')
  const dormant = createToolEvents(config, { ...history, sessions: { ...history.sessions, get: () => undefined } })
  assert.deepEqual(await dormant.resolve(tampered), expected, 'a detached source does not require a live Agent')
  assert.equal(reads, 2); assert.equal(prepare.mock.callCount(), 1, 'another facade shares the immutable native prefix fold')
  const controller = new AbortController(); controller.abort(new Error('stop native replay'))
  await assert.rejects(source.resolve(tampered, controller.signal), /stop native replay/)
  assert.equal(reads, 2)
  await assert.rejects(source.resolve({ ...tampered, native: { type: 'tool-result', seq: call.seq } }), /result-not-found/)
})

test('native tool trigger uses committed arguments outcome time and the preceding context', t => {
  const { logs, sessions } = logFixture(t)
  const session = Session.create(SessionId('native-tool-events')), source = createToolEvents(config, { logs, sessions, readSession: async () => logs.live(session) })
  const callId = ToolCallId('call-one')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'read', arguments: '{"file_path":"a.ts"}' })
  assert.equal(source.observe(session, call), undefined)
  assert.equal(source.waitForCommit(session, callId), true)
  const first = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'first actual result' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  const submitted = source.observe(session, first)
  assert.ok(submitted)
  assert.equal(submitted.event.type, 'tool.succeeded')
  assert.equal(submitted.event.callId, callId)
  assert.equal(submitted.event.rootCallId, callId)
  assert.deepEqual(submitted.event.arguments, { file_path: 'a.ts' })
  assert.deepEqual(submitted.event.context?.messages, [], 'the current result was absent at its triggering boundary')
  assert.equal(submitted.event.clock?.at, first.time)
  assert.equal(source.waitForCommit(session, callId), false)

  const nextId = ToolCallId('call-two')
  const next = session.append('tool/call', { turn: 0, step: 1, callId: nextId, name: 'read', arguments: '{bad-json' })
  source.observe(session, next)
  const failed = session.append('tool/result', { turn: 0, step: 1,
    message: createToolResultMessage({ callId: nextId, isError: true, content: [{ type: 'text', text: 'current failed result' }] }),
    error: { name: 'Failure', code: 'ACCESS_DENIED' }, meta: { toolOwned: 'unchanged' },
  }, { surfaceOp: 'append', sourceEventSeqs: [next.seq] })
  const failure = source.observe(session, failed)
  assert.equal(failure?.event.type, 'tool.failed')
  assert.equal(failure?.event.arguments, '{bad-json', 'invalid JSON follows native dispatch as raw text')
  assert.equal(failure?.event.error?.code, 'ACCESS_DENIED')
  assert.deepEqual(failure?.event.context?.messages.map(message => message.text), ['first actual result'])
  assert.deepEqual(failed.data.meta, { toolOwned: 'unchanged' })
})

test('native PTC result keeps the subcall root and derives the same trigger with an empty fold cache', async t => {
  const { logs, sessions } = logFixture(t)
  const session = Session.create(SessionId('native-ptc-events'))
  const history = { logs, sessions, readSession: async () => logs.live(session) }
  const source = createToolEvents(config, history)
  const rootCallId = ToolCallId('root'), subCallId = ToolCallId('root:ptc:1')
  const start = session.append('tool/ptc-dispatch-start', {
    rootCallId, parentCallId: rootCallId, subCallId, name: 'probe', arguments: { selected: true },
  })
  source.observe(session, start)
  assert.deepEqual(source.preparation(session, subCallId), { type: 'tool-call', seq: start.seq })
  const end = session.append('tool/ptc-dispatch', { ...start.data, isError: true,
    content: [{ type: 'text', text: 'nested outcome' }], error: { name: 'Timeout', code: 'TOOL_TIMED_OUT' },
  })
  const submitted = source.observe(session, end)
  assert.ok(submitted)
  assert.equal(submitted.event.callId, subCallId)
  assert.equal(submitted.event.rootCallId, rootCallId)
  assert.deepEqual(submitted.event.arguments, { selected: true })
  assert.equal(submitted.event.error?.code, 'TOOL_TIMED_OUT')
  assert.deepEqual(submitted.event.context?.messages, [], 'a PTC result does not enter model context')
  const cold = createToolEvents(config, history)
  assert.deepEqual(cold.observe(session, end)?.event, submitted.event, 'the PTC terminal event contains its own call facts')
  const later = session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Later than the nested result.' }] }), { surfaceOp: 'append' })
  const prepare = t.mock.method(sessions, 'prepare')
  const recovered = createToolEvents(config, { logs, sessions: { get: () => undefined },
    readSession: async () => eventLog([start, end, later]),
  })
  assert.deepEqual(await recovered.resolve({ ...submitted.event, name: 'wrong', rootCallId: 'wrong',
    arguments: {}, error: { code: 'wrong' } }), submitted.event)
  const before = await recovered.resolve({ ...submitted.event, native: { type: 'tool-call', seq: start.seq } })
  assert.equal(before.type, 'tool.before-execute')
  assert.equal(before.callId, subCallId)
  assert.equal(before.rootCallId, rootCallId)
  assert.deepEqual(before.arguments, { selected: true })
  assert.equal(before.clock?.at, start.time)
  assert.equal(before.context, undefined)
  assert.equal(before.error, undefined)
  assert.equal(prepare.mock.callCount(), 0, 'empty historical context and before-execution facts need no prepared Session')
})

test('runtime collection ignores old tool outcomes and handles explicitly observed current results', async t => {
  const { logs } = logFixture(t)
  const session = Session.create(SessionId('native-runtime-growth'))
  const source = createToolEvents(config, { logs, sessions: { get: () => undefined },
    readSession: async () => eventLog(session.snapshotEvents()),
  })
  const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 2000 })
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }, templates: createTemplates(),
    execute: (input, signal, timing) => matcher.detect(input, signal, timing),
    resolveEvent: (event, signal) => source.resolve(event, signal),
  })
  t.after(async () => { await runtime.close(); await matcher.close(); source.close() })
  runtime.registerSource({ sourceId: 'native-growth', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', when: { tool: 'probe' },
    text: 'RECOVERED {{event.arguments.file_path}}', effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] })
  const collect = () => runtime.collect({ sessionId: String(session.id), visible: [] })
  assert.deepEqual(await collect(), [])
  const callId = ToolCallId('committed-after-empty-scan')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'probe', arguments: '{"file_path":"late.ts"}' })
  source.observe(session, call)
  const terminal = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'REAL_LATER_RESULT' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  assert.deepEqual(await collect(), [], 'past outcomes alone do not constitute pending reminders')
  const observed = source.observe(session, terminal)
  assert.ok(observed)
  await runtime.submit(observed.event)
  const messages = await collect()
  assert.equal(messages.length, 1, 'a current native subscription still evaluates and delivers')
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'RECOVERED late.ts' }])
})

test('anchored retries follow native Session replacement and dormant growth without discovery', async t => {
  const { logs } = logFixture(t)
  const session = Session.create(SessionId('native-changing-history'))
  const callId = ToolCallId('pending-at-attachment')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'probe', arguments: '{"historical":true}' })
  let live: Session | undefined = session, reads = 0
  const source = createToolEvents(config, {
    logs, sessions: { get: () => live },
    readSession: async () => { reads++; return eventLog(session.snapshotEvents()) },
  })
  const terminal = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'COMPLETED_LATER' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  assert.equal(source.observe(session, terminal), undefined, 'an unobserved call stays on the normal unpaired execution path')
  assert.equal(reads, 0, 'observing a current result cannot start historical discovery')
  const anchor = (seq: number) => ({ sessionId: String(session.id), callId: 'supplied', rootCallId: 'supplied', origin: 'human' as const, facts: {},
    native: { type: 'tool-result' as const, seq } })
  const first = await source.resolve(anchor(terminal.seq))
  assert.deepEqual(first.arguments, { historical: true })
  assert.deepEqual(await source.resolve(anchor(terminal.seq)), first); assert.equal(reads, 1)
  live = Session.create(session.id, session.snapshotEvents())
  assert.deepEqual(await source.resolve(anchor(terminal.seq)), first); assert.equal(reads, 2)
  live = undefined
  assert.deepEqual(await source.resolve(anchor(terminal.seq)), first); assert.equal(reads, 3)
  const nextId = ToolCallId('written-elsewhere'), next = session.append('tool/call', {
    turn: 0, step: 1, callId: nextId, name: 'probe', arguments: '{"later":true}',
  })
  const later = session.append('tool/result', { turn: 0, step: 1,
    message: createToolResultMessage({ callId: nextId, isError: false, content: [{ type: 'text', text: 'EXTERNAL_RESULT' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [next.seq] })
  assert.equal((await source.resolve(anchor(later.seq))).callId, nextId)
  assert.equal(reads, 4)
})

test('cold retries accept local dispatched tools and reject inherited or cancelled outcomes', async t => {
  const { logs } = logFixture(t)
  const session = Session.create(SessionId('native-discovery')), events: SessionEvent[] = []
  const parentId = ToolCallId('parent-call')
  const parent = session.append('tool/call', { turn: 0, step: 0, callId: parentId, name: 'probe', arguments: '{}' })
  events.push(parent, session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId: parentId, isError: false, content: [{ type: 'text', text: 'INHERITED_RESULT' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [parent.seq] }))
  const inherited = events.length
  const rootCallId = ToolCallId('local-root'), subCallId = ToolCallId('local-root:ptc:1')
  events.push(session.append('tool/ptc-dispatch', { rootCallId, parentCallId: rootCallId, subCallId,
    name: 'local_probe', arguments: { local: true }, isError: false, content: [{ type: 'text', text: 'LOCAL_RESULT' }] }))
  const skipped = ToolCallId('not-dispatched')
  const call = session.append('tool/call', { turn: 0, step: 0, callId: skipped, name: 'probe', arguments: '{}' })
  events.push(call, session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId: skipped, isError: true, content: [{ type: 'text', text: 'abandoned' }] }),
    error: { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] }))
  let reads = 0
  const source = createToolEvents(config, {
    logs, sessions: { get: () => undefined },
    readSession: async () => { reads++; return eventLog(events, inherited) },
  })
  const anchor = (seq: number) => ({ sessionId: String(session.id), callId: 'supplied', rootCallId: 'supplied', origin: 'human' as const, facts: {},
    native: { type: 'tool-result' as const, seq } })
  const found = await source.resolve(anchor(inherited))
  assert.equal(found.callId, subCallId)
  assert.deepEqual(found.arguments, { local: true })
  assert.deepEqual(found.context?.messages.map(message => message.text), ['INHERITED_RESULT'])
  assert.equal(reads, 1)
  const cancelled = new AbortController(); cancelled.abort(new Error('retry cancelled'))
  await assert.rejects(source.resolve(anchor(inherited), cancelled.signal), /retry cancelled/)
  assert.equal(reads, 1)
  await assert.rejects(source.resolve(anchor(parent.seq + 1)), /native-tool-result-not-found/)
  await assert.rejects(source.resolve(anchor(call.seq + 1)), /native-tool-result-not-dispatched/)
})

test('abandoned native calls cannot recover a before-execution trigger from live or cold caches', async t => {
  const { logs } = logFixture(t)
  const session = Session.create(SessionId('native-skipped-before'))
  const source = createToolEvents(config, { logs, sessions: { get: () => session },
    readSession: async () => eventLog(session.snapshotEvents()),
  })
  const callId = ToolCallId('skipped-before')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'probe', arguments: '{}' })
  source.observe(session, call)
  assert.deepEqual(source.preparation(session, callId), { type: 'tool-call', seq: call.seq })
  const result = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: true, content: [{ type: 'text', text: 'never dispatched' }] }),
    error: { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  assert.equal(source.observe(session, result), undefined)
  assert.equal(source.preparation(session, callId), undefined)
  await assert.rejects(source.resolve({ sessionId: String(session.id), callId, rootCallId: callId, origin: 'human', facts: {},
    native: { type: 'tool-call', seq: call.seq } }), /native-tool-call-not-dispatched/)
  const raw = await source.resolve({ sessionId: String(session.id), callId, rootCallId: callId, origin: 'human', facts: {},
    native: { type: 'session-event', seq: result.seq } })
  assert.equal(raw.type, 'session.event', 'the raw cancellation remains a real native event')
  await assert.rejects(source.resolve({ ...raw, native: { type: 'tool-result', seq: result.seq } }), /native-tool-result-not-dispatched/)
})

test('PTC collapsed route excludes only its before trigger while an ordinary unknown name keeps it', async t => {
  const { logs } = logFixture(t)
  const session = Session.create(SessionId('native-collapsed-before'))
  const history = { logs, sessions: { get: () => session },
  readSession: async () => eventLog(session.snapshotEvents()) }
  const source = createToolEvents(config, history)
  const calls: SessionEvent[] = []
  for (const collapsed of [true, false]) {
    const callId = ToolCallId(collapsed ? 'collapsed' : 'unknown'), name = 'probe'
    const call = session.append('tool/call', { turn: 0, step: 0, callId, name, arguments: '{}' })
    calls.push(call); source.observe(session, call)
    const text = collapsed
      ? 'Error: unknown tool "probe": only `run_code` is callable directly — call `probe` from inside a `run_code` program instead'
      : 'Error: unknown tool "probe"'
    const terminal = session.append('tool/result', { turn: 0, step: 0,
      message: createToolResultMessage({ callId, isError: true, content: [{ type: 'text', text }] }),
      error: { name: 'ToolNotFoundError', code: 'UNKNOWN_TOOL' },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    assert.equal(source.observe(session, terminal)?.event.type, 'tool.failed', 'both are actual terminal failures')
  }
  const before = (index: number) => ({ sessionId: String(session.id), callId: 'copied', rootCallId: 'copied', origin: 'human' as const, facts: {},
    native: { type: 'tool-call' as const, seq: calls[index].seq } })
  await assert.rejects(source.resolve(before(0)), /native-tool-call-not-dispatched/)
  assert.equal((await source.resolve(before(1))).callId, 'unknown')
  const cold = createToolEvents(config, { ...history, sessions: { ...history.sessions, get: () => undefined } })
  await assert.rejects(cold.resolve(before(0)), /native-tool-call-not-dispatched/)
  assert.equal((await cold.resolve(before(1))).callId, 'unknown')
  for (const [index, callId] of ['collapsed', 'unknown'].entries()) {
    const anchor = { ...before(index), native: { type: 'tool-result' as const, seq: calls[index].seq + 1 } }
    const failure = await cold.resolve(anchor)
    assert.equal(failure.type, 'tool.failed'); assert.equal(failure.callId, callId)
    const raw = await cold.resolve({ ...anchor, native: { type: 'session-event', seq: anchor.native.seq } })
    assert.equal(raw.type, 'session.event'); assert.equal(raw.callId, `tool/result#${anchor.native.seq}`)
  }
})

test('native abandoned-before-dispatch result produces no reminder trigger', t => {
  const { logs, sessions } = logFixture(t)
  const session = Session.create(SessionId('native-skipped-event')), source = createToolEvents(config, { logs, sessions, readSession: async () => logs.live(session) })
  const callId = ToolCallId('skipped')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'probe', arguments: '{}' })
  source.observe(session, call)
  const result = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: true, content: [{ type: 'text', text: 'abandoned' }] }),
    error: { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  assert.equal(source.observe(session, result), undefined)
})
