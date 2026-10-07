import React, { useEffect, useState } from 'react'

const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—'
const row = (label, value) => React.createElement('div', { key: label }, `${label}: ${value}`)

/** Pure display of admission and immutable maintenance facts; no request contents. */
export function ActionDetails({ value, t }) {
  if (value?.status !== 'ready') return React.createElement('div', { role: value?.status === 'error' ? 'alert' : 'status' },
    t(value?.status === 'error' ? 'actionsUnavailable' : 'actionsLoading'),
    value?.error ? React.createElement('div', null, `${t('actionsError')}: ${value.error}`) : null)
  const budget = value.admission?.budget
  return React.createElement('div', { style: { maxHeight: '50vh', overflow: 'auto', padding: '6px 0', overflowWrap: 'anywhere' } },
    budget ? React.createElement('div', null,
      row(t('actionsAdmission'), `${value.admission.route.provider} / ${value.admission.route.model}`),
      row(t('actionsInput'), number(budget.inputTokens)),
      value.admission.pricing ? row(t('actionsBasis'), `${value.admission.pricing.kind ?? '—'} · ${t('actionsTextScale')}: ${value.admission.pricing.textScale ?? '—'} · ${t('actionsSample')}: ${number(value.admission.pricing.sampleSeq)}`) : null,
      value.admission.rawInput ? row(t('actionsRawPrices'), `${number(value.admission.rawInput.textTokens)} / ${number(value.admission.rawInput.visualTokens)}`) : null,
      row(t('actionsCapacity'), `${number(budget.physicalCapacity)} / ${number(budget.policyCapacity)}`),
      row(t('actionsLimits'), `${number(budget.softInput)} / ${number(budget.hardInput)} / ${number(budget.releaseTarget)}`),
      row(t('actionsRetention'), `${number(budget.retainTail)} / ${number(budget.completionTokens)}`),
      row(t('actionsDispatch'), t(value.admission.dispatched ? 'actionsSent' : 'actionsNotSent')),
    ) : React.createElement('div', null, t('actionsNoAdmission')),
    ...value.actions.map(action => React.createElement('details', { key: action.id, style: { borderTop: '1px solid var(--dsw-alias-border-primary)', padding: '5px 0' } },
      React.createElement('summary', null, `${t(`action_${action.action}`)} · ${t(`phase_${action.phase}`)}${action.outcome ? ` · ${t(`outcome_${action.outcome}`)}` : ''}`),
      row(t('actionsIdentity'), action.id),
      action.rule ? row(t('actionsRule'), t(`rule_${action.rule}`)) : null,
      row(t('actionsSources'), (action.shadowedSeqs ?? action.sourceSeqs ?? []).join(', ') || '—'),
      row(t('actionsPrice'), `${number(action.beforeInput)} → ${number(action.afterInput)}`),
      row(t('actionsSavings'), `${number(action.routeSaving ?? (action.beforeInput === undefined || action.afterInput === undefined ? undefined : action.beforeInput - action.afterInput))} / ${number(action.heuristicSaving)}`),
      ...(action.replacements ?? []).map((replacement, index) => row(`${t('actionsReplacement')} ${index + 1}`, `${replacement.oldStartSeq} … ${replacement.oldEndSeq} → ${replacement.newSeq}`)),
      action.checkpointSeq !== undefined ? row(t('actionsCheckpoint'), number(action.checkpointSeq)) : null,
      action.coverage ? row(t('actionsCoverage'), `${action.coverage.leafSeqs.join(', ')} · ${t('actionsDepth')}: ${action.coverage.depth}`) : null,
      action.comparisons ? row(t('actionsCandidates'), action.comparisons.map(candidate => `${candidate.start} … ${candidate.end}: ${t(`rule_${candidate.rule}`)}, ${number(candidate.expectedSaving)}`).join('; ')) : null,
      action.error || action.failure ? row(t('actionsError'), action.error ?? action.failure.message) : null,
      ...(action.secondaryFailures ?? []).map((failure, index) => row(`${t('actionsError')} ${index + 1}`, `${failure.phase}: ${failure.message}`)),
      row(t('actionsJournal'), t(action.journalPersisted ? 'actionsPersisted' : 'actionsRecovered')),
    )),
    value.actions.length ? null : React.createElement('div', null, t('actionsEmpty')),
  )
}

/** Framework hooks deliver reactive facts; local state owns only paging. */
export function ContextCareActions({ sessionId, useCareActions, watchActions, t }) {
  const [page, setPage] = useState({ sessionId, offset: 0 })
  const offset = page.sessionId === sessionId ? page.offset : 0
  useEffect(() => watchActions(sessionId, offset), [sessionId, offset, watchActions])
  const value = useCareActions(table => table.get(`${sessionId}:${offset}`))
  return React.createElement('details', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
    React.createElement('summary', null, t('actionsTitle')),
    React.createElement(ActionDetails, { value, t }),
    React.createElement('div', { style: { display: 'flex', gap: '8px', padding: '4px 0' } },
      React.createElement('button', { type: 'button', disabled: offset === 0, onClick: () => setPage({ sessionId, offset: Math.max(0, offset - 20) }) }, t('actionsPrevious')),
      React.createElement('button', { type: 'button', disabled: value?.nextOffset == null, onClick: () => setPage({ sessionId, offset: value.nextOffset }) }, t('actionsNext')),
    ),
  )
}
