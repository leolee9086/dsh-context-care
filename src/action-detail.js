import React from 'react'
import { h, number, label, badge, date, row, Section, Sources, JumpButton, RawRecord, useDetailHeading } from './care-ui.js'
const ReactFragment = React.Fragment
export const actionSources = action => action.shadowedSeqs ?? action.sourceSeqs ?? []
export const change = action => `${number(action.beforeInput)} → ${number(action.afterInput)}`
export function phaseTone(action) {
  if (action.phase === 'failed') return 'error'
  if (action.outcome === 'partial' || action.phase === 'commit-record-failed') return 'warning'
  if (['committed', 'completed'].includes(action.phase)) return 'success'
  return 'working'
}

/** Complete input prices and fixed shadow estimates are kept in separate groups. */
export function ActionRecord({ action, t, revealSource, onBack }) {
  const heading = useDetailHeading()
  const priced = Number.isFinite(action.beforeInput) && Number.isFinite(action.afterInput)
  const saving = priced ? action.beforeInput - action.afterInput : null
  const sources = actionSources(action)
  const leaves = action.coverage?.leafSeqs ?? []
  const bounds = leaves.reduce(([low, high], seq) => [Math.min(low, seq), Math.max(high, seq)], [Infinity, -Infinity])
  const coverageRange = leaves.length ? `${number(bounds[0])} … ${number(bounds[1])}` : '—'
  return h('article', { className: 'care-detail' }, onBack ? h('button', { type: 'button', className: 'care-back', onClick: onBack }, '← ', t('back')) : null,
    h('div', { className: 'care-detail-heading' }, h('div', { className: 'care-eyebrow' }, t('actionsHistory'), ' · ', date(action.at)),
      h('h3', { tabIndex: -1, ref: heading }, label(t, 'action', action.action)), h('div', { className: 'care-request-state' }, badge(label(t, 'phase', action.phase), phaseTone(action)),
        action.outcome ? h('span', null, label(t, 'outcome', action.outcome)) : null)),
    h('div', { className: 'care-result' }, h('div', { className: 'care-eyebrow' }, t('inputUnits')),
      priced ? h(ReactFragment, null, h('div', { className: 'care-change' }, h('div', null, h('span', null, t('before')), h('strong', null, number(action.beforeInput))),
        h('span', { className: 'care-change-arrow', 'aria-hidden': true }, '→'), h('div', null, h('span', null, t('after')), h('strong', null, number(action.afterInput)))),
        h('p', { className: 'care-saving' }, t(saving >= 0 ? 'saved' : 'increased'), ' ', number(Math.abs(saving)), ' ', t('tokens'),
          action.beforeInput > 0 ? ` · ${Math.round(Math.abs(saving) / action.beforeInput * 100)}%` : ''))
        : h('p', { className: 'care-muted' }, t('actionsMissingPrice'))),
    action.error || action.failure ? h('p', { role: 'alert' }, action.error ?? action.failure.message) : null,
    ...(action.secondaryFailures ?? []).map((failure, index) => h('p', { role: 'alert', key: index }, `${failure.phase}: ${failure.message}`)),
    h(Section, { title: t('actionsReason') }, h('p', null, action.reason ? label(t, 'reason', action.reason) : t('actionsReasonUnknown')),
      action.rule ? h('dl', { className: 'care-fields' }, row(t('actionsRule'), label(t, 'rule', action.rule))) : null),
    action.replacements?.length ? h(Section, { title: t('replacementFlow') }, h('ol', { className: 'care-timeline' }, ...action.replacements.map((replacement, index) => h('li', { key: index },
      h('div', null, `${number(replacement.oldStartSeq)} … ${number(replacement.oldEndSeq)}`, h('span', { className: 'care-muted' }, ' → ', t('action_checkpoint'), ` #${replacement.newSeq}`)),
      h(JumpButton, { seq: replacement.newSeq, t, revealSource }))))) : action.checkpointSeq !== undefined ? h(Section, { title: t('actionsCheckpoint') }, h('p', null, `#${action.checkpointSeq}`), h(JumpButton, { seq: action.checkpointSeq, t, revealSource })) : null,
    h(Section, { title: t('selectedSources') }, h(Sources, { sources, t, revealSource })),
    action.coverage ? h(Section, { title: t('coverageSources') }, h('div', { className: 'care-coverage-summary' },
      h('strong', null, number(leaves.length), ' ', t('coverageCount')), h('span', null, t('actionsDepth'), ' ', number(action.coverage.depth)), h('span', { className: 'care-muted' }, t('range'), ' ', coverageRange)),
      h(Sources, { sources: leaves, t, revealSource })) : null,
    (action.commits ?? []).length ? h(Section, { title: t('summaryWork') }, ...action.commits.map((commit, index) => h('div', { className: 'care-evidence', key: index },
      commit.route ? h('p', { className: 'care-route' }, `${commit.route.provider} / ${commit.route.model}`) : null,
      h('dl', { className: 'care-fields' }, commit.usage ? row(t('actionsSummaryUsage'), `${number(commit.usage.inputTokens)} / ${number(commit.usage.outputTokens)} ${t('tokens')}`) : null,
        Number.isFinite(commit.shadowedTokenCount) ? row(t('actionsShadowPrice'), `${number(commit.shadowedTokenCount)} ${t('tokens')}`) : null)))) : null,
    Number.isFinite(action.routeSaving) || Number.isFinite(action.heuristicSaving) ? h(Section, { title: t('actionsSavings') }, h('dl', { className: 'care-fields' },
      row(t('routeSaving'), number(action.routeSaving)), row(t('fixedSaving'), number(action.heuristicSaving)))) : null,
    action.comparisons?.length ? h(Section, { title: t('actionsCandidates') }, ...action.comparisons.map((candidate, index) => h('div', { className: 'care-evidence', key: index }, `${candidate.start} … ${candidate.end}`, h('p', null, label(t, 'rule', candidate.rule), ' · ', number(candidate.expectedSaving), ' ', t('tokens'))))) : null,
    h(Section, { title: t('audit') }, h('p', { className: 'care-muted' }, t(action.auditStatus === 'session-only' ? 'actionsSessionOnly' : action.auditStatus === 'partial' ? 'actionsPartial' : action.journalPersisted ? 'actionsPersisted' : 'actionsRecovered'))),
    h(RawRecord, { value: action, t }))
}
