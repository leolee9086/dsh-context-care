import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, deriveEventMessage, type SessionSeq, type EpochHeader } from '@deepseek-ai/dsh-session'
import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
import { ensureSessionLog } from '../lib/session-log.js'
import { createRequestCache } from '../lib/request-cache.js'
import { createSessionDeliveries } from '../lib/reminder-runtime/session-deliveries.js'
import type {} from '@deepseek-ai/dsh-api-session-controller'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap { 'context-care-test/project': { seq: SessionSeq; text: string } }
}
interface Harness { open(t: test.TestContext): Promise<Context> }
const message = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

/** Verify sharing against actual Loader, Session and JSONL persistence services. */
export function registerSessionLogCases(harness: Harness): void {
  test('shared Session log reuses type indexes and reads only live growth without snapshots', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    assert.equal(ensureSessionLog(ctx), history)
    const session = ctx.sessions.create(SessionId('shared-live'))
    session.append('user/message', message('first'), { surfaceOp: 'append' })
    session.append('user/message', message('second'), { surfaceOp: 'append' })
    const snapshots = t.mock.method(session, 'snapshotEvents'), reads = t.mock.method(session, 'eventAt')
    const queries = t.mock.method(ctx.sessionQuery, 'observeSession')
    using first = await history.read(session.id)
    assert.equal(first.select(['user/message']).length, 2)
    const count = reads.mock.callCount()
    using same = await history.read(session.id)
    assert.equal(same.select(['user/message']).length, 2)
    assert.equal(same.select(['tool/result']).length, 0)
    assert.equal(reads.mock.callCount(), count, 'different consumers share the unchanged native type index')
    session.append('user/message', message('third'), { surfaceOp: 'append' })
    const afterAppend = reads.mock.callCount()
    using grown = await history.read(session.id)
    assert.equal(grown.select(['user/message']).length, 3)
    assert.equal(reads.mock.callCount() - afterAppend, 1, 'only the newly appended native event is indexed')
    assert.equal(first.length, 2); assert.equal(first.at(2), undefined, 'an older cut does not grow under its reader')
    assert.equal(first.select(['user/message']).length, 2)
    assert.equal(snapshots.mock.callCount(), 0)
    assert.equal(queries.mock.callCount(), 0)
  })

  test('shared output boundary lookup reads only new suffixes and preserves old cuts', async t => {
    const ctx = await harness.open(t), logs = ensureSessionLog(ctx)
    const session = ctx.sessions.create(SessionId('shared-output-boundary'))
    const step = session.append('step/start', { turn: 1, step: 1 })
    for (let index = 0; index < 40; index++) session.append('user/message', message(String(index)), { surfaceOp: 'append' })
    const reads = t.mock.method(session, 'eventAt')
    using old = logs.live(session)
    const types = ['step/start', 'assistant/message', 'assistant/attempt'] as const
    assert.equal(old.last(types), step)
    const count = reads.mock.callCount()
    assert.equal(old.last([...types].reverse()), step, 'type order cannot create a different boundary cache')
    assert.equal(reads.mock.callCount(), count)
    const next = session.append('step/start', { turn: 1, step: 2 })
    session.append('user/message', message('new suffix'), { surfaceOp: 'append' })
    using grown = logs.live(session)
    assert.equal(grown.last(types), next)
    assert.equal(reads.mock.callCount() - count, 2)
    assert.equal(old.last(types), step, 'an old cut excludes the newer boundary')
    assert.equal(reads.mock.callCount() - count, 2, 'older lookup reuses the already accepted immutable events')
    assert.equal(grown.last(types, step.seq), undefined)
  })

  test('shared Session log caches disjoint ranges without reading the unrelated prefix', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const session = ctx.sessions.create(SessionId('shared-ranges'))
    for (let index = 0; index < 20; index++) session.append('user/message', message(String(index)), { surfaceOp: 'append' })
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents')
    using log = history.live(session)
    assert.deepEqual(log.select(['user/message'], 16).map(event => event.seq), [16, 17, 18, 19])
    assert.equal(reads.mock.callCount(), 4, 'tail-only reads do not index the old prefix')
    assert.equal(log.select(['tool/result'], 17).length, 0)
    assert.equal(log.last('user/message')?.seq, 19)
    assert.equal(log.at(18)?.seq, 18)
    assert.equal(reads.mock.callCount(), 4, 'other types and precise lookups reuse immutable observations')
    assert.deepEqual(log.select(['user/message'], 2, 4).map(event => event.seq), [2, 3])
    assert.equal(log.select(['user/message'], 3, 18).length, 15)
    assert.equal(reads.mock.callCount(), 18, 'overlapping reads fill only gaps and do not touch seq 0 or 1')
    assert.equal(log.select(['user/message']).length, 20)
    assert.equal(reads.mock.callCount(), 20, 'full history is indexed only when explicitly requested')
    assert.equal(log.select(['user/message'], 5, 5).length, 0)
    session.append('user/message', message('new'), { surfaceOp: 'append' })
    const beforeGrowth = reads.mock.callCount()
    using newer = history.live(session)
    assert.equal(newer.last('user/message')?.seq, 20)
    assert.equal(log.last('user/message')?.seq, 19, 'a newer last-event cache cannot leak into an older cut')
    assert.equal(newer.last('user/message', 3)?.seq, 2)
    assert.equal(newer.select(['user/message'], 18).length, 3)
    assert.equal(reads.mock.callCount() - beforeGrowth, 1)
    const beforeTail = reads.mock.callCount(), derive = t.mock.method(session, 'deriveEventMessage')
    const tail = history.tail(session, 3)
    assert.equal(tail.length, 4, 'one extra projected message preserves truncation evidence')
    assert.equal(reads.mock.callCount(), beforeTail, 'tail reuses the already indexed immutable events')
    assert.equal(derive.mock.callCount(), 4, 'only the bounded surface tail is interpreted')
    assert.deepEqual(history.tail(session, 3), tail)
    assert.equal(history.messageAt(session, 20), tail.at(-1))
    assert.equal(derive.mock.callCount(), 4, 'single, tail and repeated readers share native derivation')
    assert.equal(snapshots.mock.callCount(), 0)
  })

  test('shared Session last lookup respects interleaved sparse indexes and closed leases', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const session = ctx.sessions.create(SessionId('shared-interleaved'))
    session.append('turn/start', { turn: 0 })
    for (let index = 0; index < 8; index++) session.append('user/message', message(String(index)), { surfaceOp: 'append' })
    using old = history.live(session)
    assert.equal(old.select(['turn/start'], 0, 1).length, 1)
    session.append('turn/start', { turn: 1 })
    using middle = history.live(session)
    assert.equal(middle.last('turn/start')?.seq, 9)
    session.append('user/message', message('tail'), { surfaceOp: 'append' })
    using current = history.live(session)
    assert.equal(current.select(['turn/start'], 10).length, 0)
    assert.equal(current.last('turn/start')?.seq, 9, 'a sparse tail index cannot hide a later cached match')
    assert.equal(old.last('turn/start')?.seq, 0)
    assert.equal(current.last('tool/result'), undefined)
    const reads = t.mock.method(session, 'eventAt')
    assert.equal(current.last('tool/result'), undefined)
    assert.equal(reads.mock.callCount(), 0, 'known absence is shared at the same cut')
    old[Symbol.dispose]()
    assert.throws(() => old.at(0), /session-log-closed/)
    assert.equal(current.at(0)?.type, 'turn/start')
    history.close()
    assert.throws(() => current.at(0), /session-log-closed/)
    await assert.rejects(history.read(session.id), /session-log-closed/)
  })

  test('shared Session snapshots and projections reuse immutable cuts and only process growth', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const session = ctx.sessions.create(SessionId('shared-projections'))
    session.append('turn/start', { turn: 1 })
    const firstEvent = session.append('user/message', message('first'), { surfaceOp: 'append' })
    session.append('user/message', message('second'), { surfaceOp: 'append' })
    const snapshots = t.mock.method(session, 'snapshotEvents'), reads = t.mock.method(session, 'eventAt')
    const derives = t.mock.method(session, 'deriveEventMessage')
    using old = history.live(session); using same = history.live(session)
    assert.equal(await old.all(), await same.all())
    assert.equal(await old.all(), await old.all())
    assert.equal(snapshots.mock.callCount(), 1, 'one full snapshot is shared by consumers at this cut')
    const key = {}, historicKey = {}; let work = 0, historicWork = 0
    const project = (entry: { event: { seq: number }; turnId: string }) => { work++; return [{ seq: entry.event.seq, turnId: entry.turnId }] }
    const initial = history.projectSurface(session, key, project)
    const values = history.messages(session), origins = history.origins(session)
    const readCount = reads.mock.callCount(), deriveCount = derives.mock.callCount()
    assert.equal(readCount, 0, 'indexed consumers reuse the already accepted native observation')
    assert.equal(history.projectSurface(session, key, project), initial)
    assert.equal(history.messages(session), values)
    assert.equal(history.origins(session), origins)
    assert.equal(reads.mock.callCount(), readCount); assert.equal(derives.mock.callCount(), deriveCount)
    const oldWork = work
    session.append('turn/start', { turn: 2 })
    assert.equal(history.projectSurface(session, key, project), initial, 'log-only growth keeps the surface identity')
    const tail = session.append('user/message', message('third'), { surfaceOp: 'append' })
    const grown = history.projectSurface(session, key, project)
    assert.equal(work, oldWork + 1); assert.equal(grown.at(-1)?.turnId, `${session.id}:turn:2`)
    assert.equal(initial.length, 2, 'retained arrays cannot grow behind a reader')
    history.messages(session); history.origins(session)
    assert.equal(derives.mock.callCount(), deriveCount + 1, 'origins and messages share native derivation')
    using newer = history.live(session)
    assert.equal((await newer.all()).length, session.seq); assert.equal((await old.all()).length, 3)
    assert.equal(snapshots.mock.callCount(), 2)
    const cut = history.projectHistory(session, historicKey, ['user/message'], entry => { historicWork++; return [entry.event.seq] }, firstEvent.seq + 1)
    const all = history.projectHistory(session, historicKey, ['user/message'], entry => { historicWork++; return [entry.event.seq] })
    assert.equal(historicWork, 3); assert.equal(cut.length, 1); assert.equal(cut.at(1), undefined)
    assert.deepEqual(cut.slice(), [firstEvent.seq]); assert.equal(all.at(2), tail.seq)
    history.projectHistory(session, historicKey, ['user/message'], () => { throw new Error('reprojected old evidence') }, firstEvent.seq + 1)
    const replacement = session.append('user/message', message('replacement'),
      { surfaceOp: { op: 'replace', startSeq: firstEvent.seq, endSeq: firstEvent.seq }, sourceEventSeqs: [firstEvent.seq] })
    const replaced = history.projectSurface(session, key, project)
    assert.deepEqual(replaced.map(item => item.seq), [2, tail.seq, replacement.seq], 'original blocks stay in chronological order')
    assert.equal(work, oldWork + 2, 'unaffected raw blocks survive positional replacement')
    assert.deepEqual(history.messages(session).map(value => value.content), session.deriveMessages().map(value => value.content))
    assert.deepEqual(initial.map(item => item.seq), [1, 2])
    const retryKey = {}; let fail = true
    const retry = (entry: { event: { seq: number } }) => {
      if (entry.event.seq === tail.seq && fail) { fail = false; throw new Error('projection interrupted') }
      return [entry.event.seq]
    }
    assert.throws(() => history.projectSurface(session, retryKey, retry), /projection interrupted/)
    assert.deepEqual(history.projectSurface(session, retryKey, retry), [2, tail.seq, replacement.seq])
    const historyRetryKey = {}; fail = true
    assert.throws(() => history.projectHistory(session, historyRetryKey, ['user/message'], retry), /projection interrupted/)
    assert.deepEqual(history.projectHistory(session, historyRetryKey, ['user/message'], retry).slice(), [1, 2, tail.seq, replacement.seq])
    // A readonly array can still expose a throwing iterator. Retrying must not
    // retain values appended before that event finished iterating.
    let partial = true
    const interrupted = (entry: { event: { seq: number } }): readonly number[] => {
      const values = [entry.event.seq]
      if (entry.event.seq === tail.seq && partial) {
        partial = false
        values[Symbol.iterator] = function* () { yield entry.event.seq; throw new Error('partial iteration') }
      }
      return values
    }
    const partialSurface = {}, partialHistory = {}
    assert.throws(() => history.projectSurface(session, partialSurface, interrupted), /partial iteration/)
    assert.deepEqual(history.projectSurface(session, partialSurface, interrupted), [2, tail.seq, replacement.seq])
    partial = true
    assert.throws(() => history.projectHistory(session, partialHistory, ['user/message'], interrupted), /partial iteration/)
    assert.deepEqual(history.projectHistory(session, partialHistory, ['user/message'], interrupted).slice(), [1, 2, tail.seq, replacement.seq])
    old[Symbol.dispose]()
    await assert.rejects(old.all(), /session-log-closed/)
    history.close()
    assert.throws(() => history.messages(session), /session-log-closed/)
    assert.throws(() => history.projectHistory(session, historicKey, ['user/message'], () => []), /session-log-closed/)
  })

  test('shared historical contexts reuse forward folds and preserve older cuts and replacements', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const session = ctx.sessions.create(SessionId('shared-native-context'))
    const first = session.append('user/message', message('before'), { surfaceOp: 'append' })
    const boundary = session.append('step/start', { turn: 1, step: 1 })
    const reads = t.mock.method(session, 'eventAt'), prepare = t.mock.method(ctx.sessions, 'prepare')
    const work = () => history.cache.report().find(row => row.name === 'native-historical-context')?.work ?? 0
    using old = history.live(session)
    const initial = await history.contextBefore(old, boundary, 4)
    assert.deepEqual(initial.messages.map(value => value.content), [[{ type: 'text', text: 'before' }]])
    const count = reads.mock.callCount(), folded = work()
    using same = history.live(session)
    assert.deepEqual(await history.contextBefore(same, boundary, 4), initial)
    assert.equal(reads.mock.callCount(), count); assert.equal(work(), folded); assert.equal(prepare.mock.callCount(), 1)
    const replacement = session.append('user/message', message('replacement'),
      { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] })
    const later = session.append('step/start', { turn: 1, step: 2 })
    using grown = history.live(session)
    const current = await history.contextBefore(grown, later, 4)
    assert.deepEqual(current.messages.map(value => value.content), [[{ type: 'text', text: 'replacement' }]])
    assert.equal(work() - folded, later.seq - boundary.seq, 'only the newly required prefix is folded')
    assert.deepEqual(await history.contextBefore(old, boundary, 4), initial, 'older readers retain their original surface')
    const afterOld = work()
    assert.deepEqual(await history.contextBefore(old, boundary, 4), initial)
    assert.equal(work(), afterOld, 'the latest older prefix is reusable without discarding the forward fold')
    assert.deepEqual(await history.contextBefore(grown, later, 4), current)
    assert.equal(work(), afterOld)
    const cut = history.surfaceEvents(session, 'user/message')
    assert.equal(cut.length, 1); assert.equal(cut.at(0), replacement)
    session.append('user/message', message('new tail'), { surfaceOp: 'append' })
    assert.equal(history.surfaceEvents(session, 'user/message').length, 2)
    assert.equal(cut.length, 1); assert.equal(cut.at(1), undefined, 'indexed surface cuts never grow behind readers')
  })

  test('shared historical context retries native interpreter failures and refuses unloaded definitions', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    let fail = false, interpreted = 0
    const dispose = ctx.sessions.registerMessageProjection({ type: 'context-care-test/project', project(event, context) {
      if (event.type !== 'context-care-test/project') throw new Error('unexpected native projection event')
      interpreted++
      const source = context.events[event.data.seq - context.baseSeq]
      const original = source && deriveEventMessage(source, context.messages)
      assert.ok(original)
      if (fail) throw new Error('native projection interrupted')
      return new Map([[source.seq, Object.freeze({ ...original, content: Object.freeze([{ type: 'text' as const, text: event.data.text }]) })]])
    } })
    t.after(dispose)
    const session = ctx.sessions.create(SessionId('shared-native-context-interpreter'))
    const input = session.append('user/message', message('original'), { surfaceOp: 'append' })
    session.append('context-care-test/project', { seq: input.seq, text: 'projected' })
    const boundary = session.append('step/start', { turn: 1, step: 1 })
    using log = history.live(session)
    fail = true
    await assert.rejects(history.contextBefore(log, boundary, 2), /native projection interrupted/)
    fail = false
    const expected = [{ type: 'text', text: 'projected' }]
    assert.deepEqual((await history.contextBefore(log, boundary, 2)).messages[0].content, expected)
    const count = interpreted
    assert.deepEqual((await history.contextBefore(log, boundary, 2)).messages[0].content, expected)
    assert.equal(interpreted, count, 'a successful repeat never reinterprets an old projection event')
    await dispose()
    await assert.rejects(history.contextBefore(log, boundary, 2), /projection-unloaded/)
  })

  test('shared historical context cancellation retries without publishing a partial native fold', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const session = ctx.sessions.create(SessionId('shared-native-context-cancel'))
    for (let index = 0; index < 2050; index++) session.append('user/message', message(String(index)), { surfaceOp: 'append' })
    const boundary = session.append('step/start', { turn: 1, step: 1 })
    using log = history.live(session)
    const controller = new AbortController(), reason = new Error('cancel prefix reader')
    const canceled = history.contextBefore(log, boundary, 2, controller.signal)
    const accepted = history.contextBefore(log, boundary, 2)
    const rejection = assert.rejects(canceled, reason)
    await Promise.resolve(); controller.abort(reason)
    await rejection
    assert.deepEqual((await accepted).messages.map(value => value.content), ['2047', '2048', '2049'].map(text => [{ type: 'text', text }]))
    const worked = history.cache.report().find(row => row.name === 'native-historical-context')?.work
    await history.contextBefore(log, boundary, 2)
    assert.equal(history.cache.report().find(row => row.name === 'native-historical-context')?.work, worked)
  })

  test('shared Session explicit history isolates cancellation and retries failed observations', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const session = ctx.sessions.create(SessionId('shared-explicit-history'))
    const first = session.append('user/message', message('original'), { surfaceOp: 'append' })
    using old = history.live(session)
    session.append('user/message', message('later'), { surfaceOp: 'append' })
    const actual = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let fail = false
    const query = t.mock.method(ctx.sessionQuery, 'observeSession', async (...args: Parameters<typeof actual>) => {
      const observation = await actual(...args)
      await gate
      if (fail) { observation[Symbol.dispose](); throw new Error('observation failed') }
      return observation
    })
    const controller = new AbortController()
    const cancelled = assert.rejects(old.all(controller.signal), /cancel one historical reader/)
    const remaining = old.all()
    controller.abort(new Error('cancel one historical reader'))
    await cancelled
    assert.equal(query.mock.callCount(), 1, 'one cancelled reader does not cancel the shared native read')
    release()
    const events = await remaining
    assert.equal(events.length, 1); assert.equal(events[0], first)
    assert.equal(await old.all(), events)
    using newer = history.live(session)
    fail = true
    await assert.rejects(newer.all(), /observation failed/)
    fail = false
    assert.equal((await newer.all()).length, 2)
    assert.equal(query.mock.callCount(), 3, 'failed observations are retried, successful cuts are shared')
  })

  test('shared Session projections retain native content updates and interpreter disposal', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const dispose = ctx.sessions.registerMessageProjection({ type: 'context-care-test/project', project(event, context) {
      if (event.type !== 'context-care-test/project') throw new Error('unexpected native projection event')
      const source = context.events[event.data.seq - context.baseSeq]
      assert.ok(source)
      const original = deriveEventMessage(source, context.messages)
      assert.ok(original)
      return new Map([[source.seq, Object.freeze({ ...original, content: Object.freeze([Object.freeze({ type: 'text' as const, text: event.data.text })]) })]])
    } })
    t.after(dispose)
    const session = ctx.sessions.create(SessionId('shared-content-generation'))
    const event = session.append('user/message', message('original'), { surfaceOp: 'append' })
    const key = {}, original = history.messages(session), origins = history.origins(session)
    const raw = history.projectSurface(session, key, entry => [entry.event])
    session.append('context-care-test/project', { seq: event.seq, text: 'projected' })
    const projected = history.messages(session)
    assert.deepEqual(projected[0].content, [{ type: 'text', text: 'projected' }])
    assert.deepEqual(original[0].content, [{ type: 'text', text: 'original' }])
    assert.notEqual(history.origins(session), origins)
    assert.equal(history.projectSurface(session, key, () => { throw new Error('raw event reparsed') }), raw)
    assert.equal(history.messages(session), projected)
    const cut = history.historical(session, session.seq)
    assert.deepEqual(history.messages(cut)[0].content, projected[0].content)
    assert.equal(history.historical(session, session.seq), cut)
    await dispose()
    assert.throws(() => history.historical(session, session.seq), /was removed or replaced/)
    assert.throws(() => history.messages(session), /was removed or replaced/)
    assert.throws(() => history.origins(session), /was removed or replaced/)
  })

  test('request diagnostic views invalidate only for settlements or changed live records', async t => {
    const ctx = await harness.open(t), session = ctx.sessions.create(SessionId('request-view-cuts'))
    const cache = createRequestCache({ sessions: ctx.sessions, logs: ensureSessionLog(ctx), measureInput: () => ({ textTokens: 0, visualTokens: 0 }) })
    t.after(() => cache.close())
    const first = cache.view(String(session.id))
    assert.equal(cache.view(String(session.id)), first)
    session.append('user/message', message('not a request settlement'), { surfaceOp: 'append' })
    assert.equal(cache.view(String(session.id)), first)
    await cache.put('action-one', String(session.id), 'maintenance', { action: 'prune', phase: 'completed', operationId: 'one' })
    const changed = cache.view(String(session.id))
    assert.notEqual(changed, first); assert.equal(changed.length, 1); assert.equal(first.length, 0)
    assert.equal(cache.view(String(session.id)), changed)
    const listed = cache.list(String(session.id))
    listed.pop()
    assert.equal(cache.view(String(session.id)).length, 1, 'public list owns its array')
    cache.release(session)
    assert.equal(cache.view(String(session.id)), changed, 'releasing an empty active map cannot invalidate the view')
  })

  test('shared request history and calibration reuse native reads and immutable historical cuts', async t => {
    const ctx = await harness.open(t), logs = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('shared-request-history'))
    const config = { provider: 'care-test', model: 'care-test' }
    session.append('request/header', { header: { config }, reason: 'series' })
    const input = session.append('user/message', message('first input'), { surfaceOp: 'append' })
    const append = () => session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 8, outputTokens: 1 },
      message: createMessage({ role: 'assistant', source: { kind: 'model', ...config }, content: [{ type: 'text', text: 'answer' }] }) }, { surfaceOp: 'append' })
    const settled = append()
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents'), prepare = t.mock.method(ctx.sessions, 'prepare')
    let measurements = 0
    const options = { sessions: ctx.sessions, logs, measureInput: () => { measurements++; return { textTokens: 2, visualTokens: 0 } } }
    const first = createRequestCache(options), second = createRequestCache(options)
    t.after(async () => { await first.close(); await second.close() })
    const initial = first.view(String(session.id))
    assert.equal(logs.cache.report().filter(row => row.name === 'request-header-hash').reduce((sum, row) => sum + row.work, 0), 0,
      'request listing must not serialize every historical tool catalog for unused calibration')
    const count = reads.mock.callCount()
    assert.equal(count, session.seq)
    const report = () => logs.cache.report().find(row => row.name === 'request-history')!
    const work = report().work
    assert.equal(first.settled(session), second.settled(session), 'request consumers share one folded settlement array')
    second.view(String(session.id)); assert.equal(reads.mock.callCount(), count)
    assert.equal(report().work, work, 'another cache facade does not fold or parse historical settlements again')
    const before = logs.historical(session, settled.seq)
    assert.equal(logs.historical(session, settled.seq), before)
    assert.equal(prepare.mock.callCount(), 1)
    const restoredLength = before.seq
    assert.equal(restoredLength, settled.seq + 1)
    assert.equal(before.eventAt(settled.seq)?.type, 'session/end-seed', 'native restore retains its own lifecycle marker')
    assert.equal(before.eventAt(input.seq), input, 'prepared history shares native frozen events')
    assert.deepEqual(logs.messages(before).map(value => value.content), [[{ type: 'text', text: 'first input' }]])
    first.calibrationRecords(session, session.requestHeader()); second.calibrationRecords(session, session.requestHeader())
    assert.equal(prepare.mock.callCount(), 1); assert.equal(reads.mock.callCount(), count); assert.equal(measurements, 1)
    const workOf = (name: string) => logs.cache.report().filter(row => row.name === name).reduce((sum, row) => sum + row.work, 0)
    const selectionWork = workOf('request-calibration-selection'), hashWork = workOf('request-header-hash')
    const repeated = first.calibrationRecords(session, session.requestHeader())
    assert.deepEqual(repeated[0].data.rawInput, { textTokens: 2, visualTokens: 0 }); assert.equal(measurements, 1)
    assert.equal(workOf('request-calibration-input'), 1, 'two facades share one successful measurement')
    assert.equal(workOf('request-calibration-selection'), selectionWork, 'repeat selection does not inspect an old candidate')
    assert.equal(workOf('request-header-hash'), hashWork, 'repeat selection reuses immutable header hashes')
    const other = createRequestCache({ ...options, measureInput: () => ({ textTokens: 9, visualTokens: 1 }) })
    t.after(() => other.close())
    assert.deepEqual(other.calibrationRecords(session, session.requestHeader())[0].data.rawInput, { textTokens: 9, visualTokens: 1 },
      'different measurement functions cannot reuse each other’s price')
    let capability = {}, dependencyMeasurements = 0
    const dependencies = createRequestCache({ ...options, measurementDependencies: () => [capability],
      measureInput: () => ({ textTokens: ++dependencyMeasurements, visualTokens: 0 }) })
    t.after(() => dependencies.close())
    assert.deepEqual(dependencies.calibrationRecords(session, session.requestHeader())[0].data.rawInput, { textTokens: 1, visualTokens: 0 })
    assert.deepEqual(dependencies.calibrationRecords(session, session.requestHeader())[0].data.rawInput, { textTokens: 1, visualTokens: 0 })
    capability = {}
    assert.deepEqual(dependencies.calibrationRecords(session, session.requestHeader())[0].data.rawInput, { textTokens: 2, visualTokens: 0 },
      'a changed estimator/provider capability cannot reuse the old successful measurement')
    let attempts = 0
    const retry = createRequestCache({ ...options, measureInput: () => {
      if (++attempts === 1) throw new Error('calibration input unavailable')
      return { textTokens: 3, visualTokens: 0 }
    } })
    t.after(() => retry.close())
    assert.throws(() => retry.calibrationRecords(session, session.requestHeader()), /calibration input unavailable/)
    assert.deepEqual(retry.calibrationRecords(session, session.requestHeader())[0].data.rawInput, { textTokens: 3, visualTokens: 0 })
    assert.equal(attempts, 2, 'a failed measurement never publishes a usable value')
    const unmatched = { config: { ...config, model: 'different-model' } }
    assert.equal(first.calibrationRecords(session, unmatched)[0].data.rawInput, undefined)
    const unmatchedWork = workOf('request-calibration-selection')
    second.calibrationRecords(session, unmatched)
    assert.equal(workOf('request-calibration-selection'), unmatchedWork, 'unmatched queries do not rescan unrelated routes')
    session.append('user/message', message('second input'), { surfaceOp: 'append' }); append()
    const grown = first.view(String(session.id))
    assert.equal(grown.length, 2); assert.equal(grown[0], initial[0]); assert.equal(initial.length, 1)
    assert.equal(reads.mock.callCount() - count, 2)
    second.view(String(session.id)); assert.equal(reads.mock.callCount() - count, 2)
    assert.equal(report().work, work + 1, 'only the new assistant settlement advances the shared request fold')
    first.calibrationRecords(session, session.requestHeader())
    assert.equal(measurements, 2, 'a new eligible settlement is measured once')
    const sharedRows = second.settled(session)
    await first.close()
    second.calibrationRecords(session, session.requestHeader())
    assert.equal(measurements, 2, 'closing one facade preserves the shared calibration for another')
    assert.equal(second.settled(session), sharedRows); assert.equal(report().work, work + 1)
    const revisited = logs.historical(session, settled.seq)
    assert.equal(logs.historical(session, settled.seq), revisited, 'consecutive readers share the current historical cut')
    assert.equal(before.seq, restoredLength, 'a retained older cut never grows behind its reader')
    assert.equal(revisited.eventAt(input.seq), input)
    assert.equal(snapshots.mock.callCount(), 0)
    assert.throws(() => logs.historical(session, session.seq + 1), /cut-invalid/)
  })

  test('shared calibration retains interleaved tool catalogs and advances only the changed settlement', async t => {
    const ctx = await harness.open(t), logs = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('interleaved-calibration'))
    const config = { provider: 'care-test', model: 'care-test' }
    const header = (name: string) => ({ config, tools: [{ name, description: name, parameters: { type: 'object' as const } }] })
    const a = header('catalog-a'), b = header('catalog-b'), missing = header('catalog-missing')
    const append = (selected: typeof a) => {
      session.append('request/header', { header: selected, reason: 'series' })
      session.append('user/message', message(selected.tools[0].name), { surfaceOp: 'append' })
      return session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 8, outputTokens: 1 },
        message: createMessage({ role: 'assistant', source: { kind: 'model', ...config }, content: [{ type: 'text', text: 'answer' }] }) }, { surfaceOp: 'append' })
    }
    const firstA = append(a), firstB = append(b)
    const reads = t.mock.method(session, 'eventAt'), prepare = t.mock.method(ctx.sessions, 'prepare')
    let measurements = 0, capabilityA = {}, capabilityB = {}
    const options = { sessions: ctx.sessions, logs,
      measurementDependencies: (selected: EpochHeader | undefined) => [selected?.tools?.[0]?.name === 'catalog-a' ? capabilityA : capabilityB],
      measureInput: () => ({ textTokens: ++measurements, visualTokens: 0 }) }
    const first = createRequestCache(options), second = createRequestCache(options)
    t.after(async () => { await first.close(); await second.close() })
    const workOf = (name: string) => logs.cache.report().filter(row => row.name === name).reduce((sum, row) => sum + row.work, 0)
    const valueA = first.calibrationRecords(session, a)[0], valueB = second.calibrationRecords(session, b)[0]
    assert.equal(valueA.data.eventSeq, firstA.seq); assert.equal(valueB.data.eventSeq, firstB.seq)
    assert.equal(measurements, 2); assert.equal(prepare.mock.callCount(), 2)
    const indexed = workOf('request-calibration-selection'), hashed = workOf('request-header-hash'), nativeReads = reads.mock.callCount()
    for (let index = 0; index < 3; index++) {
      assert.deepEqual(second.calibrationRecords(session, a)[0].data.rawInput, valueA.data.rawInput)
      assert.deepEqual(first.calibrationRecords(session, b)[0].data.rawInput, valueB.data.rawInput)
      assert.equal(first.calibrationRecords(session, missing)[0].data.rawInput, undefined)
    }
    assert.equal(measurements, 2, 'interleaving full headers cannot evict another successful measurement')
    assert.equal(prepare.mock.callCount(), 2, 'unchanged catalog reads cannot replay historical inputs')
    assert.equal(reads.mock.callCount(), nativeReads)
    assert.equal(workOf('request-calibration-selection'), indexed)
    // The first same-configuration miss may hash its own header, but never old candidates again.
    assert.equal(workOf('request-header-hash'), hashed + 1)
    const nextA = append(a)
    assert.equal(first.calibrationRecords(session, a)[0].data.eventSeq, nextA.seq)
    assert.equal(measurements, 3, 'only the newer successful A settlement needs a new input measurement')
    assert.deepEqual(second.calibrationRecords(session, b)[0].data.rawInput, valueB.data.rawInput)
    assert.equal(measurements, 3, 'unrelated catalog B survives the new A settlement')
    const selection = workOf('request-calibration-selection')
    assert.equal(selection, indexed + 1, 'only the appended eligible settlement is indexed')
    capabilityA = {}
    first.calibrationRecords(session, a)
    assert.equal(measurements, 4, 'a real estimator dependency change invalidates its own header')
    second.calibrationRecords(session, b)
    assert.equal(measurements, 4, 'a catalog-local dependency change does not invalidate another catalog')
    capabilityB = {}
    second.calibrationRecords(session, b)
    assert.equal(measurements, 5)
    first.calibrationRecords(session, a)
    assert.equal(measurements, 5); assert.equal(workOf('request-calibration-selection'), selection)
  })

  test('native Session disposal releases all managed projections and isolates a reused id', async t => {
    const ctx = await harness.open(t), logs = ensureSessionLog(ctx)
    const session = ctx.sessions.prepare(SessionId('managed-cache-lifecycle'))
    const detach = ctx.sessions.enter(session)
    t.after(detach)
    ctx.sessions.announce(session)
    const key = logs.cache.define('lifecycle-test', 'exact native Session identity', () => ({ marker: {} }))
    const value = logs.cache.use(session, key)
    session.append('user/message', message('owned projection'), { surfaceOp: 'append' })
    assert.equal(logs.messages(session).length, 1)
    assert.equal(logs.cache.report().find(row => row.name === 'session-log')?.entries, 1)
    detach()
    assert.equal(logs.cache.peek(session, key), undefined)
    assert.equal(logs.cache.report().find(row => row.name === 'lifecycle-test')?.entries, 0)
    assert.equal(logs.cache.report().find(row => row.name === 'session-log')?.entries, 0)
    const replacement = ctx.sessions.create(session.id)
    assert.notEqual(logs.cache.use(replacement, key), value)
    assert.deepEqual(logs.messages(replacement), [], 'a reused string id cannot inherit the old native owner’s projection')
    logs.close()
    assert.throws(() => logs.cache.peek(replacement, key), /cache-closed/)
    assert.throws(() => logs.messages(replacement), /session-log-closed/)
  })

  test('shared anchored delivery receipts process only missing ranges and newly committed evidence', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), deliveries = createSessionDeliveries(ctx)
    t.after(() => deliveries.close())
    const session = ctx.sessions.create(SessionId('delivery-receipt-index'))
    for (let index = 0; index < 100; index++) session.append('user/message', message(String(index)), { surfaceOp: 'append' })
    const worked = () => history.cache.report().find(row => row.name === 'reminder-handoff-receipts')?.work ?? 0
    assert.equal(await deliveries.wasHanded(session.id, 'not-handed', undefined, 80), false)
    assert.equal(worked(), 20)
    await deliveries.wasHanded(session.id, 'not-handed', undefined, 80)
    assert.equal(worked(), 20)
    const current = await deliveries.read(session.id, '', 50)
    assert.equal(current.committedIds.size, 50); assert.equal(worked(), 50)
    assert.equal((await deliveries.read(session.id, '', 50)).committedIds, current.committedIds, 'unchanged exact anchor shares its committed-id cut')
    await deliveries.wasHanded(session.id, 'not-handed', undefined, 0)
    assert.equal(worked(), 100)
    session.append('step/start', { turn: 1, step: 1 })
    await deliveries.wasHanded(session.id, 'not-handed', undefined, 0)
    assert.equal(worked(), 100, 'irrelevant native growth does not refold the receipt prefix')
    const next = session.append('user/message', message('new commit'), { surfaceOp: 'append' })
    const grown = await deliveries.read(session.id, '', 50)
    assert.equal(grown.committedIds.size, 51); assert.equal(grown.committedIds.has(String(next.data.id)), true)
    assert.equal(worked(), 101)
    assert.equal(current.committedIds.size, 50, 'older receipt cuts stay immutable')
  })

  test('shared delivery restoration isolates reused Session ids and incremental current-human state', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), deliveries = createSessionDeliveries(ctx)
    t.after(() => deliveries.close())
    const id = SessionId('delivery-owner-reuse'), old = ctx.sessions.prepare(id)
    const detach = ctx.sessions.enter(old); ctx.sessions.announce(old)
    for (let index = 0; index < 2050; index++) old.append('user/message', message(String(index)), { surfaceOp: 'append' })
    const original = deliveries.humanTurn(id)
    await Promise.resolve(); await Promise.resolve()
    detach()
    const replacement = ctx.sessions.prepare(id), leave = ctx.sessions.enter(replacement)
    ctx.sessions.announce(replacement); t.after(leave)
    const current = replacement.append('user/message', message('new owner'), { surfaceOp: 'append' })
    assert.equal(await deliveries.humanTurn(id), String(current.seq), 'a new native owner never joins the old id transaction')
    await original
    assert.equal(deliveries.currentHumanTurn(id), String(current.seq), 'old completion cannot overwrite the new owner')
    const worked = history.cache.report().find(row => row.name === 'reminder-deliveries')?.work
    await deliveries.humanTurn(id); await deliveries.humanTurn(id)
    assert.equal(history.cache.report().find(row => row.name === 'reminder-deliveries')?.work, worked)
    const next = replacement.append('user/message', message('next arrival'), { surfaceOp: 'append' })
    deliveries.observe(replacement, next)
    assert.equal(deliveries.currentHumanTurn(id), String(next.seq))
    deliveries.close()
    await assert.rejects(deliveries.humanTurn(id), /deliveries-closed/)
  })

  test('shared cold Session reads merge concurrent callers isolate cancellation and refresh revisions', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx)
    const seed = ctx.sessions.prepare(SessionId('shared-cold'))
    seed.append('user/message', message('persisted-first'), { surfaceOp: 'append' })
    const handle = await ctx.sessionPersistence.create(seed.header, { inheritedEventCount: seed.inheritedEventCount })
    t.after(() => handle.close())
    await handle.append(seed.snapshotEvents()); await handle.flush()
    const query = t.mock.method(ctx.sessionQuery, 'observeSession')
    const controller = new AbortController(), reason = new Error('cancel only this consumer')
    const canceled = history.read(seed.id, controller.signal)
    const second = history.read(seed.id), third = history.read(seed.id)
    controller.abort(reason)
    const [aborted, b, c] = await Promise.allSettled([canceled, second, third])
    assert.equal(aborted.status, 'rejected')
    if (aborted.status === 'rejected') assert.equal(aborted.reason, reason)
    assert.equal(b.status, 'fulfilled'); assert.equal(c.status, 'fulfilled')
    if (b.status !== 'fulfilled' || c.status !== 'fulfilled') throw new Error('shared readers did not finish')
    using first = b.value; using same = c.value
    assert.equal(query.mock.callCount(), 1, 'one native observation serves overlapping cold reads')
    assert.equal(await first.all(), await same.all(), 'accepted immutable native events are shared, not cloned')
    assert.equal(first.prepare(), same.prepare(), 'dependent projections share one prepared native Session')
    assert.equal(ctx.sessions.get(seed.id), undefined, 'inspection does not activate an Agent or Session')
    first[Symbol.dispose](); first[Symbol.dispose]()
    assert.equal(same.at(0)?.type, 'user/message', 'one reader releasing cannot invalidate another')
    const appended = seed.append('user/message', message('persisted-second'), { surfaceOp: 'append' })
    await handle.append([appended]); await handle.flush()
    using next = await history.read(seed.id)
    assert.equal(next.length, 2, 'later reads check the native persistence revision even while an old lease exists')
    assert.equal(same.length, 1); assert.equal(same.at(1), undefined)
    assert.notEqual(next.prepare(), same.prepare(), 'a changed revision cannot reuse a stale prepared Session')
  })
}
