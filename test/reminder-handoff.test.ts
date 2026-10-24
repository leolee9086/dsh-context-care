import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createReminderRuntime, type ReminderSource } from '../lib/reminder-runtime/runtime.js'
import { candidateFromMessage } from '../lib/reminder-runtime/handoff.js'

const source: ReminderSource = { sourceId: 'native-handoff', plugin: 'test', revision: 1, rules: [{
  format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', when: { tool: 'probe' }, text: 'FROZEN_BODY',
  effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
}] }

test('native handoff validity and body override a conflicting startup candidate without a save or evaluation', async t => {
  const matcher = createBoundedMatcher({ timeoutMs: 2000, startupMs: 5000 })
  let evaluations = 0
  const hot = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: (input, signal, timing) => { evaluations++; return matcher.detect(input, signal, timing) } })
  t.after(async () => { await hot.close(); await matcher.close() })
  hot.registerSource(source)
  await hot.submit({ type: 'tool.succeeded', sessionId: 'recipient', callId: 'actual-tool', rootCallId: 'actual-root',
    name: 'probe', arguments: {} })
  const messages = await hot.collect({ sessionId: 'recipient', visible: [] })
  assert.equal(messages.length, 1)
  assert.equal(evaluations, 1)
  const { sources: _definitions, storageError: _storageError, ...poison } = hot.snapshot('recipient')
  for (const candidate of poison.candidates) {
    candidate.status = 'discarded'; candidate.text = 'UNTRUSTED_SIDE_BODY'; candidate.sourceSignature = 'outdated-side-signature'
  }
  const cold = createReminderRuntime({ entries: [['recipient', poison]],
    save: () => { throw new Error('native-reconstruction-must-not-save') },
    execute: () => { throw new Error('native-reconstruction-must-not-evaluate') } })
  t.after(() => cold.close())
  cold.registerSource(source)
  assert.deepEqual(await cold.filterMessages('recipient', [], messages), messages)
  const restored = cold.snapshot('recipient').candidates[0]
  assert.equal(restored?.text, 'FROZEN_BODY')
  assert.equal(restored?.status, 'reserved')
  assert.equal(restored?.messageId, messages[0]?.id)
  assert.equal(restored?.rootCallId, 'actual-root')
  assert.equal(evaluations, 1)
  assert.equal(candidateFromMessage('another-recipient', messages[0]!), undefined)
})
