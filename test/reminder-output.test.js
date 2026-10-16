import test from 'node:test'
import assert from 'node:assert/strict'
import { createOutputStream } from '../src/reminder-runtime/output-stream.js'
import { createReminderRuntime } from '../src/reminder-runtime/index.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'

let revision = 1
const frame = (attemptId, chunk) => ({ type: 'chunk', attemptId, revision: ++revision, chunk })
const agent = 'session-a'

test('output stream joins deltas per readable block and isolates attempts and block types', async () => {
  const events = []
  const stream = createOutputStream({ sessionId: identity => identity, config: { maxStreamChars: 100, maxStreamBlocks: 4, streamEveryChars: 100, streamFlushMs: 10 },
    submit: async event => { events.push(event) }, afterSubmit: () => {}, report: error => { throw error }, enabled: () => true })
  stream.observe(agent, { type: 'start', attemptId: 'attempt-a', revision: 1, turn: 2, step: 1 })
  stream.observe(agent, frame('attempt-a', { type: 'block-start', index: 0, blockType: 'reasoning' }))
  stream.observe(agent, frame('attempt-a', { type: 'reasoning-delta', index: 0, text: '关键词' }))
  stream.observe(agent, frame('attempt-a', { type: 'block-end', index: 0, block: { type: 'reasoning', text: '' } }))
  stream.observe(agent, frame('attempt-a', { type: 'block-start', index: 1, blockType: 'text' }))
  stream.observe(agent, frame('attempt-a', { type: 'text-delta', index: 1, text: '正文' }))
  stream.observe(agent, { type: 'end', attemptId: 'attempt-a', revision: ++revision })
  stream.observe(agent, { type: 'start', attemptId: 'attempt-b', revision: 1, turn: 2, step: 2 })
  stream.observe(agent, frame('attempt-b', { type: 'text-delta', index: 0, text: '后续' }))
  stream.observe(agent, { type: 'end', attemptId: 'attempt-b', revision: ++revision })
  await stream.close()
  assert.deepEqual(events.map(event => [event.output.attemptId, event.output.type, event.output.text]), [
    ['attempt-a', 'reasoning', '关键词'], ['attempt-a', 'text', '正文'], ['attempt-b', 'text', '后续'],
  ])
})

test('v3 output literal, keyword and regex rules parse and match only declared block types', async t => {
  const matcher = createBoundedMatcher({ timeoutMs: 2000 })
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: (input, signal, timing) => matcher.detect(input, signal, timing) })
  t.after(async () => { await runtime.close(); await matcher.close() })
  runtime.registerSource({ sourceId: 'output-rules', plugin: 'test', revision: 1, rules: [
    { format: 'reminder/v3', id: 'reasoning', on: 'assistant.output', text: 'reasoning hit',
      when: { blockTypes: ['reasoning'], pattern: { kind: 'literal', text: '秘密' } }, deliver: { model: { once: 'surface' } } },
    { format: 'reminder/v3', id: 'keywords', on: 'assistant.output', text: 'keywords hit',
      when: { blockTypes: ['text'], pattern: { kind: 'keywords', values: ['foo', 'bar'], mode: 'all' } }, deliver: { model: { once: 'surface' } } },
    { format: 'reminder/v3', id: 'regex', on: 'assistant.output', text: 'regex hit',
      when: { blockTypes: ['text'], pattern: { kind: 'regex', regex: 'x[0-9]+' } }, deliver: { model: { once: 'surface' } } },
  ] })
  for (const [index, type, text] of [[0, 'text', '秘密 foo x-no-number'], [1, 'reasoning', 'foo bar x42']]) {
    await runtime.submit({ type: 'assistant.output', sessionId: 's', callId: `miss-${index}`, rootCallId: 'miss',
      output: { attemptId: 'miss', turn: 1, step: 1, index, type, text, offset: 0 } })
  }
  assert.deepEqual(await runtime.collect({ sessionId: 's', visible: [] }), [])
  await runtime.submit({ type: 'assistant.output', sessionId: 's', callId: 'a', rootCallId: 'a', output: { attemptId: 'a', turn: 1, step: 1, index: 0, type: 'reasoning', text: '秘密', offset: 0 } })
  await runtime.submit({ type: 'assistant.output', sessionId: 's', callId: 'b', rootCallId: 'b', output: { attemptId: 'b', turn: 1, step: 1, index: 0, type: 'text', text: 'foo bar x42', offset: 0 } })
  const messages = await runtime.collect({ sessionId: 's', visible: [] })
  assert.deepEqual(messages.map(message => message.content[0].text), ['reasoning hit', 'keywords hit', 'regex hit'])
})
