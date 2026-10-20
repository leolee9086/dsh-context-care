import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { executeReminderMatch } from '../lib/reminder-runtime/matcher.js'
import { ReminderRule, compileRule } from '../lib/reminder-runtime/schema.js'
import { SESSION_EVENT_COUNT, SESSION_EVENT_TYPES,
  SESSION_EVENT_SOURCE_VERSION } from '../lib/reminder-runtime/generated/session-events.js'
import type { MessageView } from '../lib/reminder-runtime/request-context.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000 })
after(async () => { await matcher.close() })
const port = (input: Parameters<typeof matcher.detect>[0], signal: AbortSignal, timing: Parameters<typeof matcher.detect>[2]) =>
  matcher.detect(input, signal, timing)

const config = { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }
const texts = (messages: MessageView[]) => messages.map(message =>
  (message.content ?? []).map(block => block.text ?? '').join(''))
const committed = (type: string, seq = 1, data: unknown = {}) => ({ type: 'session.event', sessionId: 's',
  callId: `${type}#${seq}`, rootCallId: `${type}#${seq}`, name: type, clock: { at: 1000 }, arguments: data })
const rule = (eventType: string, condition?: unknown) => ({ format: 'reminder/v4', id: 'notice',
  on: 'session.event', text: '看到了 ' + eventType,
  when: { eventType, ...(condition === undefined ? {} : { condition }) },
  effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } })

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
    rules: [{ ...rule('tool/result'), text: '工具 {{event.arguments.tool}} 结束了' }] })
  await runtime.submit(committed('tool/result', 4, { tool: 'read' }))
  assert.deepEqual(texts(await runtime.collect({ sessionId: 's', visible: [] })), ['工具 read 结束了'])
})

test('事件类型必须是名字；名字本身在编译时校验', () => {
  const base = { format: 'reminder/v4', id: 'r', on: 'session.event', text: 't',
    when: { eventType: 'tool/result' },
    effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }
  assert.equal(ReminderRule.safeParse({ ...base, when: { eventType: 42 } }).success, false)
  assert.equal(ReminderRule.safeParse({ ...base, when: { eventType: '' } }).success, false)
  assert.equal(ReminderRule.safeParse(base).success, true)
  // Whether the name exists is decided where declarations are known, not here.
  assert.throws(() => compileRule({ ...base, when: { eventType: 'tool/not-a-real-event' } }),
    /未声明的事件类型 tool\/not-a-real-event/)
  const compiled = compileRule(base)
  if (compiled.on !== 'session.event') throw new Error('expected a session.event rule')
  assert.equal(compiled.when.eventType, 'tool/result')
})

test('声明过的自定义事件能按名匹配，重复发布被幂等键挡住', async t => {
  const runtime = fixture(t)
  const dispose = runtime.registerCustomEvents([{ name: 'care/fatigue-high',
    shape: { kind: 'object', fields: { level: null, detail: { kind: 'object', fields: { note: null }, index: null } }, index: null } }])
  t.after(dispose)
  runtime.registerSource({ sourceId: 'custom', plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'n', on: 'session.event', text: '累了',
      when: { eventType: 'care/fatigue-high',
        condition: { kind: 'compare', field: 'event.arguments.detail.note', op: 'exists' } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })
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
    rules: [{ format: 'reminder/v4', id: 'n', on: 'session.event', text: 't',
      when: { eventType: 'care/fatigue-high',
        condition: { kind: 'compare', field: 'event.arguments.details', op: 'exists' } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] }),
  /不存在于事件 care\/fatigue-high 的载荷中/)
  // Withdrawing the declaration takes the name with it.
  dispose()
  assert.equal(runtime.handlesSessionEvent('care/fatigue-high'), false)
  await assert.rejects(() => runtime.publishCustomEvent({ sessionId: 's', name: 'care/fatigue-high',
    eventId: 'e-2' }), /未被声明/)
})

test('未声明的事件名在加载时被拒，不能悄悄永不命中', t => {
  const runtime = fixture(t)
  assert.throws(() => runtime.registerSource({ sourceId: 'ghost', plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'n', on: 'session.event', text: 't',
      when: { eventType: 'care/never-declared' },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] }),
  /未声明的事件类型 care\/never-declared/)
  // A built-in name is still accepted, and a typo in one is not.
  assert.throws(() => runtime.registerSource({ sourceId: 'typo', plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'n', on: 'session.event', text: 't',
      when: { eventType: 'tool/results' },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] }),
  /未声明的事件类型 tool\/results/)
})

test('阻断只能在执行前声明，日志事件不能拒绝已经发生的事', () => {
  const deny = { format: 'reminder/v4', id: 'r', on: 'session.event', text: 't',
    when: { eventType: 'tool/result' },
    effect: { kind: 'deny-tool', dangerous: true, reason: '已发生的事不能拒绝', deliver: { model: { once: 'surface' } } } }
  assert.equal(ReminderRule.safeParse(deny).success, false)
})

test('载荷字段在加载时对照发行结构校验，拼错即报错', t => {
  const runtime = fixture(t)
  const source = (condition: unknown, sourceId: string) => ({ sourceId, plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'n', on: 'session.event', text: 't',
      when: { eventType: 'tool/result', condition },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })
  const compare = (field: string) => ({ kind: 'compare', field, op: 'exists' })
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
    source: { kind: 'text', field: 'event.arguments.nope', projection: 'raw', locale: 'zh-CN' },
    pattern: { kind: 'literal', text: 'x' }, metric: 'occurrences', window: { kind: 'current-block' },
    compare: { op: 'gte', value: 1 },
    limits: { maxTextChars: 1000, maxCandidates: 100, maxUnits: 100, maxEvidence: 4 } }, 'bad-count')),
  /不存在于事件 tool\/result 的载荷中/)
  // Analyzer facts have no released schema, so they stay dynamic.
  runtime.registerSource(source(compare('facts.anything'), 'facts'))
})
