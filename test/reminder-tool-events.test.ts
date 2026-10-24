import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolCallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { createToolEvents } from '../lib/reminder-runtime/tool-events.js'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createTemplates } from '../src/templates.js'

const config = { maxContextChars: 256, maxContextMessages: 8, maxQueued: 2, maxConcurrent: 1 }

test('native anchored trigger reconstructs its historical prefix after cache loss and later context', async () => {
  const session = Session.create(SessionId('native-tool-prefix')), events: SessionEvent[] = []
  let reads = 0, preparations = 0
  const history: NonNullable<Parameters<typeof createToolEvents>[1]> = {
    sessions: { get: id => id === session.id ? session : undefined,
      prepare: (id, options) => {
        preparations++
        return Session.create(id ?? SessionId('detached-prefix'), options?.seed)
      } },
    readSession: async id => { assert.equal(id, session.id); reads++; return { events } },
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
  assert.equal(reads, 1); assert.equal(preparations, 1)
  assert.deepEqual(await source.resolve(tampered), expected)
  assert.equal(reads, 1, 'the reconstructed value is also a disposable bounded cache')
  const dormant = createToolEvents(config, { ...history, sessions: { ...history.sessions, get: () => undefined } })
  assert.deepEqual(await dormant.resolve(tampered), expected, 'a detached source does not require a live Agent')
  assert.equal(reads, 2); assert.equal(preparations, 2)
  const controller = new AbortController(); controller.abort(new Error('stop native replay'))
  await assert.rejects(source.resolve(tampered, controller.signal), /stop native replay/)
  assert.equal(reads, 2)
  await assert.rejects(source.resolve({ ...tampered, native: { type: 'tool-result', seq: call.seq } }), /result-not-found/)
})

test('native tool trigger uses committed arguments outcome time and the preceding context', () => {
  const session = Session.create(SessionId('native-tool-events')), source = createToolEvents(config)
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

test('native PTC result keeps the subcall root and derives the same trigger with an empty fold cache', async () => {
  const session = Session.create(SessionId('native-ptc-events')), source = createToolEvents(config)
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
  const cold = createToolEvents(config)
  assert.deepEqual(cold.observe(session, end)?.event, submitted.event, 'the PTC terminal event contains its own call facts')
  const later = session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Later than the nested result.' }] }), { surfaceOp: 'append' })
  let preparations = 0
  const recovered = createToolEvents(config, {
    sessions: { get: () => undefined, prepare: (id, options) => {
      preparations++
      return Session.create(id ?? SessionId('detached-ptc-prefix'), options?.seed)
    } }, readSession: async () => ({ events: [start, end, later], inheritedEventCount: 0 }),
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
  assert.equal(preparations, 1, 'reconstructing a before-execution event needs no model-context prefix')
})

test('runtime collection discovers a tool committed after an earlier empty dormant scan', async t => {
  const session = Session.create(SessionId('native-runtime-growth'))
  const source = createToolEvents(config, { sessions: { get: () => undefined,
    prepare: (id, options) => Session.create(id ?? SessionId('runtime-growth-prefix'), options?.seed) },
    readSession: async () => ({ events: session.snapshotEvents(), inheritedEventCount: 0 }),
  })
  const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 2000 })
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }, templates: createTemplates(),
    execute: (input, signal, timing) => matcher.detect(input, signal, timing),
    resolveEvent: (event, signal) => source.resolve(event, signal),
    recoverEvents: (id, accept, signal) => source.recover(id, accept, signal),
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
  session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'REAL_LATER_RESULT' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  const messages = await collect()
  assert.equal(messages.length, 1, 'an earlier empty scan cannot prove a dormant log remained empty')
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'RECOVERED late.ts' }])
})

test('native recovery follows Session replacement dormant growth and calls pending at attachment', async () => {
  const session = Session.create(SessionId('native-changing-history'))
  const callId = ToolCallId('pending-at-attachment')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'probe', arguments: '{"historical":true}' })
  let live: Session | undefined = session, reads = 0
  const source = createToolEvents(config, {
    sessions: { get: () => live,
      prepare: (id, options) => Session.create(id ?? SessionId('changing-history-prefix'), options?.seed) },
    readSession: async () => { reads++; return { events: session.snapshotEvents(), inheritedEventCount: 0 } },
  })
  const found: Awaited<ReturnType<typeof source.resolve>>[] = []
  const recover = () => source.recover(String(session.id), async event => { found.push(event) }, new AbortController().signal)
  await recover()
  assert.equal(reads, 1); assert.equal(found.length, 0)
  const terminal = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'COMPLETED_LATER' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  assert.deepEqual(source.observe(session, terminal)?.event.arguments, { historical: true }, 'a call restored as pending pairs with its later live result')
  await recover()
  assert.equal(reads, 1, 'a completely observed live instance requires no second scan')
  live = Session.create(session.id, session.snapshotEvents())
  await recover()
  assert.equal(reads, 2, 'a different Session object cannot inherit the previous instance marker')
  assert.deepEqual(found.map(event => event.callId), [callId])
  live = undefined
  await recover()
  assert.equal(reads, 3, 'an unattached native log must be queried again')
  const nextId = ToolCallId('written-elsewhere'), next = session.append('tool/call', {
    turn: 0, step: 1, callId: nextId, name: 'probe', arguments: '{"later":true}',
  })
  session.append('tool/result', { turn: 0, step: 1,
    message: createToolResultMessage({ callId: nextId, isError: false, content: [{ type: 'text', text: 'EXTERNAL_RESULT' }] }),
  }, { surfaceOp: 'append', sourceEventSeqs: [next.seq] })
  found.length = 0
  await recover()
  assert.equal(reads, 4)
  assert.deepEqual(found.map(event => event.callId), [callId, nextId], 'dormant growth is never hidden by a session-id cache')
})

test('cold discovery selects local dispatched tools and leaves inherited and cancelled work alone', async () => {
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
    sessions: { get: () => undefined, prepare: (id, options) => Session.create(id ?? SessionId('discovery-prefix'), options?.seed) },
    readSession: async () => { reads++; return { events, inheritedEventCount: inherited } },
  })
  const found: Awaited<ReturnType<typeof source.resolve>>[] = []
  await source.recover(String(session.id), async event => { found.push(event) }, new AbortController().signal)
  assert.deepEqual(found.map(event => event.callId), [subCallId])
  assert.deepEqual(found[0].arguments, { local: true })
  assert.deepEqual(found[0].context?.messages.map(message => message.text), ['INHERITED_RESULT'])
  assert.equal(reads, 1)
  const cancelled = new AbortController(); cancelled.abort(new Error('discovery cancelled'))
  await assert.rejects(source.recover(String(session.id), async () => assert.fail('cancelled replay submitted work'), cancelled.signal), /discovery cancelled/)
  assert.equal(reads, 1)
  const hot = Session.create(SessionId('observed-from-creation'))
  const live = createToolEvents(config, { sessions: { get: () => hot,
    prepare: () => { throw new Error('live prefix must not be prepared') } },
    readSession: async () => { throw new Error('live history must not be read') } })
  live.created(hot)
  await live.recover(String(hot.id), async () => assert.fail('live trigger was rediscovered'), new AbortController().signal)
})

test('abandoned native calls cannot recover a before-execution trigger from live or cold caches', async () => {
  const session = Session.create(SessionId('native-skipped-before'))
  const source = createToolEvents(config, { sessions: { get: () => session,
    prepare: () => { throw new Error('abandoned call needs no historical context') } },
    readSession: async () => ({ events: session.snapshotEvents(), inheritedEventCount: 0 }),
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
  const found: Awaited<ReturnType<typeof source.resolve>>[] = []
  await source.recover(String(session.id), async event => { found.push(event) }, new AbortController().signal,
    { tools: true, beforeTools: true, outputs: false, sessionEvents: ['tool/result'] })
  assert.deepEqual(found.map(event => event.type), ['session.event'], 'the raw cancellation remains a real native event; no execution or outcome trigger is invented')
})

test('PTC collapsed route excludes only its before trigger while an ordinary unknown name keeps it', async () => {
  const session = Session.create(SessionId('native-collapsed-before'))
  const history = { sessions: { get: () => session,
    prepare: (id: Parameters<typeof Session.create>[0], options?: { seed?: SessionEvent[] }) => Session.create(id ?? SessionId('collapsed-prefix'), options?.seed) },
  readSession: async () => ({ events: session.snapshotEvents(), inheritedEventCount: 0 }) }
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
  const found: Awaited<ReturnType<typeof source.resolve>>[] = []
  const cold = createToolEvents(config, { ...history, sessions: { ...history.sessions, get: () => undefined } })
  await cold.recover(String(session.id), async event => { found.push(event) }, new AbortController().signal,
    { tools: true, beforeTools: true, outputs: false, sessionEvents: ['tool/result'] })
  assert.deepEqual(found.map(event => [event.type, event.callId]), [
    ['tool.failed', 'collapsed'], ['session.event', `tool/result#${calls[0].seq + 1}`],
    ['tool.before-execute', 'unknown'], ['tool.failed', 'unknown'], ['session.event', `tool/result#${calls[1].seq + 1}`],
  ])
})

test('native abandoned-before-dispatch result produces no reminder trigger', () => {
  const session = Session.create(SessionId('native-skipped-event')), source = createToolEvents(config)
  const callId = ToolCallId('skipped')
  const call = session.append('tool/call', { turn: 0, step: 0, callId, name: 'probe', arguments: '{}' })
  source.observe(session, call)
  const result = session.append('tool/result', { turn: 0, step: 0,
    message: createToolResultMessage({ callId, isError: true, content: [{ type: 'text', text: 'abandoned' }] }),
    error: { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  assert.equal(source.observe(session, result), undefined)
})
