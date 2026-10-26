import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import { createToolEvents } from '../lib/reminder-runtime/tool-events.js'
import { replayNativeOutput } from '../lib/reminder-runtime/native-output-events.js'
import { Event } from '../lib/reminder-runtime/state.js'
import { nativeSession } from './fixtures/native-session.ts'

const config = { maxContextChars: 256, maxContextMessages: 8, maxQueued: 2, maxConcurrent: 1,
  output: { maxStreamChars: 16, maxStreamBlocks: 4, streamEveryChars: 4, streamFlushMs: 5 } }

test('native output anchors restore exact samples through the actual log without full history', async t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create(SessionId('native-output-retry'))
  const prepare = t.mock.method(sessions, 'prepare'), reads = t.mock.method(logs, 'read'), eventReads = t.mock.method(session, 'eventAt')
  // This composition deliberately has no sessionQuery: an accidental all() read
  // fails in the production service instead of being hidden by a fake method.
  const source = createToolEvents(config, { logs, sessions, readSession: id => logs.read(id) }); t.after(() => source.close())
  session.append('step/start', { turn: 1, step: 1 })
  const terminal = session.append('assistant/attempt', { turn: 1, step: 1, stream: [
    { type: 'text-chunks', index: 0, time0: 100, dt: [10], texts: ['abc', 'def'] },
  ] })
  const found = logs.withLive(session, log => [...replayNativeOutput(config.output, session, log, terminal, error => { throw error })])
    .map(sample => Event.parse({ ...sample, native: { type: 'assistant-output', seq: terminal.seq } }))
  assert.deepEqual(found.map(event => [event.output?.text, event.clock?.at]), [['abc', 105], ['abcdef', 115], ['abcdef', terminal.time]])
  const original = found[0]!, supplied = { ...original, rootCallId: 'forged', clock: { at: 1 }, output: { ...original.output!, text: 'forged', full: 'forged' } }
  assert.deepEqual(await source.resolve(supplied), original)
  const count = eventReads.mock.callCount()
  assert.equal(reads.mock.callCount(), 1); assert.deepEqual(await source.resolve(supplied), original)
  assert.equal(eventReads.mock.callCount(), count); assert.equal(reads.mock.callCount(), 1)
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'later context' }] }), { surfaceOp: 'append' })
  assert.deepEqual(await source.resolve(supplied), original); assert.equal(reads.mock.callCount(), 1)
  assert.equal(prepare.mock.callCount(), 0, 'output replay needs no detached Session')
  source.close(); assert.deepEqual(await source.resolve(supplied), original); assert.equal(reads.mock.callCount(), 2)
  await assert.rejects(source.resolve({ ...supplied, callId: 'nonexistent-sample' }), /native-output-sample-not-found/)
  await assert.rejects(source.resolve({ ...supplied, native: { type: 'assistant-output', seq: session.seq } }), /native-output-not-found/)
})
