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

test('a source added during native recovery gets its own complete selection without concurrent scans', async t => {
  let markEntered: () => void = () => {}, releaseScan: () => void = () => {}
  const entered = new Promise<void>(resolve => { markEntered = resolve })
  const released = new Promise<void>(resolve => { releaseScan = resolve })
  const selections: string[][] = []
  let active = 0, maxActive = 0
  const runtime = createReminderRuntime({ config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: asBatch(async () => ({ ok: true })),
    async recoverEvents(sessionId, accept, signal, selection) {
      active++; maxActive = Math.max(maxActive, active)
      selections.push([...selection.sessionEvents])
      try {
        if (selections.length === 1) { markEntered(); await released }
        signal.throwIfAborted()
        for (const name of selection.sessionEvents) {
          await accept({ type: 'session.event', sessionId, name, callId: `${name}#1`, rootCallId: `${name}#1`,
            arguments: {}, clock: { at: 1 }, origin: 'tool', facts: {} })
        }
      } finally { active-- }
    },
  })
  t.after(() => runtime.close())
  runtime.registerSource(source('tool/call'))
  const input = { sessionId: 'selection-change', visible: [] }
  const first = runtime.collect(input)
  await entered
  runtime.registerSource(source('assistant/message'))
  const second = runtime.collect(input)
  releaseScan()
  const results = await Promise.all([first, second])
  assert.deepEqual(selections, [['tool/call'], ['assistant/message', 'tool/call']])
  assert.equal(maxActive, 1, 'a second selection waits for the first session scan')
  assert.deepEqual(results.flat().map(message => message.content[0].text).sort(), ['assistant/message', 'tool/call'])
  assert.deepEqual(runtime.snapshot('selection-change').candidates.map(candidate => candidate.ruleId).sort(),
    ['assistant/message', 'tool/call'], 'the overlapping trigger still has only one candidate')
})
