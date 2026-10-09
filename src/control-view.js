import React, { useEffect, useState } from 'react'
import { CareStyles } from './care-styles.js'
import { h } from './care-ui.js'
import { RuleRuntimePanel } from './rule-runtime-view.js'

/** Render acknowledged state, explicit source attribution and independent action preferences. */
export function ControlPanel({ value, sessionId, changeControls, refreshControls, t }) {
  const [search, setSearch] = useState('')
  const title = rule => { const key = rule.title ?? rule.id; return t(key) === key ? key : t(key) }
  const translated = (key, raw) => t(key) === key ? raw : t(key)
  const busy = value?.saving || value?.status !== 'ready'
  const matches = (value?.sources ?? []).flatMap(source => source.rules.map(rule => ({ source, rule })))
    .filter(({ source, rule }) => [title(rule), rule.id, source.plugin, source.sourceId, source.registration, source.executor]
      .some(text => String(text ?? '').toLocaleLowerCase().includes(search.toLocaleLowerCase())))
  const change = (source, rule, patch) => changeControls(sessionId, { sourceId: source.sourceId, ruleId: rule.id, ...patch })
  return h('div', { 'data-care-panel': '', 'data-care-controls': '' }, h(CareStyles),
    h('header', null, h('h3', null, t('controlsTitle')), h('button', { type: 'button', disabled: value?.saving,
      onClick: () => refreshControls(sessionId) }, t('controlsRefresh'))),
    h('main', null, h('p', { className: 'care-intro' }, t('controlsIntro')),
      h('div', { className: 'care-sources' }, h('input', { type: 'search', 'aria-label': t('controlsSearch'), value: search,
        onChange: event => setSearch(event.target.value), placeholder: t('controlsSearch') })),
      value?.error || value?.storageError ? h('p', { role: 'alert' }, `${t('controlsUnavailable')}: ${value.error ?? t(`control_reason-${value.storageError}`)}`) : null,
      !value || value.status === 'loading' ? h('p', { role: 'status' }, t('controlsLoading')) : null,
      value?.saving ? h('p', { role: 'status' }, t('controlsSaving')) : value?.status === 'ready' && value?.saved && !value?.error ? h('p', { role: 'status' }, t('controlsSaved')) : null,
      value?.sources && matches.length === 0 ? h('p', null, t('controlsEmpty')) : null,
      h('ul', { className: 'care-record-list' }, ...matches.map(({ source, rule }) => h('li', { key: JSON.stringify([source.sourceId, rule.id]), className: 'care-control-rule' },
        h('h4', null, title(rule)), rule.description ? h('p', { className: 'care-muted' }, t(rule.description)) : null,
        h('dl', { className: 'care-fields' },
          h('dt', null, t('controlsRegistrant')), h('dd', null, source.plugin ?? t('controlsUndeclared')),
          h('dt', null, t('controlsRegistration')), h('dd', null, source.registration),
          h('dt', null, t('controlsExecutor')), h('dd', null, source.executor)),
        h('label', { className: 'care-control-line' }, h('input', { type: 'checkbox', checked: rule.paused, disabled: busy,
          onChange: event => change(source, rule, { paused: event.target.checked }) }), t('controlsPause')),
        ...rule.actions.map(action => h('div', { className: 'care-control-line', key: action.id },
          h('label', null, h('input', { type: 'checkbox', checked: action.selected, disabled: busy,
            onChange: event => change(source, rule, { actionId: action.id, enabled: event.target.checked }) }),
          translated(`control_${action.title ?? action.id}`, action.title ?? action.id)),
          h('span', { className: 'care-muted', role: 'status' }, translated(`control_reason-${action.reason}`, action.reason)))),
        h('details', null, h('summary', null, t('controlsSource')), h('p', { className: 'care-muted' }, `${source.sourceId} / ${rule.id}`)),
        h('button', { type: 'button', disabled: busy, onClick: () => change(source, rule, { reset: true }) }, t('controlsReset')))))))
}

/** Framework supplies its own observable hook and session identity. */
export function ContextCareControls({ useCareControls, watchControls, changeControls, refreshControls, sessionId, t, fetcher }) {
  const value = useCareControls(table => table.get(sessionId))
  useEffect(() => watchControls(sessionId), [sessionId, watchControls])
  return h(SessionRuleManager, { key: sessionId, value, sessionId, changeControls, refreshControls, t, fetcher })
}

function SessionRuleManager(props) {
  const [mode, setMode] = useState('rules')
  const { sessionId, t, fetcher } = props
  return h('div', { 'data-care-manager': '', 'data-care-panel': '' }, h(CareStyles),
    h('nav', { 'aria-label': t('runtimeNavigation') }, ...['rules', 'declarations', 'runs', 'preview'].map(view =>
      h('button', { key: view, type: 'button', 'aria-pressed': mode === view, onClick: () => setMode(view) }, t(`runtime_${view}`)))),
    mode === 'rules' ? h(ControlPanel, props) : h(RuleRuntimePanel, { key: `${sessionId}:${mode}`, sessionId, mode, t, fetcher }))
}

/** A direct opener keeps the controls discoverable from the conversation composer. */
export function ContextCareControlsOpener({ openControls, sessionId, t }) {
  return h('div', { 'data-care-entry': '' }, h(CareStyles), h('button', { type: 'button', title: t('controlsOpen'),
    'aria-label': t('controlsOpen'), onClick: () => openControls(sessionId) },
  h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
    h('path', { d: 'M4 6h16M4 12h16M4 18h16' }), h('circle', { cx: 8, cy: 6, r: 2 }),
    h('circle', { cx: 16, cy: 12, r: 2 }), h('circle', { cx: 10, cy: 18, r: 2 }))))
}
