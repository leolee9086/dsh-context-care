import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'plugin:dsh-context-care:state': { kind: 'plugin:dsh-context-care:state' } }
}
import type { DiagnosticRead, DiagnosticRecordInput } from '../lib/diagnostic-pages.js'
import { ensureSessionLog } from '../lib/session-log.js'
import { createDiagnosticPages, createDiagnosticIndex, isDiagnosticDelta, createDiagnosticRecordFeed, compareDiagnosticRecords } from '../lib/diagnostic-pages.js'
import { createRequestCache } from '../lib/request-cache.js'
import { createRewriteJournal } from '../src/rewrite-journal.js'
import { rewriteCut, rewriteSnapshot } from '../lib/rewrite-feed.js'
import type { CacheRecord } from '../lib/request-cache.js'
import { createPromptIndex, promptEventTypes } from '../src/prompt-view-data.js'
import { createActionIndex, actionEventTypes } from '../src/action-view-data.js'

interface Harness { open(t: test.TestContext): Promise<Context> }
const notice = (text: string) => createUserMessage({ source: { kind: 'plugin:dsh-context-care:state' }, content: [{ type: 'text', text }] })
const record = (key: string, data: CacheRecord['data']): CacheRecord => ({ key, version: 1, sessionId: 'pages', kind: 'maintenance', at: 1, data })

export function registerDiagnosticPageCases(harness: Harness): void {
  test('native request diagnostic deltas avoid rescanning settled history during live phases and rebuild after failure', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-request-deltas'))
    const cache = createRequestCache({ sessions: ctx.sessions, logs: history, measureInput: () => ({ textTokens: 0, visualTokens: 0 }) })
    t.after(() => cache.close())
    const append = () => session.append('assistant/message', { turn: 1, step: 1, stream: [],
      message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: 'answer' }] }) }, { surfaceOp: 'append' })
    for (let index = 0; index < 1000; index++) append()
    const native = cache.settled(session), cold = cache.diagnosticFeed(String(session.id)), observer = {}
    assert.equal(cold.consume(observer).added.length, 1000)
    const old = cache.view(String(session.id)), work = () => history.cache.report().filter(row => row.name === 'request-cache').reduce((sum, row) => sum + row.work, 0)
    assert.equal(work(), 1000)
    const reads = t.mock.method(session, 'eventAt')
    const originalIterator = native[Symbol.iterator]
    Object.defineProperty(native, Symbol.iterator, { configurable: true, value() { throw new Error('settled-history-rescanned') } })
    t.after(() => Object.defineProperty(native, Symbol.iterator, { configurable: true, value: originalIterator }))
    let processed = 0, fail = false
    const pages = createDiagnosticPages(history, promptEventTypes, () => {
      const update = createPromptIndex()
      return (records: DiagnosticRecordInput<CacheRecord>, events: readonly SessionEvent[]) => {
        assert.ok(isDiagnosticDelta(records)); processed += records.added.length + records.removed.length
        const result = update(records, events)
        if (fail) { fail = false; throw new Error('delta-update-failed') }
        return result
      }
    })
    t.after(() => pages.close())
    const query = { offset: 0, limit: 20 }, feed = () => cache.diagnosticFeed(String(session.id))
    pages(session, feed(), query); assert.equal(processed, 1000)
    pages(session, feed(), query); assert.equal(processed, 1000); assert.equal(reads.mock.callCount(), 0)
    await cache.put('live-request', String(session.id), 'request', { callId: 'live', phase: 'prepared', purpose: 'conversation', careInstructions: [{ kind: 'guidance', text: 'first' }] })
    pages(session, feed(), query); assert.equal(processed, 1001); assert.equal(work(), 1000)
    await cache.put('live-request', String(session.id), 'request', { callId: 'live', phase: 'ready', purpose: 'conversation', careInstructions: [{ kind: 'guidance', text: 'second' }] })
    const updated = pages(session, feed(), query); assert.equal(processed, 1003); assert.equal(updated.items[0].text, 'second')
    const tail = append()
    const after = feed().consume(observer)
    assert.equal(after.added.length, 2, 'slow readers receive one new settlement and only the latest live revision')
    assert.equal(after.removed.length, 0); assert.equal(work(), 1001)
    pages(session, feed(), query); assert.equal(processed, 1004)
    await cache.put('late-native', String(session.id), 'request', { phase: 'settled', eventSeq: tail.seq, purpose: 'conversation', careInstructions: [{ kind: 'guidance', text: 'native-enriched' }] })
    const enriched = pages(session, feed(), query); assert.equal(processed, 1006); assert.equal(work(), 1002)
    assert.ok(enriched.items.some(item => item.text === 'native-enriched'))
    const pageReads = reads.mock.callCount()
    fail = true
    await cache.put('live-request', String(session.id), 'request', { callId: 'live', phase: 'dispatched', purpose: 'conversation', careInstructions: [{ kind: 'guidance', text: 'retry' }] })
    assert.throws(() => pages(session, feed(), query), /delta-update-failed/)
    const retried = pages(session, feed(), query)
    assert.ok(retried.items.some(item => item.text === 'retry')); assert.equal(reads.mock.callCount(), pageReads)
    cache.release(session)
    const released = pages(session, feed(), query)
    assert.ok(!released.items.some(item => item.text === 'retry'))
    assert.equal(old.length, 1000); assert.equal(cache.view(String(session.id)).length, 1001)
    // Restore the native array iterator before Host teardown, not to permit production rescans.
    Object.defineProperty(native, Symbol.iterator, { configurable: true, value: originalIterator })
  })

  test('native rewrite views never initialize settled history and coalesce exact wire changes', async t => {
    const ctx = await harness.open(t), logs = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-rewrite-view'))
    const cache = createRequestCache({ sessions: ctx.sessions, logs, measureInput: () => ({ textTokens: 0, visualTokens: 0 }) })
    const journal = createRewriteJournal({ logs, owner: () => session, store: () => undefined, durable: {
      put: async (rewrite: object) => cache.put('rewrite', String(session.id), 'maintenance', { action: 'request-rewrite', phase: 'recorded', rewrite }),
      list: () => cache.rewriteRecords(String(session.id)),
    } })
    t.after(async () => { journal.close(); await cache.close() })
    const reads = t.mock.method(session, 'eventAt'), snapshot = t.mock.method(session, 'snapshotEvents')
    t.mock.method(cache, 'list', () => { throw new Error('full-request-list') })
    t.mock.method(cache, 'view', () => { throw new Error('full-request-view') })
    for (let index = 0; index < 1000; index++) await journal.record({ sessionId: String(session.id), hash: `rewrite-${index}`, at: index, removed: 'x'.repeat(2048) })
    const cold = await journal.view(String(session.id)), cursor = {}, slow = {}
    assert.equal(rewriteCut(cold)!.feed.consume(cursor).added.length, 1000)
    assert.equal(rewriteCut(cold)!.feed.consume(slow).added.length, 1000)
    const old = [...rewriteSnapshot(cold)]
    const work = () => logs.cache.report().find(row => row.name === 'rewrite-view')?.work
    assert.equal(work(), 1000)
    const wireBuilds = () => logs.cache.report().find(row => row.name === 'rewrite-wire')?.work
    const built = wireBuilds()
    for (let index = 0; index < 10; index++) {
      assert.equal(await journal.view(String(session.id)), cold)
      assert.equal(rewriteCut(cold)!.feed.consume(cursor).added.length, 0)
    }
    assert.equal(work(), 1000)
    assert.equal(wireBuilds(), built, 'unchanged reads never reparse or clone rewrite bodies')
    for (let index = 1000; index < 1020; index++) {
      await journal.record({ sessionId: String(session.id), hash: 'rewrite-0', at: index, added: String(index) })
      const value = await journal.view(String(session.id))
      const delta = rewriteCut(value)!.feed.consume(cursor)
      assert.equal(delta.added.length, 1); assert.equal(delta.removed.length, 1)
    }
    const latest = await journal.view(String(session.id)), delta = rewriteCut(latest)!.feed.consume(slow)
    assert.equal(delta.added.length, 1); assert.equal(delta.removed.length, 1)
    assert.equal(delta.added[0].added, '1019'); assert.equal(old[999].at, 0)
    assert.equal(work(), 1020); assert.equal(reads.mock.callCount(), 0); assert.equal(snapshot.mock.callCount(), 0)
    logs.cache.release(session)
    assert.equal(logs.cache.report().find(row => row.name === 'rewrite-wire')?.entries, 0, 'native release drops all wire caches despite retained source rows')
    const rebuilt = await journal.view(String(session.id))
    assert.notEqual(rewriteCut(rebuilt)!.feed, rewriteCut(latest)!.feed)
    assert.equal(rewriteSnapshot(rebuilt).length, 1000)
  })

  test('native external rewrite JSON reuses normalization and releases every wire entry with its Session', async t => {
    const ctx = await harness.open(t), logs = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-external-rewrite'))
    const sessionId = String(session.id), rows = Array.from({ length: 1000 }, (_, index) => ({ hash: `external-${index}`, at: index, removed: 'x'.repeat(2048) }))
    let externalReads = 0
    const journal = createRewriteJournal({ logs, owner: () => session, store: () => ({
      async listAttributes() {
        externalReads++
        return rows.map(value => ({ sessionId, value: JSON.parse(JSON.stringify(value)) }))
      },
    }) })
    t.after(() => journal.close())
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents')
    const work = () => logs.cache.report().find(row => row.name === 'rewrite-wire')?.work
    const cold = await journal.view(sessionId), reader = {}
    assert.equal(rewriteCut(cold)!.feed.consume(reader).added.length, 1000)
    const old = [...rewriteSnapshot(cold)]
    for (let index = 0; index < 10; index++) assert.equal(await journal.view(sessionId), cold)
    assert.equal(externalReads, 11); assert.equal(work(), 1000)
    rows[0].removed = 'actual external mutation'
    const delta = rewriteCut(await journal.view(sessionId))!.feed.consume(reader)
    assert.equal(delta.added.length, 1); assert.equal(delta.removed.length, 1)
    assert.equal(delta.added[0].removed, 'actual external mutation'); assert.equal(work(), 1001)
    assert.equal(old.at(-1)!.removed, 'x'.repeat(2048))
    logs.cache.release(session)
    assert.ok(logs.cache.report().filter(row => row.name.startsWith('rewrite-')).every(row => row.entries === 0))
    const rebuilt = await journal.view(sessionId)
    assert.notEqual(rewriteCut(rebuilt)!.feed, rewriteCut(cold)!.feed)
    assert.equal(rewriteSnapshot(rebuilt).length, 1000); assert.equal(work(), 2001)
    assert.equal(reads.mock.callCount(), 0); assert.equal(snapshots.mock.callCount(), 0)
  })

  test('native diagnostic pages materialize only requested bodies and retain unaffected entries', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-lazy-pages'))
    for (let index = 0; index < 1000; index++) session.append('user/message', notice(`notice-${index}`), { surfaceOp: 'append' })
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents')
    let classified = 0, built = 0
    const pages = createDiagnosticPages(history, promptEventTypes, () => {
      const update = createPromptIndex()
      return (records: DiagnosticRecordInput<CacheRecord>, added: readonly SessionEvent[]) => {
        classified += added.length
        const result = update(records, added)
        for (const entry of result.entries.slice(0, result.entries.size)) if (!observed.has(entry)) {
          observed.add(entry)
          const materialize = entry.materialize
          t.mock.method(entry, 'materialize', (log: DiagnosticRead) => { built++; return materialize(log) })
        }
        return result
      }
    })
    const observed = new WeakSet<object>(), records: CacheRecord[] = []
    const first = pages(session, records, { offset: 0, limit: 20 })
    assert.equal(first.total, 1000); assert.equal(classified, 1000); assert.equal(built, 20)
    const originalReads = reads.mock.callCount()
    const repeated = pages(session, records, { offset: 0, limit: 20 })
    assert.equal(repeated.items[0], first.items[0]); assert.equal(built, 20); assert.equal(reads.mock.callCount(), originalReads)
    const old = pages(session, records, { offset: 0, limit: 20, seq: 4 })
    assert.equal(old.offset, 980); assert.equal(old.selectedFound, true); assert.equal(built, 40)
    session.append('user/message', notice('new notice'), { surfaceOp: 'append' })
    const grown = pages(session, records, { offset: 1, limit: 20 })
    assert.equal(grown.items[0], first.items[0]); assert.equal(classified, 1001); assert.equal(built, 40)
    pages(session, records, { offset: 0, limit: 20 }); assert.equal(built, 41)
    const request: CacheRecord = { key: 'request', version: 1, sessionId: String(session.id), kind: 'request', at: 2, data: { callId: 'joined', requestSourceSeqs: [999] } }
    const changed = pages(session, [request], { offset: 1, limit: 20 })
    assert.notEqual(changed.items[0], first.items[0]); assert.equal(changed.items[1], first.items[1]); assert.equal(built, 42)
    assert.equal(snapshots.mock.callCount(), 0)
  })

  test('native action pages materialize one group and reassign late transaction ownership', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-action-pages'))
    let built = 0
    const observed = new WeakSet<object>()
    const pages = createDiagnosticPages(history, actionEventTypes, () => {
      const update = createActionIndex()
      return (records: DiagnosticRecordInput<CacheRecord>, added: readonly SessionEvent[]) => {
        const result = update(records, added)
        for (const entry of result.entries.slice(0, result.entries.size)) if (!observed.has(entry)) {
          observed.add(entry); const materialize = entry.materialize
          t.mock.method(entry, 'materialize', (log: DiagnosticRead) => { built++; return materialize(log) })
        }
        return result
      }
    })
    const records = Array.from({ length: 200 }, (_, index) => record(`audit-${index}`, { action: 'summary', compactionId: `child-${index}`, phase: 'committed' }))
    const feed = createDiagnosticRecordFeed<CacheRecord>(compareDiagnosticRecords)
    for (const row of records) feed.set(row.key, row)
    const first = pages(session, feed, { offset: 0, limit: 1 })
    assert.equal(built, 1); assert.equal(first.total, 200)
    const again = pages(session, feed, { offset: 0, limit: 1 }); assert.equal(again.items[0], first.items[0]); assert.equal(built, 1)
    const owner = record('owner', { action: 'prune', operationId: 'parent', summaryTransactions: ['child-0', 'child-1'], phase: 'failed', error: 'retained failure' })
    feed.set(owner.key, owner)
    const regrouped = pages(session, feed, { offset: 0, limit: 1 })
    assert.equal(regrouped.total, 199); assert.equal(built, 2)
    assert.equal(regrouped.items[0].id, 'parent'); assert.deepEqual(regrouped.items[0].phases, ['committed', 'committed', 'failed'])
    assert.equal(regrouped.items[0].error, 'retained failure')
    const admission = { ...record('admission', { purpose: 'conversation', budget: { input: 10 }, logRevision: 2, phase: 'prepared' }), kind: 'request' as const }
    feed.set(admission.key, admission)
    assert.equal(pages(session, feed, { offset: 0, limit: 1 }).admission.phase, 'prepared')
    const updatedAdmission = { ...admission, data: { ...admission.data, phase: 'dispatched' } }
    feed.set(admission.key, updatedAdmission)
    assert.equal(pages(session, feed, { offset: 0, limit: 1 }).admission.phase, 'dispatched')
    feed.delete(admission.key); feed.delete(owner.key)
    const ungrouped = pages(session, feed, { offset: 0, limit: 200 })
    assert.equal(ungrouped.total, 200); assert.equal(ungrouped.admission, undefined)
    assert.ok(!ungrouped.items.some(item => item.id === 'parent'))
    assert.ok(ungrouped.items.some(item => item.id === 'child-0' && item.phase === 'committed'))
    assert.equal(regrouped.items[0].phase, 'failed', 'a retained page remains an immutable old cut')
  })

  test('native diagnostic retry discards a partially mutated metadata index', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-page-partial'))
    const records: object[] = []; let fail = false, created = 0
    const pages = createDiagnosticPages(history, ['user/message'], () => {
      created++
      const entries = createDiagnosticIndex<number>()
      return (_records: DiagnosticRecordInput<object>, added: readonly SessionEvent[]) => {
        for (const event of added) entries.set({ id: String(event.seq), order: event.seq, seq: event.seq, materialize: () => event.seq })
        if (fail) {
          entries.delete('0'); fail = false
          throw new Error('partial index failed')
        }
        return { entries }
      }
    })
    session.append('user/message', notice('first'), { surfaceOp: 'append' })
    const reads = t.mock.method(session, 'eventAt')
    const initial = pages(session, records, { offset: 0, limit: 20 })
    session.append('user/message', notice('second'), { surfaceOp: 'append' })
    fail = true
    assert.throws(() => pages(session, records, { offset: 0, limit: 20 }), /partial index failed/)
    const count = reads.mock.callCount()
    assert.deepEqual(pages(session, records, { offset: 0, limit: 20 }).items, [1, 0])
    assert.deepEqual(initial.items, [0]); assert.equal(created, 2)
    assert.equal(reads.mock.callCount(), count, 'retry rebuilds metadata from already accepted shared facts')
  })

  test('native diagnostic caches refresh future evidence and retry failed projections', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-page-retry'))
    const records: object[] = []; let fail = true, updates = 0, bodies = 0
    const pages = createDiagnosticPages(history, ['user/message'], () => {
      const entries = createDiagnosticIndex<{ evidence?: string }>()
      return (_records: DiagnosticRecordInput<object>, added: readonly SessionEvent[]) => {
        updates++; if (fail) { fail = false; throw new Error('projection failed') }
        for (const event of added) if (event.seq === 0) entries.set({ id: 'first', order: 0, seq: 0, materialize(log) {
          bodies++; return { evidence: log.at(2)?.type }
        } })
        return { entries }
      }
    })
    session.append('user/message', notice('first'), { surfaceOp: 'append' })
    assert.throws(() => pages(session, records, { offset: 0, limit: 1 }), /projection failed/)
    assert.equal(pages(session, records, { offset: 0, limit: 1 }).items[0].evidence, undefined)
    session.append('user/message', notice('second'), { surfaceOp: 'append' })
    pages(session, records, { offset: 0, limit: 1 }); assert.equal(bodies, 1)
    session.append('user/message', notice('third'), { surfaceOp: 'append' })
    assert.equal(pages(session, records, { offset: 0, limit: 1 }).items[0].evidence, 'user/message')
    assert.equal(bodies, 2); assert.equal(updates, 4)
  })
}
