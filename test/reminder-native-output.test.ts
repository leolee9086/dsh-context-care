import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SessionStore, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createSessionLog } from '../lib/session-log.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import { createToolEvents } from '../lib/reminder-runtime/tool-events.js'
import { replayNativeOutput } from '../lib/reminder-runtime/native-output-events.js'
import { Event } from '../lib/reminder-runtime/state.js'
import { eventLog } from './fixtures/event-log.js'

const config = { maxContextChars: 256, maxContextMessages: 8, maxQueued: 2, maxConcurrent: 1,
  output: { maxStreamChars: 16, maxStreamBlocks: 4, streamEveryChars: 4, streamFlushMs: 5 } }

/** Explicit retries read a committed settlement; they never rediscover old triggers. */
test('native output anchors restore exact samples without materializing complete history', async t => {
  const ctx = new Context(), sessions = new SessionStore(ctx), logs = createSessionLog(ctx)
  t.after(async () => { logs.close(); await ctx.fiber.dispose() })
  const prepare = t.mock.method(sessions, 'prepare')
  const session = Session.create(SessionId('native-output-retry')), events: SessionEvent[] = []
  let historyReads = 0, eventReads = 0
  const history = {
    logs, sessions: { get: () => session },
    readSession: async () => {
      historyReads++
      const log = eventLog(events)
      return { ...log, at(seq: number) { eventReads++; return log.at(seq) },
        all: async (): Promise<readonly SessionEvent[]> => { throw new Error('output retry must not materialize complete history') } }
    },
  }
  const source = createToolEvents(config, history)
  events.push(session.append('step/start', { turn: 1, step: 1 }))
  const terminal = session.append('assistant/attempt', { turn: 1, step: 1, stream: [
    { type: 'text-chunks', index: 0, time0: 100, dt: [10], texts: ['abc', 'def'] },
  ] })
  events.push(terminal)
  const found = [...replayNativeOutput(config.output, session, eventLog(events), terminal, error => { throw error })]
    .map(sample => Event.parse({ ...sample, native: { type: 'assistant-output', seq: terminal.seq } }))
  assert.deepEqual(found.map(event => [event.output?.text, event.clock?.at]), [
    ['abc', 105], ['abcdef', 115], ['abcdef', terminal.time],
  ])
  const original = found[0]!
  const supplied = { ...original, rootCallId: 'forged', clock: { at: 1 },
    output: { ...original.output!, text: 'forged', full: 'forged' } }
  assert.deepEqual(await source.resolve(supplied), original)
  const reads = eventReads
  assert.equal(historyReads, 1)
  assert.deepEqual(await source.resolve(supplied), original)
  assert.equal(eventReads, reads); assert.equal(historyReads, 1)
  events.push(session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'later context' }] }), { surfaceOp: 'append' }))
  assert.deepEqual(await source.resolve(supplied), original)
  assert.equal(historyReads, 1, 'later context cannot invalidate an immutable retry anchor')
  assert.equal(prepare.mock.callCount(), 0, 'output replay needs no detached Session or surface')
  source.close()
  assert.deepEqual(await source.resolve(supplied), original)
  assert.equal(historyReads, 2)
  await assert.rejects(source.resolve({ ...supplied, callId: 'nonexistent-sample' }), /native-output-sample-not-found/)
  await assert.rejects(source.resolve({ ...supplied, native: { type: 'assistant-output', seq: events.length } }), /native-output-not-found/)
})
