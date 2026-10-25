import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contextCareActions } from '../src/action-view-data.js'
import { ActionDetails } from '../src/action-view.js'
import { ActionRecord } from '../src/action-detail.js'
import { createActionRecords } from '../src/action-records.js'
import { dictionaries } from '../src/client-view.js'
import { careStreamFixture, turn } from './fixtures/care-stream.js'
import { eventLog } from './fixtures/event-log.js'

test('action reads preserve the Host storage diagnostic in their visible error state', async () => {
  const transport = careStreamFixture()
  const records = createActionRecords({ changes: transport.changes })
  const stop = records.watch('failed-session'); await turn()
  transport.push({ sessionId: 'failed-session', topic: 'actions' }, { name: 'Error', message: 'Persistent journal write failed' }, 'error')
  await turn()
  const value = records.source.getSnapshot().get('failed-session:0')
  assert.equal(value.status, 'error')
  assert.match(value.error, /Error: Persistent journal write failed/)
  const markup = renderToStaticMarkup(React.createElement(ActionDetails, { value, t: key => dictionaries.zh[key] }))
  assert.match(markup, /role="alert"/)
  assert.match(markup, /Persistent journal write failed/)
  stop()
  records.dispose(); transport.changes.dispose()
})

const record = (key, data, kind = 'maintenance') => ({ key, at: 10, kind, data })

test('historical compaction exposes stored facts without fabricating before/after or audit failure', () => {
  const sources = Array.from({ length: 145 }, (_, index) => 18085 + index)
  const events = [{ seq: 18685, type: 'compaction/summary', data: { compactionId: 'historical', llmStreamCall: true,
    shadowedSeqs: sources, shadowedTokenCount: 96722, provider: 'aihub', model: 'gpt-6.1-sol', usage: { inputTokens: 116696, outputTokens: 3719 } } },
  { seq: 18686, type: 'user/message', time: 1791311051163, data: { source: { kind: 'compact-checkpoint', compactionId: 'historical' } },
    surfaceOp: { op: 'replace', startSeq: 18085, endSeq: 18346 } }]
  const view = contextCareActions([], undefined, eventLog(events))
  assert.equal(view.actions[0].auditStatus, 'session-only')
  assert.equal(view.actions[0].beforeInput, undefined)
  assert.equal(view.actions[0].reason, undefined)
  for (const locale of ['zh', 'en']) {
    const markup = renderToStaticMarkup(React.createElement(ActionRecord, { action: view.actions[0], t: key => dictionaries[locale][key] }))
    assert.match(markup, /145.*source|145.*个来源/)
    assert.match(markup, /96,722/)
    assert.match(markup, /116,696.*3,719/)
    assert.match(markup, /aihub.*gpt-6.1-sol/)
    assert.doesNotMatch(markup, /— → — tok|audit incomplete|动作记录不完整|NaN|undefined/)
  }
})

test('multiple summary transactions retain one failed operation and enrich already settled audits', () => {
  const events = ['child1', 'child2'].flatMap((id, index) => [{ seq: 10 + index * 2, type: 'compaction/summary',
    data: { compactionId: id, shadowedSeqs: [index + 1], provider: 'p', model: 'm', usage: { inputTokens: 100, outputTokens: 10 } } },
  { seq: 11 + index * 2, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: id } }, surfaceOp: { op: 'replace', startSeq: index + 1, endSeq: index + 1 } }])
  const view = contextCareActions([record('plan', { action: 'selection', operationId: 'op', phase: 'planning', reason: 'requested' }),
    record('child', { action: 'summary', compactionId: 'child1', phase: 'committed' }),
    record('fail', { action: 'prune', operationId: 'op', summaryTransactions: ['child1', 'child2'], phase: 'failed', beforeInput: 5000, afterInput: 1500, error: 'late error' }),
    record('rule', { action: 'rule-evaluation', phase: 'evaluated' }), record('rewrite', { action: 'request-rewrite', phase: 'recorded' })],
  undefined, eventLog(events))
  assert.equal(view.actions.length, 1)
  const action = view.actions[0]
  assert.equal(action.id, 'op')
  assert.equal(action.phase, 'failed')
  assert.equal(action.reason, 'requested')
  assert.equal(action.afterInput, 1500)
  assert.equal(action.commits.length, 2)
  assert.equal(action.auditStatus, 'complete')
  assert.equal(action.replacements.length, 2)
})

test('action display groups transactions, separates pricing units and reports missing audit after a durable commit', () => {
  const events = [{ seq: 1, type: 'user/message', data: { source: { kind: 'user' } } }, { seq: 2, type: 'compaction/summary', data: { compactionId: 'c', shadowedSeqs: [1] } },
    { seq: 3, type: 'user/message', time: 10, data: { source: { kind: 'compact-checkpoint', compactionId: 'c' } }, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } }]
  const value = contextCareActions([
    record('a', { compactionId: 'c', action: 'summary', phase: 'started', beforeInput: 30000, pricingBasis: { textScale: 4 }, summaryConfig: { secret: 'not-for-wire' } }),
    record('b', { compactionId: 'c', action: 'summary', phase: 'prepared', afterInput: 2000 }),
    record('p', { operationId: 'p', action: 'prune', phase: 'failed', outcome: 'partial', beforeInput: 50000, afterInput: 30000, routeSaving: 20000, heuristicSaving: 5000, error: 'Summary failed after prune' }),
    record('q', { purpose: 'conversation', callId: 'q', dispatchOrder: 1, dispatched: true, route: { provider: 'p', model: 'm' }, budget: { inputTokens: 30000, hardInput: 40000 }, system: 'private prompt', tools: ['private schema'] }, 'request'),
  ], undefined, eventLog(events))
  const summary = value.actions.find(action => action.id === 'c')
  assert.equal(summary.phase, 'committed')
  assert.equal(summary.journalPersisted, false)
  assert.deepEqual(summary.shadowedSeqs, [1])
  assert.deepEqual(summary.phases, ['started', 'prepared'])
  assert.doesNotMatch(JSON.stringify(value), /private prompt|private schema|not-for-wire|textScale/)
  for (const locale of ['zh', 'en']) {
    const markup = value.actions.map(action => renderToStaticMarkup(React.createElement(ActionRecord, { action, t: key => { assert.ok(dictionaries[locale][key], key); return dictionaries[locale][key] } }))).join('')
    assert.match(markup, /20,000.*5,000/)
    assert.match(markup, /30,000.*2,000/)
    assert.match(markup, locale === 'zh' ? /已有部分持久进展/ : /Partial durable progress/)
    assert.match(markup, locale === 'zh' ? /已有部分动作审计/ : /Partial action audit/)
    assert.doesNotMatch(markup, /NaN|undefined/)
  }
})

test('settled deep handoffs and partial durable failures retain one audited action', () => {
  const event = { seq: 3, type: 'user/message', time: 10, data: { source: { kind: 'compact-checkpoint', compactionId: 'c' } }, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, sourceEventSeqs: [1] }
  for (const phase of ['completed', 'failed']) {
    const view = contextCareActions([
      record('start', { operationId: 'operation', action: 'deep-rest', phase: 'started', beforeInput: 5000 }),
      record('settled', { operationId: 'operation', ...(phase === 'completed' ? { compactionId: 'c' } : {}), action: 'deep-rest', phase,
        outcome: phase === 'failed' ? 'partial' : 'committed', replacements: [{ newSeq: 3, oldStartSeq: 1, oldEndSeq: 1 }], afterInput: 1000 }),
    ], undefined, eventLog([event]))
    assert.equal(view.actions.length, 1)
    assert.equal(view.actions[0].id, 'operation')
    assert.equal(view.actions[0].phase, phase)
    assert.equal(view.actions[0].journalPersisted, true)
  }
  const view = contextCareActions([
    record('latest', { purpose: 'conversation', callId: 'refused', logRevision: 12, dispatched: false, budget: { inputTokens: 6000 } }, 'request'),
    record('old-settlement', { purpose: 'conversation', callId: 'old', logRevision: 10, dispatchOrder: 9, dispatched: true, budget: { inputTokens: 5000 } }, 'request'),
  ], undefined, eventLog([]))
  assert.equal(view.admission.callId, 'refused')
  assert.equal(view.admission.dispatched, false)
})

test('retained pages share a stream and release only their final observer', async () => {
  const transport = careStreamFixture()
  const records = createActionRecords({ changes: transport.changes })
  const stopOne = records.watch('s1', 0)
  const stopTwo = records.watch('s1', 0)
  const stopOther = records.watch('s2', 20)
  await turn()
  assert.equal(transport.opened.length, 1)
  assert.deepEqual(transport.opened[0].subscriptions.map(item => [item.sessionId, item.offset]), [['s1', 0], ['s2', 20]])
  transport.push({ sessionId: 's1', topic: 'actions' }, { actions: [{ id: 'new' }], nextOffset: null }); await turn()
  assert.equal(records.source.getSnapshot().get('s1:0').actions[0].id, 'new')
  stopOne(); stopOne(); await turn()
  assert.equal(transport.opened.length, 1)
  stopTwo(); await turn()
  assert.equal(records.source.getSnapshot().has('s1:0'), false)
  assert.deepEqual(transport.opened.at(-1).subscriptions.map(item => item.sessionId), ['s2'])
  records.dispose(); await turn()
  assert.ok(transport.opened.every(item => item.signal.aborted))
  assert.equal(records.source.getSnapshot().size, 0)
  stopOther(); transport.changes.dispose()
})
