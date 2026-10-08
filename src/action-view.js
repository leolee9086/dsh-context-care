import React, { useEffect, useState } from 'react'
import { CareStyles } from './care-styles.js'

const h = React.createElement
const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—'
const ratio = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'
const row = (label, value, raw) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', raw ? { title: String(raw) } : null, value))
const change = action => `${number(action.beforeInput)} → ${number(action.afterInput)}`
const badge = (label, tone) => h('span', { className: 'care-badge', 'data-tone': tone }, label)
const date = at => Number.isFinite(at) ? new Date(at).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : null
function phaseTone(action) {
  if (action.phase === 'failed') return 'error'
  if (action.outcome === 'partial' || action.phase === 'commit-record-failed') return 'warning'
  if (['committed', 'completed'].includes(action.phase)) return 'success'
  return ['started', 'planning', 'prepared', 'repaired'].includes(action.phase) ? 'working' : undefined
}

function Budget({ admission, t }) {
  const budget = admission?.budget
  if (!budget) return h('p', { className: 'care-empty' }, t('actionsNoAdmission'))
  const limit = budget.hardInput
  const percent = Number.isFinite(budget.inputTokens) && Number.isFinite(limit) && limit > 0 ? budget.inputTokens / limit * 100 : null
  return h(React.Fragment, null,
    h('section', { className: 'care-budget', 'aria-label': t('actionsBudget') },
      h('div', { className: 'care-budget-heading' }, h('h4', null, t('actionsBudget')),
        badge(t(admission.dispatched ? 'actionsSent' : 'actionsNotSent'), admission.dispatched ? 'success' : undefined)),
      h('div', { className: 'care-figures' }, h('strong', null, number(budget.inputTokens)), h('span', { className: 'care-muted' }, `/ ${number(limit)} tok`)),
      h('div', { className: 'care-muted' }, `${t('actionsUsage')}${percent === null ? '—' : `${Math.round(percent)}%`}`),
      percent === null ? null : h('div', { className: 'care-meter', role: 'meter', 'aria-label': t('actionsUsage'), 'aria-valuemin': 0, 'aria-valuemax': 100,
        'aria-valuenow': Math.min(100, Math.round(percent)), 'aria-valuetext': `${Math.round(percent)}%`, 'data-over-limit': percent > 100 ? '' : undefined,
        style: { '--care-fill': `${Math.min(100, Math.max(0, percent))}%` } }, h('span')),
      h('dl', null, row(t('actionsSoftLimit'), number(budget.softInput)), row(t('actionsReleaseTarget'), number(budget.releaseTarget))),
      h('div', { className: 'care-route' }, admission.route ? `${admission.route.provider} / ${admission.route.model}` : '—')),
    h('details', { className: 'care-technical' }, h('summary', null, t('actionsTechnical')),
      h('dl', null,
        row(t('actionsCapacity'), `${number(budget.physicalCapacity)} / ${number(budget.policyCapacity)}`),
        row(t('actionsRetention'), `${number(budget.retainTail)} / ${number(budget.completionTokens)}`),
        admission.pricing ? row(t('actionsBasis'), admission.pricing.kind ?? '—') : null,
        admission.pricing ? row(t('actionsTextScale'), ratio(admission.pricing.textScale), admission.pricing.textScale) : null,
        admission.pricing ? row(t('actionsSample'), number(admission.pricing.sampleSeq)) : null,
        admission.rawInput ? row(t('actionsRawPrices'), `${number(admission.rawInput.textTokens)} / ${number(admission.rawInput.visualTokens)}`) : null)))
}

function Action({ action, t }) {
  const at = date(action.at)
  return h('details', { className: 'care-action' },
    h('summary', null,
      h('svg', { className: 'care-chevron', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, h('path', { d: 'm6 3 5 5-5 5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 })),
      h('span', null,
        h('span', { className: 'care-action-title' }, t(`action_${action.action}`), badge(t(`phase_${action.phase}`), phaseTone(action)),
          at ? h('time', { className: 'care-action-time', dateTime: new Date(action.at).toISOString(), title: new Date(action.at).toLocaleString() }, at) : null),
        h('span', { className: 'care-action-change' }, `${change(action)} tok`, action.outcome ? ` · ${t(`outcome_${action.outcome}`)}` : ''))),
    h('dl', null,
      row(t('actionsIdentity'), action.id),
      action.rule ? row(t('actionsRule'), t(`rule_${action.rule}`)) : null,
      row(t('actionsSources'), (action.shadowedSeqs ?? action.sourceSeqs ?? []).join(', ') || '—'),
      row(t('actionsPrice'), change(action)),
      row(t('actionsSavings'), `${number(action.routeSaving ?? (Number.isFinite(action.beforeInput) && Number.isFinite(action.afterInput) ? action.beforeInput - action.afterInput : undefined))} / ${number(action.heuristicSaving)}`),
      ...(action.replacements ?? []).map((replacement, index) => row(`${t('actionsReplacement')} ${index + 1}`, `${replacement.oldStartSeq} … ${replacement.oldEndSeq} → ${replacement.newSeq}`)),
      action.checkpointSeq !== undefined ? row(t('actionsCheckpoint'), number(action.checkpointSeq)) : null,
      action.coverage ? row(t('actionsCoverage'), `${action.coverage.leafSeqs.join(', ')} · ${t('actionsDepth')}: ${action.coverage.depth}`) : null,
      action.comparisons ? row(t('actionsCandidates'), action.comparisons.map(candidate => `${candidate.start} … ${candidate.end}: ${t(`rule_${candidate.rule}`)}, ${number(candidate.expectedSaving)}`).join('; ')) : null,
      action.error || action.failure ? row(t('actionsError'), h('span', { role: 'alert' }, action.error ?? action.failure.message)) : null,
      ...(action.secondaryFailures ?? []).map((failure, index) => row(`${t('actionsError')} ${index + 1}`, `${failure.phase}: ${failure.message}`)),
      row(t('actionsJournal'), t(action.journalPersisted ? 'actionsPersisted' : 'actionsRecovered'))))
}

/** Request and maintenance facts remain available behind readable summaries. */
export function ActionDetails({ value, t }) {
  if (value?.status !== 'ready') return h('div', { role: value?.status === 'error' ? 'alert' : 'status', className: 'care-empty' },
    t(value?.status === 'error' ? 'actionsUnavailable' : 'actionsLoading'),
    value?.error ? h('div', null, `${t('actionsError')}: ${value.error}`) : null)
  return h(React.Fragment, null,
    h(Budget, { admission: value.admission, t }),
    h('div', { className: 'care-section-heading' }, h('h4', null, t('actionsHistory')), h('span', { className: 'care-muted' }, `${value.total ?? value.actions.length}`)),
    value.actions.length ? value.actions.map(action => h(Action, { key: action.id, action, t })) : h('p', { className: 'care-empty' }, t('actionsEmpty')))
}

/** An operation belongs in the composer toolbar, independently of status. */
export function ContextCareActionsOpener({ sessionId, openActions, t }) {
  const [error, setError] = useState(null)
  return h('div', { 'data-care-entry': '' }, h(CareStyles),
    h('button', { type: 'button', title: t('actionsOpen'), 'aria-label': t('actionsTitle'),
      onClick: () => { try { openActions(sessionId); setError(null) } catch (failure) { setError(String(failure)) } } },
      h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true, focusable: false },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), h('path', { d: 'M15 4v16M7 8h4M7 12h4' }))),
    error ? h('span', { role: 'alert' }, `${t('actionsOpenFailed')}: ${error}`) : null)
}

/** Only the body scrolls; paging and refresh remain reachable in a narrow pane. */
export function ContextCareActions({ sessionId, useCareActions, watchActions, refreshActions, t }) {
  const [page, setPage] = useState({ sessionId, offset: 0 })
  const offset = page.sessionId === sessionId ? page.offset : 0
  useEffect(() => watchActions(sessionId, offset), [sessionId, offset, watchActions])
  const value = useCareActions(table => table.get(`${sessionId}:${offset}`))
  const ready = value?.status === 'ready'
  return h('section', { 'data-context-care-actions': '', 'data-care-panel': '', 'aria-label': t('actionsTitle') }, h(CareStyles),
    h('header', null, h('h3', null, t('actionsTitle')), h('button', { type: 'button', onClick: () => refreshActions(sessionId, offset) }, t('actionsRefresh'))),
    h('main', { key: `${sessionId}:${offset}` }, h(ActionDetails, { value, t })),
    h('footer', null,
      h('span', { className: 'care-muted', role: 'status' }, `${t('actionsPage')} ${Math.floor(offset / 20) + 1}${ready && Number.isFinite(value.total) ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ''}`),
      h('div', null,
        h('button', { type: 'button', disabled: offset === 0, onClick: () => setPage({ sessionId, offset: Math.max(0, offset - 20) }) }, t('actionsPrevious')),
        h('button', { type: 'button', disabled: !ready || value.nextOffset == null, onClick: () => setPage({ sessionId, offset: value.nextOffset }) }, t('actionsNext')))))
}
