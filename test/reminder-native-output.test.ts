import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import { createToolEvents } from '../lib/reminder-runtime/tool-events.js'
import type { EventValue } from '../lib/reminder-runtime/state.js'

const config = { maxContextChars: 256, maxContextMessages: 8, maxQueued: 2, maxConcurrent: 1,
  output: { maxStreamChars: 16, maxStreamBlocks: 4, streamEveryChars: 4, streamFlushMs: 5 } }
const selection = { tools: false, beforeTools: false, outputs: true, sessionEvents: [] }

/** These injected streams exercise the read cursor and parser; real streaming is covered by Source Loader tests. */
test('native output recovery reads only the live suffix and public anchors cannot replace its samples', async () => {
  const session = Session.create(SessionId('native-output-suffix')), events: SessionEvent[] = []
  let eventReads = 0, historyReads = 0, allowHistory = false
  const eventAt = session.eventAt.bind(session)
  session.eventAt = seq => { eventReads++; return eventAt(seq) }
  session.snapshotEvents = () => { throw new Error('output discovery must not copy native history') }
  const history = {
    sessions: { get: () => session, prepare: () => { throw new Error('output replay needs no detached Session or surface') } },
    readSession: async () => {
      historyReads++
      assert.equal(allowHistory, true, 'a fully observed live Session needs no full native read')
      return { events, inheritedEventCount: 0 }
    },
  }
  const source = createToolEvents(config, history)
  source.created(session)
  events.push(session.append('step/start', { turn: 1, step: 1 }))
  const terminal = session.append('assistant/attempt', { turn: 1, step: 1, stream: [
    { type: 'text-chunks', index: 0, time0: 100, dt: [10], texts: ['abc', 'def'] },
  ] })
  events.push(terminal)
  const found: EventValue[] = []
  const recover = () => source.recover(String(session.id), async event => { found.push(event) }, new AbortController().signal, selection)
  await recover()
  assert.deepEqual(found.map(event => [event.output?.text, event.clock?.at]), [
    ['abc', 105], ['abcdef', 115], ['abcdef', terminal.time],
  ])
  const reads = eventReads, count = found.length
  await recover()
  assert.equal(eventReads, reads, 'the same cursor does not reread any event or stream')
  assert.equal(found.length, count)
  events.push(session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'later context' }] }), { surfaceOp: 'append' }))
  await recover()
  assert.equal(eventReads, reads + 1, 'an unrelated appended event costs one suffix read')
  assert.equal(historyReads, 0)
  source.close()
  allowHistory = true
  const original = found[0]!
  const supplied = { ...original, rootCallId: 'forged', clock: { at: 1 },
    output: { ...original.output!, text: 'forged', full: 'forged' } }
  assert.deepEqual(await source.resolve(supplied), original)
  assert.equal(historyReads, 1)
  await assert.rejects(source.resolve({ ...supplied, callId: 'nonexistent-sample' }), /native-output-sample-not-found/)
  await assert.rejects(source.resolve({ ...supplied, native: { type: 'assistant-output', seq: events.length } }), /native-output-not-found/)
})
