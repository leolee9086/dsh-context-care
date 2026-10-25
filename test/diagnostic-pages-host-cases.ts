import test from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'plugin:dsh-context-care:state': { kind: 'plugin:dsh-context-care:state' } }
}
import type { DiagnosticRead } from '../lib/diagnostic-pages.js'
import { ensureSessionLog } from '../lib/session-log.js'
import { createDiagnosticPages, createDiagnosticIndex } from '../lib/diagnostic-pages.js'
import type { CacheRecord } from '../lib/request-cache.js'
import { createPromptIndex, promptEventTypes } from '../src/prompt-view-data.js'
import { createActionIndex, actionEventTypes } from '../src/action-view-data.js'

interface Harness { open(t: test.TestContext): Promise<Context> }
const notice = (text: string) => createUserMessage({ source: { kind: 'plugin:dsh-context-care:state' }, content: [{ type: 'text', text }] })
const record = (key: string, data: CacheRecord['data']): CacheRecord => ({ key, version: 1, sessionId: 'pages', kind: 'maintenance', at: 1, data })

export function registerDiagnosticPageCases(harness: Harness): void {
  test('native diagnostic pages materialize only requested bodies and retain unaffected entries', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-lazy-pages'))
    for (let index = 0; index < 1000; index++) session.append('user/message', notice(`notice-${index}`), { surfaceOp: 'append' })
    const reads = t.mock.method(session, 'eventAt'), snapshots = t.mock.method(session, 'snapshotEvents')
    let classified = 0, built = 0
    const pages = createDiagnosticPages(history, promptEventTypes, () => {
      const update = createPromptIndex()
      return (records: readonly CacheRecord[], added: readonly SessionEvent[]) => {
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
      return (records: readonly CacheRecord[], added: readonly SessionEvent[]) => {
        const result = update(records, added)
        for (const entry of result.entries.slice(0, result.entries.size)) if (!observed.has(entry)) {
          observed.add(entry); const materialize = entry.materialize
          t.mock.method(entry, 'materialize', (log: DiagnosticRead) => { built++; return materialize(log) })
        }
        return result
      }
    })
    const records = Array.from({ length: 200 }, (_, index) => record(`audit-${index}`, { action: 'summary', compactionId: `child-${index}`, phase: 'committed' }))
    const first = pages(session, records, { offset: 0, limit: 1 })
    assert.equal(built, 1); assert.equal(first.total, 200)
    const again = pages(session, records, { offset: 0, limit: 1 }); assert.equal(again.items[0], first.items[0]); assert.equal(built, 1)
    const owner = record('owner', { action: 'prune', operationId: 'parent', summaryTransactions: ['child-0', 'child-1'], phase: 'failed', error: 'retained failure' })
    const regrouped = pages(session, [...records, owner], { offset: 0, limit: 1 })
    assert.equal(regrouped.total, 199); assert.equal(built, 2)
    assert.equal(regrouped.items[0].id, 'parent'); assert.deepEqual(regrouped.items[0].phases, ['committed', 'committed', 'failed'])
    assert.equal(regrouped.items[0].error, 'retained failure')
  })

  test('native diagnostic retry discards a partially mutated metadata index', async t => {
    const ctx = await harness.open(t), history = ensureSessionLog(ctx), session = ctx.sessions.create(SessionId('native-page-partial'))
    const records: object[] = []; let fail = false, created = 0
    const pages = createDiagnosticPages(history, ['user/message'], () => {
      created++
      const entries = createDiagnosticIndex<number>()
      return (_records: readonly object[], added: readonly SessionEvent[]) => {
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
      return (_records: readonly object[], added: readonly SessionEvent[]) => {
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
