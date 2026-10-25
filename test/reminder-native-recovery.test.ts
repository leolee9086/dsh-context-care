import test from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime, type ReminderSource } from '../lib/reminder-runtime/runtime.js'
import { asBatch } from './batch-execute.ts'

const source = (eventType: 'tool/call' | 'assistant/message'): ReminderSource => ({
  sourceId: eventType, plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: eventType, on: 'session.event', when: { eventType }, text: eventType,
    effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }],
})

test('adding a source never discovers old events and current explicit submissions remain deduplicated', async t => {
  let scans = 0
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: asBatch(async () => ({ ok: true })),
    async resolveEvent(event) { scans++; return event },
  })
  t.after(() => runtime.close())
  runtime.registerSource(source('tool/call'))
  const input = { sessionId: 'selection-change', visible: [] }
  const first = runtime.collect(input)
  runtime.registerSource(source('assistant/message'))
  assert.deepEqual(await Promise.all([first, runtime.collect(input)]), [[], []])
  assert.equal(scans, 0, 'registration changes do not schedule historical work')
  for (const name of ['tool/call', 'assistant/message']) {
    const event = { type: 'session.event' as const, sessionId: input.sessionId, name, callId: `${name}#1`, rootCallId: `${name}#1`,
      arguments: {}, clock: { at: 1 }, origin: 'tool' as const, facts: {} }
    await runtime.submit(event)
    await runtime.submit(event)
  }
  const messages = await runtime.collect(input)
  assert.deepEqual(messages.map(message => message.content[0].text).sort(), ['assistant/message', 'tool/call'])
  assert.deepEqual(await runtime.collect(input), [], 'a repeated collection cannot reserve another copy')
  assert.equal(scans, 0, 'unanchored explicit submissions need no native history lookup')
  assert.deepEqual(runtime.snapshot(input.sessionId).candidates.map(candidate => candidate.ruleId).sort(),
    ['assistant/message', 'tool/call'], 'each explicitly submitted occurrence has one candidate')
})
