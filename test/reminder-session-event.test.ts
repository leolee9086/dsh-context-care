import type { MessageView, ConditionNode } from '@leolee9086/dsh-rule-engine'
import { executeEventMatch as executeReminderMatch, EventRule as ReminderRule, compileEventActions as compileRule, createBoundedMatcher } from '@leolee9086/dsh-rule-engine'
import test, { after } from 'node:test'
import { eventRule } from './event-rule.js'

import assert from 'node:assert/strict'
import { createReminderRuntime } from './reminder-runtime-fixture.ts'

import { SESSION_EVENT_COUNT, SESSION_EVENT_TYPES, SESSION_EVENT_PAYLOAD_SHAPES,
  SESSION_EVENT_SOURCE_VERSION } from '../lib/reminder-runtime/generated/session-events.js'

const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000 })
after(async () => { await matcher.close() })
const port = (input: Parameters<typeof matcher.detect>[0], signal: AbortSignal, timing: Parameters<typeof matcher.detect>[2]) =>
  matcher.detect(input, signal, timing)

const config = { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }
const texts = (messages: MessageView[]) => messages.map(message =>
  (message.content ?? []).map(block => block.text ?? '').join(''))
const committed = (type: string, seq = 1, data: unknown = {}) => ({ type: 'session.event', sessionId: 's',
  callId: `${type}#${seq}`, rootCallId: `${type}#${seq}`, name: type, clock: { at: 1000 }, arguments: data })
const rule = (eventType: string, condition?: ConditionNode) => eventRule('session.event',
  { event: { eventType }, ...(condition === undefined ? {} : { match: condition }) }, { template: '看到了 ' + eventType })
const catalog = { names: new Set(SESSION_EVENT_TYPES), shapes: new Map(Object.entries(SESSION_EVENT_PAYLOAD_SHAPES)) }

function fixture(t: { after: (fn: () => unknown) => void }) {
  // Evaluate the real condition tree in-process instead of stubbing the result out.
  const runtime = createReminderRuntime({ config, execute: port })
  t.after(() => runtime.close())
  return runtime
}

test('事件目录来自 DSH 发布的事件清单', () => {
  assert.ok(SESSION_EVENT_COUNT > 0)
  assert.equal(SESSION_EVENT_TYPES.length, SESSION_EVENT_COUNT)
  assert.equal(new Set(SESSION_EVENT_TYPES).size, SESSION_EVENT_COUNT)
  assert.match(SESSION_EVENT_SOURCE_VERSION, /\d+\.\d+\.\d+/)
  // Names DSH actually publishes; a misspelling here means the catalog drifted.
  for (const name of ['turn/start', 'tool/call', 'tool/result', 'user/message']) {
    assert.ok(SESSION_EVENT_TYPES.includes(name as never), name)
  }
})

test('session.event 按住事件名匹配，载荷字段供条件使用', async t => {
  const runtime = fixture(t)
  // `message.isError` is a real path of the released tool/result payload.
  runtime.registerSource({ sourceId: 'log', plugin: 'test', revision: 1,
    rules: [rule('tool/result', { kind: 'compare', field: 'event.arguments.message.isError', op: 'eq', value: true })] })
  assert.equal(runtime.handlesSessionEvent('tool/result'), true)
  assert.equal(runtime.handlesSessionEvent('turn/start'), false)
  // Another event type is not this rule's business.
  await runtime.submit(committed('turn/start', 1, { turn: 1 }))
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  await runtime.submit(committed('tool/result', 2, { message: { isError: false } }))
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  await runtime.submit(committed('tool/result', 3, { message: { isError: true } }))
  assert.deepEqual(texts(await runtime.collect({ sessionId: 's', visible: [] })), ['看到了 tool/result'])
})

test('模板能读到本次日志事件的冻结载荷', async t => {
  const runtime = createReminderRuntime({ config, templates: { validate: () => {},
    render: (source: string, snapshot: unknown) => source.replace('{{event.arguments.tool}}',
      String((snapshot as { event?: { arguments?: { tool?: unknown } } }).event?.arguments?.tool)) }, execute: port })
  t.after(() => runtime.close())
  runtime.registerSource({ sourceId: 'log', plugin: 'test', revision: 1,
    rules: [{ ...rule('tool/result'), actions: rule('tool/result').actions.map(action => ({ ...action, template: '工具 {{event.arguments.tool}} 结束了' })) }] })
  await runtime.submit(committed('tool/result', 4, { tool: 'read' }))
  assert.deepEqual(texts(await runtime.collect({ sessionId: 's', visible: [] })), ['工具 read 结束了'])
})

test('事件类型必须是名字；名字本身在编译时校验', () => {
  const base = rule('tool/result')
  assert.equal(ReminderRule.safeParse({ ...base, event: { eventType: 42 } }).success, false)
  assert.equal(ReminderRule.safeParse({ ...base, event: { eventType: '' } }).success, false)
  assert.equal(ReminderRule.safeParse(base).success, true)
  // Whether the name exists is decided where declarations are known, not here.
  assert.throws(() => compileRule({ ...base, event: { eventType: 'tool/not-a-real-event' } }),
    /未声明的事件类型 tool\/not-a-real-event/)
  const [compiled] = compileRule(base, undefined, undefined, catalog)
  if (compiled?.stage !== 'session.event') throw new Error('expected a session.event rule')
  assert.equal(compiled.event.eventType, 'tool/result')
})

test('声明过的自定义事件能按名匹配，重复发布被幂等键挡住', async t => {
  const runtime = fixture(t)
  const dispose = runtime.registerCustomEvents([{ name: 'care/fatigue-high',
    shape: { kind: 'object', fields: { level: null, detail: { kind: 'object', fields: { note: null }, index: null } }, index: null } }])
  t.after(dispose)
  runtime.registerSource({ sourceId: 'custom', plugin: 'test', revision: 1,
    rules: [eventRule('session.event', { id: 'n', event: { eventType: 'care/fatigue-high' },
      match: { kind: 'compare', field: 'event.arguments.detail.note', op: 'exists' } }, { template: '累了' })] })
  assert.equal(runtime.handlesSessionEvent('care/fatigue-high'), true)
  await runtime.publishCustomEvent({ sessionId: 's', name: 'care/fatigue-high', eventId: 'e-1',
    at: 5000, facts: { level: 'high', detail: { note: 'x' } } })
  assert.deepEqual(texts(await runtime.collect({ sessionId: 's', visible: [] })), ['累了'])
  // The same idempotency key is a replay, not a second event.
  await runtime.publishCustomEvent({ sessionId: 's', name: 'care/fatigue-high', eventId: 'e-1',
    at: 5000, facts: { level: 'high', detail: { note: 'x' } } })
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  // A declared name still checks selectors against its declared shape.
  assert.throws(() => runtime.registerSource({ sourceId: 'bad', plugin: 'test', revision: 1,
    rules: [eventRule('session.event', { id: 'n', event: { eventType: 'care/fatigue-high' },
      match: { kind: 'compare', field: 'event.arguments.details', op: 'exists' } }, { template: 't' })] }),
  /不存在于事件 care\/fatigue-high 的载荷中/)
  // Withdrawing the declaration takes the name with it.
  dispose()
  assert.equal(runtime.handlesSessionEvent('care/fatigue-high'), false)
  await assert.rejects(() => runtime.publishCustomEvent({ sessionId: 's', name: 'care/fatigue-high',
    eventId: 'e-2' }), /未被声明/)
})

test('native custom declarations validate atomically and keep independent owners', t => {
  const runtime = createReminderRuntime({ sessionAuthoritative: true })
  t.after(() => runtime.close())
  assert.throws(() => runtime.registerCustomEvents([{ name: 'care/unlogged' }]), /需要 nativeEvent/)
  assert.throws(() => runtime.registerCustomEvents([{ name: 'care/bad-shape', nativeEvent: 'tool/result', shape: 'any' }]), /载荷结构必须与原生事件/)
  assert.throws(() => runtime.registerCustomEvents([
    { name: 'care/atomic', nativeEvent: 'tool/result' }, { name: 'user/message', nativeEvent: 'user/message' },
  ]), /不能占用内置事件名/)
  assert.throws(() => runtime.registerSource({ sourceId: 'atomic', plugin: 'test', revision: 1,
    rules: [rule('care/atomic')] }), /未声明的事件类型/)
  const descriptor = { name: 'care/owned', nativeEvent: 'tool/result' as const }
  const first = runtime.registerCustomEvents([descriptor]), second = runtime.registerCustomEvents([descriptor])
  runtime.registerSource({ sourceId: 'owned', plugin: 'test', revision: 1, rules: [rule(descriptor.name)] })
  assert.equal(runtime.handlesSessionEvent('tool/result'), true)
  assert.throws(() => runtime.validateRule(rule(descriptor.name, {
    kind: 'compare', field: 'event.arguments.nonexistent_payload', op: 'exists',
  })), /不存在于事件/)
  first()
  assert.equal(runtime.handlesSessionEvent('tool/result'), true, 'the second producer still owns the same declaration')
  second()
  assert.equal(runtime.handlesSessionEvent('tool/result'), false)
})

test('未声明的事件名在加载时被拒，不能悄悄永不命中', t => {
  const runtime = fixture(t)
  assert.throws(() => runtime.registerSource({ sourceId: 'ghost', plugin: 'test', revision: 1,
    rules: [rule('care/never-declared')] }),
  /未声明的事件类型 care\/never-declared/)
  // A built-in name is still accepted, and a typo in one is not.
  assert.throws(() => runtime.registerSource({ sourceId: 'typo', plugin: 'test', revision: 1,
    rules: [rule('tool/results')] }),
  /未声明的事件类型 tool\/results/)
})

test('阻断只能在执行前声明，日志事件不能拒绝已经发生的事', () => {
  const deny = eventRule('session.event', { id: 'r', event: { eventType: 'tool/result' } },
    { template: 't', deny: { dangerous: true, reason: '已发生的事不能拒绝' } })
  assert.equal(ReminderRule.safeParse(deny).success, false)
})

test('载荷字段在加载时对照发行结构校验，拼错即报错', t => {
  const runtime = fixture(t)
  const source = (condition: ConditionNode, sourceId: string) => ({ sourceId, plugin: 'test', revision: 1,
    rules: [eventRule('session.event', { id: 'n', event: { eventType: 'tool/result' }, match: condition }, { template: 't' })] })
  const compare = (field: string): ConditionNode => ({ kind: 'compare', field, op: 'exists' })
  // Declared fields resolve, including nested ones and array elements.
  for (const field of ['event.arguments.turn', 'event.arguments.message.isError',
    'event.arguments.message.content.0.type', 'event.name', 'event.clock.at']) {
    runtime.registerSource(source(compare(field), `ok-${field}`))
  }
  // A misspelled or absent field is refused where the rule is loaded.
  for (const field of ['event.arguments.turns', 'event.arguments.message.isErorr', 'event.names']) {
    assert.throws(() => runtime.registerSource(source(compare(field), `bad-${field}`)),
      /不存在于事件 tool\/result 的载荷中/, field)
  }
  // A count reads its text through source.field, so that path is checked too.
  assert.throws(() => runtime.registerSource(source({ kind: 'count',
    source: { kind: 'text', field: 'event.arguments.nope', projection: 'raw', locale: 'zh-CN', metaPrefixes: [] },
    pattern: { kind: 'literal', text: 'x' }, metric: 'occurrences', window: { kind: 'current-block' },
    compare: { op: 'gte', value: 1 }, evaluate: 'complete',
    limits: { maxTextChars: 1000, maxCandidates: 100, maxUnits: 100, maxEvidence: 4 } }, 'bad-count')),
  /不存在于事件 tool\/result 的载荷中/)
  // Analyzer facts have no released schema, so they stay dynamic.
  runtime.registerSource(source(compare('facts.anything'), 'facts'))
})
