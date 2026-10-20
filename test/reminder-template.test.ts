import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'
import { createTemplates } from '../src/templates.js'
import type { MessageView } from '../lib/reminder-runtime/request-context.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000 })
after(async () => { await matcher.close() })
const port = (input: Parameters<typeof matcher.detect>[0], signal: AbortSignal, timing: Parameters<typeof matcher.detect>[2]) =>
  matcher.detect(input, signal, timing)

const config = { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 }
const templates = createTemplates()
const probe = (id: string) => ({ sessionId: 's', callId: id, rootCallId: id, name: 'probe', arguments: { path: 'a.ts' } })
const rule = (text: string, extra: Record<string, unknown> = {}) => ({ format: 'reminder/v4', id: 'notice',
  on: 'tool.succeeded', text, when: { tool: 'probe' },
  effect: { kind: 'remind', deliver: { model: { once: 'surface' } } }, ...extra })
const texts = (messages: MessageView[]) => messages.map(message =>
  (message.content ?? []).map(block => block.text ?? '').join(''))
const ids = (visible: MessageView[]) => visible.flatMap(message => message.id === undefined ? [] : [message.id])
const fixture = (t: { after: (fn: () => unknown) => void }) => {
  const runtime = createReminderRuntime({ config, templates, execute: port })
  t.after(() => runtime.close())
  return runtime
}

test('模板在首次投递时渲染一次，读取冻结的事件事实与捕获', async t => {
  const runtime = fixture(t)
  runtime.registerSource({ sourceId: 'tpl', plugin: 'test', revision: 1,
    rules: [rule('工具 {{event.name}} 写入了 {{event.arguments.path}}')] })
  await runtime.submit(probe('hit'))
  const messages = await runtime.collect({ sessionId: 's', visible: [] })
  assert.deepEqual(texts(messages), ['工具 probe 写入了 a.ts'])
  const candidate = runtime.snapshot('s').candidates[0]
  // The stored text is the rendered result, so nothing re-renders later.
  assert.equal(candidate?.text, '工具 probe 写入了 a.ts')
  assert.equal(candidate?.rendered, true)
})

test('固定文本不受影响，且没有模板引擎时拒绝含占位符的正文', async t => {
  const runtime = fixture(t)
  runtime.registerSource({ sourceId: 'fixed', plugin: 'test', revision: 1, rules: [rule('普通提醒')] })
  await runtime.submit(probe('hit'))
  assert.deepEqual(texts(await runtime.collect({ sessionId: 's', visible: [] })), ['普通提醒'])
  const bare = createReminderRuntime({ config, execute: port })
  t.after(() => bare.close())
  // Without an injected engine a placeholder could never be substituted, so it is refused.
  assert.throws(() => bare.registerSource({ sourceId: 'no-engine', plugin: 'test', revision: 1,
    rules: [rule('你好 {{event.name}}')] }), /template-engine-unavailable/)
  bare.registerSource({ sourceId: 'no-engine-fixed', plugin: 'test', revision: 1, rules: [rule('普通')] })
})

test('非法模板与未知变量在加载期报错，不进入投递', async t => {
  const runtime = fixture(t)
  const base = { sourceId: 'bad', plugin: 'test', revision: 1 }
  // Verified against the engine: an inline decorator is an unsupported directive,
  // while raw blocks and unregistered names are refused as unavailable helpers.
  assert.throws(() => runtime.registerSource({ ...base, rules: [rule('{{#*inline "x"}}y{{/inline}}')] }), /template-unsupported-directive/)
  assert.throws(() => runtime.registerSource({ ...base, rules: [rule('{{{{raw}}}}x{{{{/raw}}}}')] }), /template-helper-unavailable/)
  assert.throws(() => runtime.registerSource({ ...base, rules: [rule('{{lookup event "name"}}')] }), /template-helper-unavailable/)
  // Strict mode: a missing variable is an error at render time, and the delivery is dropped.
  runtime.registerSource({ ...base, rules: [rule('值 {{event.absent}}')] })
  await runtime.submit(probe('hit'))
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  const diagnostics = runtime.snapshot('s').diagnostics
  assert.equal(diagnostics.some(item => item.status === 'render-failed'), true)
})

test('sticky 激活复用首次渲染的正文而不重新渲染', async t => {
  const runtime = fixture(t)
  runtime.registerSource({ sourceId: 'tpl-sticky', plugin: 'test', revision: 1,
    rules: [rule('来自 {{event.name}}', { effect: { kind: 'remind', deliver: { model: { once: 'none',
      sticky: { lifetime: 2, cooldown: 0 } } } } })] })
  await runtime.submit(probe('first'))
  const first = await runtime.collect({ sessionId: 's', visible: [] })
  assert.deepEqual(texts(first), ['来自 probe'])
  // The activation tick reuses the stored text; a new event would render its own.
  const second = await runtime.collect({ sessionId: 's', visible: first, committedIds: ids(first) })
  assert.deepEqual(texts(second), ['来自 probe'])
})
