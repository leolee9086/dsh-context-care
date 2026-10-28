import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import type { OutputConfig, OutputEvent } from '@leolee9086/dsh-rule-engine'
import { createOutputStream } from '../lib/reminder-runtime/output-stream.js'

const config: OutputConfig = { maxStreamChars: 16, maxStreamBlocks: 4, streamEveryChars: 4, streamFlushMs: 5,
  maxStreamPending: 32, maxStreamPendingBytes: 4096 }
const agent = 'typed-stream-test'
const sessionId = (identity: string) => identity

test('a delayed timer cannot move a prefix past the next recorded chunk', async () => {
  const events: OutputEvent[] = []
  const stream = createOutputStream({ sessionId, config: { ...config, streamEveryChars: 16 },
    submit: async event => { events.push(event) }, afterSubmit: () => {}, report: error => { throw error }, enabled: () => true })
  // No timer callback runs during this synchronous fixture feed. Injected chunk
  // times still separate the prefixes before terminal flush.
  stream.observe(agent, { type: 'start', attemptId: 'late-timer', revision: 1, turn: 1, step: 1 })
  stream.observe(agent, { type: 'chunk', time: 100, attemptId: 'late-timer', revision: 2,
    chunk: { type: 'text-delta', index: 0, text: 'abc' } })
  stream.observe(agent, { type: 'chunk', time: 110, attemptId: 'late-timer', revision: 3,
    chunk: { type: 'text-delta', index: 0, text: 'def' } })
  stream.observe(agent, { type: 'end', time: 120, attemptId: 'late-timer', revision: 4 })
  await stream.close()
  assert.deepEqual(events.map(event => [event.output.text, event.clock.at, event.textSamples[0]!.phase]), [
    ['abc', 105, 'prefix'], ['abcdef', 115, 'prefix'], ['abcdef', 120, 'complete'],
  ])
})

test('an abandoned live attempt supplies no complete evidence', async () => {
  const events: OutputEvent[] = []
  const stream = createOutputStream({ sessionId, config, submit: async event => { events.push(event) },
    afterSubmit: () => {}, report: error => { throw error }, enabled: () => true })
  stream.observe(agent, { type: 'start', attemptId: 'abandoned', revision: 1, turn: 1, step: 1 })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'abandoned', revision: 2,
    chunk: { type: 'text-delta', index: 0, text: 'abcde' } })
  stream.abandon(agent, { attemptId: 'abandoned', revision: 3 })
  await stream.close()
  assert.equal(events.length, 1)
  assert.equal(events[0]!.textSamples[0]!.phase, 'prefix')
  assert.equal(stream.isCurrent(agent, events[0]!.output), false)
})

test('stream caps in-flight work and reports one overflow for a single oversized transport chunk', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const events: OutputEvent[] = [], errors: unknown[] = []
  const stream = createOutputStream({ sessionId, config: { ...config, maxStreamPending: 2 },
    submit: async event => { events.push(event); await gate }, afterSubmit: () => {}, report: error => errors.push(error), enabled: () => true })
  stream.observe(agent, { type: 'start', attemptId: 'bounded', revision: 1, turn: 1, step: 1 })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'bounded', revision: 2,
    chunk: { type: 'text-delta', index: 0, text: 'early-marker'.repeat(100000) } })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'bounded', revision: 3,
    chunk: { type: 'text-delta', index: 0, text: 'later' } })
  assert.equal(events.length, 2)
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]), /pending-budget-exceeded/)
  release(); await stream.close()
})

test('stream byte budget includes event metadata and UTF-8 bytes', async () => {
  const events: OutputEvent[] = [], errors: unknown[] = []
  const stream = createOutputStream({ sessionId, config: { ...config, maxStreamPendingBytes: 1 },
    submit: async event => { events.push(event) }, afterSubmit: () => {}, report: error => errors.push(error), enabled: () => true })
  stream.observe(agent, { type: 'start', attemptId: 'bytes', revision: 1, turn: 1, step: 1 })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'bytes', revision: 2,
    chunk: { type: 'text-delta', index: 0, text: '字符上限' } })
  assert.equal(events.length, 0)
  assert.equal(errors.length, 1)
  await stream.close()
})

test('stream timer flushes readable text and ignores duplicate revisions and empty reasoning', async () => {
  const events: OutputEvent[] = []
  const stream = createOutputStream({ sessionId, config, submit: async event => { events.push(event) },
    afterSubmit: () => {}, report: error => { throw error }, enabled: () => true })
  stream.observe(agent, { type: 'start', attemptId: 'timer', revision: 1, turn: 1, step: 1 })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'timer', revision: 2,
    chunk: { type: 'text-delta', index: 0, text: 'abc' } })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'timer', revision: 2,
    chunk: { type: 'text-delta', index: 0, text: 'duplicate' } })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'timer', revision: 3,
    chunk: { type: 'block-end', index: 1, block: { type: 'reasoning', text: '' } } })
  await delay(30)
  assert.deepEqual(events.map(event => event.output.text), ['abc'])
  await stream.close()
})

test('an ended attempt finishes detection but cannot interrupt after its pending evaluation settles', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let interrupts = 0, submissions = 0
  const stream = createOutputStream({ sessionId, config, submit: async () => { submissions++; await gate },
    afterSubmit: () => { interrupts++ }, report: error => { throw error }, enabled: () => true })
  stream.observe(agent, { type: 'start', attemptId: 'ended', revision: 1, turn: 1, step: 1 })
  stream.observe(agent, { type: 'chunk', time: Date.now(), attemptId: 'ended', revision: 2,
    chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'abc' } } })
  stream.observe(agent, { type: 'end', time: Date.now(), attemptId: 'ended', revision: 3 })
  release(); await stream.close()
  assert.equal(submissions, 1)
  assert.equal(interrupts, 0)
})
