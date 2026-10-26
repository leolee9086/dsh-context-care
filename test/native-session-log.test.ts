import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { nativeSession } from './fixtures/native-session.ts'

test('production log readers retain bounded cuts, native order and independent disposal', async t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const first = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'before' }] }), { surfaceOp: 'append' })
  const turn = session.append('turn/start', { turn: 1 })
  const old = logs.live(session), same = logs.live(session)
  t.after(() => { old[Symbol.dispose](); same[Symbol.dispose]() })
  const replacement = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'after' }] }),
    { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] })
  const current = logs.live(session); t.after(() => current[Symbol.dispose]())
  assert.equal(old.length, replacement.seq); assert.equal(old.at(replacement.seq), undefined)
  assert.equal(old.at(-1), undefined); assert.equal(old.last('user/message', current.length + 100), first)
  assert.deepEqual(old.select(['turn/start', 'user/message', 'turn/start']).map(event => event.seq), [first.seq, turn.seq])
  assert.deepEqual([...old.range(-100, current.length + 100)].map(event => event.seq), [first.seq, turn.seq])
  assert.deepEqual(current.select(['turn/start', 'user/message']).map(event => event.seq), [first.seq, turn.seq, replacement.seq])
  assert.equal(current.last('user/message', current.length + 100), replacement)
  assert.equal(current.last('user/message', replacement.seq), first)
  assert.equal(current.last('user/message', 0), undefined)
  old[Symbol.dispose](); old[Symbol.dispose]()
  assert.throws(() => old.at(first.seq), /session-log-closed/)
  assert.throws(() => [...old.range(0)], /session-log-closed/)
  assert.throws(() => old.select(['user/message']), /session-log-closed/)
  assert.throws(() => old.prepare(), /session-log-closed/)
  await assert.rejects(old.all(), /session-log-closed/)
  assert.equal(same.at(first.seq), first); assert.equal(current.at(replacement.seq), replacement)
  assert.deepEqual(logs.messages(session).map(message => message.content), [[{ type: 'text', text: 'after' }]])
  // Native restore rejects a gap before a production log reader can observe it.
  const gap = { ...first, seq: SessionSeq(1) }
  assert.throws(() => Session.create(SessionId('invalid-gap'), [gap]), /contiguous from 0/)
})
