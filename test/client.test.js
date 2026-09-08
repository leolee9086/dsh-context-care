import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextCareStatus, dictionaries, tone } from '../src/client-view.js'
import { contextCareProjection } from '../src/projection.js'
import { renderState } from '../src/policy.js'

const render = state => renderToStaticMarkup(React.createElement(ContextCareStatus, {
  useProjection(key) { assert.equal(key, 'contextCareNumeric'); return state },
  t: key => dictionaries.zh[key],
}))

test('Chinese UI displays numeric percentages, levels and independent colors', () => {
  const markup = render({ fatigue: 'elevated', fatigueValue: 42.3, wakefulness: 'high', wakefulnessValue: 100 })
  assert.match(markup, /疲劳度: 42.3% \(较高\)/)
  assert.match(markup, /唤醒值: 100% \(高\)/)
  assert.match(markup, /color:#3b82f6/)
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
  assert.doesNotMatch(markup, /NaN|undefined|\d+%/)
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
