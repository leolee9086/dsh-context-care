import React, { useEffect, useState } from 'react'
import { CareStyles } from './care-styles.js'
import { h, number, date, label, row, badge, RawRecord, useRecordSelection } from './care-ui.js'
import { ActionRecord, actionSources, change, phaseTone } from './action-detail.js'

function Budget({ admission, t }) {
  const budget = admission?.budget
  if (!budget) return h('p', { className: 'care-empty' }, t('actionsNoAdmission'))
  const limit = budget.hardInput
  const percent = Number.isFinite(budget.inputTokens) && Number.isFinite(limit) && limit > 0 ? budget.inputTokens / limit * 100 : null
  return h('section', { className: 'care-budget', 'aria-label': t('actionsBudget') },
    h('div', { className: 'care-budget-heading' }, h('h4', null, t('actionsBudget')),
      badge(t(admission.dispatched === true ? 'actionsSent' : admission.dispatched === false ? 'actionsNotSent' : 'deliveryUnknown'), admission.dispatched === true ? 'success' : undefined)),
    h('div', { className: 'care-figures' }, h('strong', null, number(budget.inputTokens)), h('span', { className: 'care-muted' }, `/ ${number(limit)} ${t('tokens')}`)),
    h('div', { className: 'care-muted' }, `${t('actionsUsage')}${percent === null ? '—' : `${Math.round(percent)}%`}`),
    percent === null ? null : h('div', { className: 'care-meter', role: 'meter', 'aria-label': t('actionsUsage'), 'aria-valuemin': 0, 'aria-valuemax': 100,
      'aria-valuenow': Math.min(100, Math.round(percent)), 'aria-valuetext': `${Math.round(percent)}%`, 'data-over-limit': percent > 100 ? '' : undefined,
      style: { '--care-fill': `${Math.min(100, Math.max(0, percent))}%` } }, h('span'),
      Number.isFinite(budget.softInput) ? h('i', { style: { left: `${Math.min(100, Math.max(0, budget.softInput / limit * 100))}%` }, title: `${t('actionsSoftLimit')} ${number(budget.softInput)}` }) : null),
    h('dl', { className: 'care-fields' }, row(t('actionsSoftLimit'), number(budget.softInput)), row(t('actionsReleaseTarget'), number(budget.releaseTarget))),
    h('div', { className: 'care-route' }, admission.route ? `${admission.route.provider} / ${admission.route.model}` : t('noRoute')),
    h('details', { className: 'care-technical' }, h('summary', null, t('actionsTechnical')),
      h('dl', { className: 'care-fields' }, row(t('actionsCapacity'), `${number(budget.physicalCapacity)} / ${number(budget.policyCapacity)}`),
        row(t('actionsRetention'), `${number(budget.retainTail)} / ${number(budget.completionTokens)}`),
        admission.pricing ? row(t('actionsBasis'), admission.pricing.kind ?? '—') : null,
        admission.pricing ? row(t('actionsTextScale'), Number.isFinite(admission.pricing.textScale) ? admission.pricing.textScale.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—') : null,
        admission.pricing ? row(t('actionsSample'), number(admission.pricing.sampleSeq)) : null,
        admission.rawInput ? row(t('actionsRawPrices'), `${number(admission.rawInput.textTokens)} / ${number(admission.rawInput.visualTokens)}`) : null), h(RawRecord, { value: admission, t })))
}

/** Summary rows lead to a single result detail rather than nested disclosure walls. */
export function ActionDetails({ value, t, revealSource }) {
  const { selected, select, recordRef } = useRecordSelection()
  if (value?.status !== 'ready') return h('div', { role: value?.status === 'error' ? 'alert' : 'status', className: 'care-empty' },
    t(value?.status === 'error' ? 'actionsUnavailable' : 'actionsLoading'), value?.error ? h('div', null, `${t('actionsError')}: ${value.error}`) : null)
  const action = value.actions.find(item => item.id === selected)
  if (action) return h(ActionRecord, { key: action.id, action, t, revealSource, onBack: () => select(null) })
  return h(React.Fragment, null, h(Budget, { admission: value.admission, t }),
    h('div', { className: 'care-section-heading' }, h('h4', null, t('actionsHistory')), h('span', { className: 'care-muted' }, `${value.total ?? value.actions.length}`)),
    value.actions.length ? h('ul', { className: 'care-record-list' }, ...value.actions.map(item => h('li', { key: item.id }, h('button', {
      type: 'button', ref: recordRef(item.id), className: 'care-record', onClick: () => select(item.id), 'aria-label': `${label(t, 'action', item.action)} · ${date(item.at)}`,
    }, h('span', { className: 'care-record-top' }, h('strong', null, label(t, 'action', item.action)), h('time', null, date(item.at))),
    h('span', { className: 'care-record-change' }, Number.isFinite(item.beforeInput) && Number.isFinite(item.afterInput) ? `${change(item)} ${t('tokens')}` : `${actionSources(item).length} ${t('actionsSourceCount')}`),
    h('span', { className: 'care-record-preview' }, item.reason ? label(t, 'reason', item.reason) : t('actionsReasonUnknown')),
    h('span', { className: 'care-record-bottom' }, badge(label(t, 'phase', item.phase), phaseTone(item)), item.outcome ? h('span', null, label(t, 'outcome', item.outcome)) : null, h('span', null, '→'))))))
      : h('p', { className: 'care-empty' }, t('actionsEmpty')))
}

/** Toolbar entries open the two native sidebar tabs. */
export function ContextCareActionsOpener({ sessionId, openActions, openPrompts, t }) {
  const [error, setError] = useState(null)
  const open = callback => { try { callback(sessionId); setError(null) } catch (failure) { setError(String(failure)) } }
  return h('div', { 'data-care-entry': '' }, h(CareStyles),
    h('button', { type: 'button', title: t('actionsOpen'), 'aria-label': t('actionsTitle'), onClick: () => open(openActions) },
      h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true, focusable: false },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), h('path', { d: 'M15 4v16M7 8h4M7 12h4' }))),
    openPrompts ? h('button', { type: 'button', title: t('promptsOpen'), 'aria-label': t('promptsTitle'), onClick: () => open(openPrompts) },
      h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('path', { d: 'M4 4h16v12H9l-5 4V4M8 8h8M8 12h5' }))) : null,
    error ? h('span', { role: 'alert' }, `${t('actionsOpenFailed')}: ${error}`) : null)
}

/** Header and page controls stay reachable while details scroll. */
export function ContextCareActions({ sessionId, useCareActions, watchActions, refreshActions, revealSource, t }) {
  const [page, setPage] = useState({ sessionId, offset: 0 })
  const offset = page.sessionId === sessionId ? page.offset : 0
  useEffect(() => watchActions(sessionId, offset), [sessionId, offset, watchActions])
  const value = useCareActions(table => table.get(`${sessionId}:${offset}`))
  const ready = value?.status === 'ready'
  return h('section', { 'data-context-care-actions': '', 'data-care-panel': '', 'aria-label': t('actionsTitle') }, h(CareStyles),
    h('header', null, h('h3', null, t('actionsTitle')), h('button', { type: 'button', onClick: () => refreshActions(sessionId, offset) }, t('actionsRefresh'))),
    h('main', null, h(ActionDetails, { key: `${sessionId}:${offset}`, value, t, revealSource })),
    h('footer', null, h('span', { className: 'care-muted', role: 'status' }, `${t('actionsPage')} ${Math.floor(offset / 20) + 1}${ready && Number.isFinite(value.total) ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ''}`),
      h('div', null, h('button', { type: 'button', disabled: offset === 0, onClick: () => setPage({ sessionId, offset: Math.max(0, offset - 20) }) }, t('actionsPrevious')),
        h('button', { type: 'button', disabled: !ready || value.nextOffset == null, onClick: () => setPage({ sessionId, offset: value.nextOffset }) }, t('actionsNext')))))
}
