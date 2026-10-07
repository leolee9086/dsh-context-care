import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contextCareActions } from '../src/action-view-data.js'
import { ActionDetails } from '../src/action-view.js'
import { createActionRecords } from '../src/action-records.js'
import { dictionaries } from '../src/client-view.js'

test('action polling preserves the Host storage diagnostic in its visible error state', async () => {
  const records = createActionRecords({ fetcher: async () => new Response(JSON.stringify({ error: 'journal-unavailable', message: 'Persistent journal write failed' }),
    { status: 500, headers: { 'content-type': 'application/json' } }), setTimer: () => 1, clearTimer() {} })
  const stop = records.watch('failed-session')
  for (let step = 0; step < 16; step++) await Promise.resolve()
  const value = records.source.getSnapshot().get('failed-session:0')
  assert.equal(value.status, 'error')
  assert.match(value.error, /actions: HTTP 500: Persistent journal write failed/)
  const markup = renderToStaticMarkup(React.createElement(ActionDetails, { value, t: key => dictionaries.zh[key] }))
  assert.match(markup, /role="alert"/)
  assert.match(markup, /Persistent journal write failed/)
  stop()
  records.dispose()
})

const record = (key, data, kind = 'maintenance') => ({ key, at: 10, kind, data })

test('action display groups transactions, separates pricing units and reports missing audit after a durable commit', () => {
  const events = [{ seq: 1, type: 'user/message', data: { source: { kind: 'user' } } }, { seq: 2, type: 'compaction/summary', data: { compactionId: 'c', shadowedSeqs: [1] } },
    { seq: 3, type: 'user/message', time: 10, data: { source: { kind: 'compact-checkpoint', compactionId: 'c' } }, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } }]
  const value = contextCareActions([
    record('a', { compactionId: 'c', action: 'summary', phase: 'started', beforeInput: 30000, pricingBasis: { textScale: 4 }, summaryConfig: { secret: 'not-for-wire' } }),
    record('b', { compactionId: 'c', action: 'summary', phase: 'prepared', afterInput: 2000 }),
    record('p', { operationId: 'p', action: 'prune', phase: 'failed', outcome: 'partial', beforeInput: 50000, afterInput: 30000, routeSaving: 20000, heuristicSaving: 5000, error: 'Summary failed after prune' }),
    record('q', { purpose: 'conversation', callId: 'q', dispatchOrder: 1, dispatched: true, route: { provider: 'p', model: 'm' }, budget: { inputTokens: 30000, hardInput: 40000 }, system: 'private prompt', tools: ['private schema'] }, 'request'),
  ], { snapshotEvents: () => events, eventAt: seq => events.find(event => event.seq === seq) })
  const summary = value.actions.find(action => action.id === 'c')
  assert.equal(summary.phase, 'committed')
  assert.equal(summary.journalPersisted, false)
  assert.deepEqual(summary.shadowedSeqs, [1])
  assert.deepEqual(summary.phases, ['started', 'prepared'])
  assert.doesNotMatch(JSON.stringify(value), /private prompt|private schema|not-for-wire|textScale/)
  for (const locale of ['zh', 'en']) {
    const markup = renderToStaticMarkup(React.createElement(ActionDetails, { value: { status: 'ready', ...value }, t: key => { assert.ok(dictionaries[locale][key], key); return dictionaries[locale][key] } }))
    assert.match(markup, /20,000.*5,000/)
    assert.match(markup, /30,000.*2,000/)
    assert.match(markup, locale === 'zh' ? /已有部分持久进展/ : /Partial durable progress/)
    assert.match(markup, locale === 'zh' ? /动作记录不完整/ : /audit incomplete/)
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
    ], { snapshotEvents: () => [event], eventAt: () => ({ type: 'user/message' }) })
    assert.equal(view.actions.length, 1)
    assert.equal(view.actions[0].id, 'operation')
    assert.equal(view.actions[0].phase, phase)
    assert.equal(view.actions[0].journalPersisted, true)
  }
  const view = contextCareActions([
    record('latest', { purpose: 'conversation', callId: 'refused', logRevision: 12, dispatched: false, budget: { inputTokens: 6000 } }, 'request'),
    record('old-settlement', { purpose: 'conversation', callId: 'old', logRevision: 10, dispatchOrder: 9, dispatched: true, budget: { inputTokens: 5000 } }, 'request'),
  ])
  assert.equal(view.admission.callId, 'refused')
  assert.equal(view.admission.dispatched, false)
})

test('session polling reserves one fetch, releases retained pages, and aborts in-flight work on unload', async () => {
  const requests = []
  let tick
  let cleared = false
  const records = createActionRecords({ fetcher: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    setTimer: callback => { tick = callback; return 1 }, clearTimer: () => { cleared = true } })
  const stopOne = records.watch('s1', 0)
  const stopTwo = records.watch('s1', 0)
  const stopOther = records.watch('s2', 20)
  tick()
  assert.equal(requests.length, 2)
  assert.match(requests[0].url, /sessionId=s1&limit=20&offset=0/)
  requests[0].resolve({ ok: true, json: async () => ({ actions: [], nextOffset: null }) })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(records.source.getSnapshot().get('s1:0').status, 'ready')
  stopOne()
  assert.equal(requests[0].options.signal.aborted, false)
  stopTwo()
  assert.equal(requests[0].options.signal.aborted, true)
  assert.equal(records.source.getSnapshot().has('s1:0'), false)
  records.dispose()
  assert.equal(cleared, true)
  assert.equal(requests[1].options.signal.aborted, true)
  requests[1].resolve({ ok: true, json: async () => ({ actions: [{ id: 'stale' }] }) })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(records.source.getSnapshot().size, 0)
  stopOther()
})
