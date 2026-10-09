import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextCareStatus, dictionaries, tone } from '../src/client-view.js'
import { contextCareProjection } from '../src/projection.js'
import {
  NoticeNodeView, createNoticeDefinition, noticeBody, noticeData, noticeLabel,
  noticeProducer, noticeValues,
} from '../src/notice-view.js'
import { renderState } from '../src/policy.js'

const renderNotice = data => renderToStaticMarkup(React.createElement(NoticeNodeView, {
  node: { data }, t: key => dictionaries.zh[key],
}))

const render = state => renderToStaticMarkup(React.createElement(ContextCareStatus, {
  useProjection(key) { assert.equal(key, 'contextCareNumeric'); return state },
  useCareActions: selector => selector(new Map()), useRewriteHealth: selector => selector(new Map()), watchActions: () => () => {}, watchRewrites: () => () => {},
  t: key => dictionaries.zh[key],
}))

test('Chinese UI displays numeric percentages, levels and independent colors', () => {
  const markup = render({ fatigue: 'elevated', fatigueValue: 42.3, wakefulness: 'high', wakefulnessValue: 100 })
  assert.match(markup, /疲劳度: 42.3% \(较高\)/)
  assert.match(markup, /唤醒值: 100% \(高\)/)
  assert.match(markup, /color:var\(--dsw-alias-state-business-primary\)/)
  assert.match(markup, /var\(--dsw-alias-state-success-primary\)/)
  assert.match(markup, /最近一次请求准备/)
})

test('all four ranges have distinct colors with exact thresholds', () => {
  for (const kind of ['fatigue', 'wakefulness']) {
    assert.equal(new Set([0, 30, 60, 85].map(value => tone(value, kind))).size, 4)
    assert.equal(tone(29.9, kind), tone(0, kind))
    assert.equal(tone(59.9, kind), tone(30, kind))
    assert.equal(tone(84.9, kind), tone(60, kind))
    assert.equal(tone(100, kind), tone(85, kind))
  }
  assert.match(tone(null, 'fatigue'), /label-secondary/)
  assert.match(tone(100, 'fatigue'), /error/)
  assert.match(tone(100, 'wakefulness'), /success/)
})

test('UI does not invent numeric samples for old or uncalibrated observations', () => {
  assert.match(render(null), /等待首次状态/)
  const markup = render({ fatigue: 'high', wakefulness: 'low', fatigueValue: null, wakefulnessValue: null })
  assert.match(markup, /疲劳度: 未校准/)
  assert.match(markup, /唤醒值: 未校准/)
  assert.doesNotMatch(markup.replace(/<style>[\s\S]*?<\/style>/g, ''), /NaN|undefined|\d+%/)
  assert.match(render({ fatigue: 'normal', wakefulness: 'low', fatigueValue: 0, wakefulnessValue: 0 }), /疲劳度: 0%/)
})

test('UI replays numeric metadata while model text retains only grades', () => {
  const state = { fatigue: 'high', fatigueValue: 70.1, wakefulness: 'low', wakefulnessValue: 20 }
  const text = renderState(state)
  assert.doesNotMatch(text, /70.1|20|%/)
  const event = { seq: 9, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-context-care:state', contextCare: { fatigueValue: 70.1, wakefulnessValue: 20 } }, content: [{ type: 'text', text }] } }
  assert.deepEqual(contextCareProjection.apply(null, event), { ...state, sampledSeq: 9 })
  const legacy = { ...event, data: { ...event.data, source: { kind: 'plugin', plugin: 'dsh-context-care:state' } } }
  assert.deepEqual(contextCareProjection.apply(null, legacy), { fatigue: 'high', fatigueValue: null, wakefulness: 'low', wakefulnessValue: null, sampledSeq: 9 })
  assert.equal(contextCareProjection.apply(null, { ...event, data: { ...event.data, source: { kind: 'user' } } }), null)
  assert.equal(contextCareProjection.apply(null, { ...event, data: { ...event.data, content: [{ type: 'text', text: 'garbled' }] } }), null)
})

const noticeEvent = seq => ({
  seq, time: 1790000000000, type: 'user/message',
  data: {
    id: 'm' + seq, role: 'user',
    source: { kind: 'plugin:dsh-context-care:state', form: 'notice', summary: 'Context state' },
    content: [{ type: 'text', text: '<context-care>\n疲劳：正常；唤醒值：高。\n</context-care>' }],
  },
})

test('notice definition keys on form only: every notice in, plain user messages untouched', () => {
  const definition = createNoticeDefinition()
  assert.deepEqual(definition.match(noticeEvent(12)), { id: 'notice:12', role: 'start' })
  assert.equal(definition.match({ type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [] } }), null)
  const snapshot = noticeEvent(13)
  snapshot.data.source = { kind: 'runtime-context', form: 'snapshot' }
  assert.equal(definition.match(snapshot), null)
  // Sources other plugins register on the notice channel are notices too.
  const foreign = noticeEvent(14)
  foreign.data.source = { kind: 'plugin:dsh-better-session-query', form: 'notice', summary: '记忆闲置' }
  assert.deepEqual(definition.match(foreign), { id: 'notice:14', role: 'start' })
})

test('notice node keeps the durable position and unwraps the message text', () => {
  const definition = createNoticeDefinition()
  const event = noticeEvent(12)
  const node = definition.buildViewNode({
    key: 'k', id: 'notice:12', start: { event, location: { kind: 'turn', turn: 3 } }, matches: [],
  })
  assert.equal(node.kind, 'context-care-notice')
  assert.equal(node.visibility, 'visible')
  assert.equal(node.anchorSeq, 12)
  assert.deepEqual(node.location, { kind: 'turn', turn: 3 })
  assert.equal(node.data.producer, 'dsh-context-care:state')
  assert.equal(node.data.body, '疲劳：正常；唤醒值：高。')
})

test('notice card speaks human: source label, sampled values, unwrapped body', () => {
  const markup = renderNotice({
    seq: 12, producer: 'dsh-context-care:state', summary: '',
    values: [{ kind: 'fatigue', value: 30.4 }, { kind: 'wakefulness', value: 86.9 }],
    body: '疲劳：正常；唤醒值：高。',
  })
  assert.match(markup, /上下文照料 · 状态/)
  assert.match(markup, /疲劳度 30%/)
  assert.match(markup, /唤醒值 87%/)
  assert.match(markup, /疲劳：正常/)
  assert.doesNotMatch(markup, /context-care>/)
  assert.doesNotMatch(markup, /Context state/)
  assert.match(markup, /data-context-care-seq="12"/)
})

test('unwrapping drops model-facing wrapper lines and keeps real content', () => {
  assert.equal(noticeBody('<context-care>\n疲劳：正常；唤醒值：高。\n</context-care>'), '疲劳：正常；唤醒值：高。')
  // A tag line that carries content is ordinary text and stays untouched.
  assert.equal(noticeBody('<path>D:\\dev\\a.md</path>'), '<path>D:\\dev\\a.md</path>')
})

test('values come only from real samples; a placeholder summary yields to them', () => {
  assert.deepEqual(noticeValues({ contextCare: { fatigueValue: null, wakefulnessValue: null } }), [])
  assert.deepEqual(noticeValues({}), [])
  const sampled = noticeData({
    type: 'user/message', seq: 1, time: 0,
    data: {
      source: {
        kind: 'plugin:dsh-context-care:state', form: 'notice', summary: 'Context state',
        contextCare: { fatigueValue: 30.4, wakefulnessValue: 86.9 },
      },
      content: [{ type: 'text', text: '<context-care>\nx\n</context-care>' }],
    },
  })
  assert.equal(sampled.summary, '')
  assert.equal(sampled.body, 'x')
  assert.equal(sampled.values.length, 2)
})

test('source labels speak for this plugin and keep foreign producers verbatim', () => {
  const t = key => dictionaries.zh[key]
  assert.equal(noticeLabel('dsh-context-care:state', t), '上下文照料 · 状态')
  assert.equal(noticeLabel('dsh-context-care:watch:time-anxiety', t), '上下文照料 · 流式提醒 · time-anxiety')
  assert.equal(noticeLabel('dsh-better-session-query', t), 'dsh-better-session-query')
  assert.equal(noticeLabel('', t), '未知来源')
})

test('producer name reads both source generations; empty text makes no node', () => {
  assert.equal(noticeProducer({ kind: 'plugin:dsh-context-care:state' }), 'dsh-context-care:state')
  assert.equal(noticeProducer({ kind: 'plugin', plugin: 'dsh-context-care:state' }), 'dsh-context-care:state')
  assert.equal(noticeProducer(null), '')
  const definition = createNoticeDefinition()
  const empty = noticeEvent(15)
  empty.data.content = []
  assert.equal(definition.match(empty), null)
})
