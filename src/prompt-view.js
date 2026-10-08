import React, { useEffect, useState } from 'react'
import { CareStyles } from './care-styles.js'
import { noticeLabel } from './notice-view.js'
const h = React.createElement
const raw = value => h('pre', { className: 'care-prompt-text' }, JSON.stringify(value, null, 2))

/** Full injected text and its durable references, including request-only prompts. */
export function PromptDetails({ value, t, selectedSeq }) {
  if (value?.status !== 'ready') return h('p', { className: 'care-empty', role: value?.status === 'error' ? 'alert' : 'status' }, value?.error ?? t('actionsLoading'))
  return h(React.Fragment, null,
    h('p', { className: 'care-muted' }, t('promptsExplanation')),
    value.selectedFound === false ? h('p', { role: 'alert' }, t('promptsNotFound')) : null,
    value.prompts.length ? value.prompts.map(prompt => h('details', { className: 'care-action', key: prompt.id, open: prompt.seq === selectedSeq || undefined },
      h('summary', null, h('span', { className: 'care-chevron' }, '›'), h('span', null,
        h('span', { className: 'care-action-title' }, noticeLabel(prompt.producer, t), prompt.seq === undefined ? '' : ` · #${prompt.seq}`),
        h('span', { className: 'care-action-change' }, prompt.title || t(`prompt_${prompt.kind}`)))),
      h('div', { className: 'care-prompt-detail' },
        prompt.bodyStatus === 'segments-only' ? h('p', { className: 'care-muted' }, t('promptsSegmentsOnly')) : null,
        h('pre', { className: 'care-prompt-text' }, prompt.text),
        h('dl', null, h('dt', null, t('promptsSource')), h('dd', null, prompt.producer),
          h('dt', null, t('promptsTime')), h('dd', null, Number.isFinite(prompt.at) ? new Date(prompt.at).toLocaleString() : t('promptsNotRecorded')),
          h('dt', null, t('promptsIdentity')), h('dd', null, prompt.id)),
        prompt.source?.contextCareTrace ? h('section', null, h('h4', null, t('promptsTrigger')), raw(prompt.source.contextCareTrace)) : null,
        prompt.kind === 'message' && !prompt.source?.contextCareTrace ? h('p', { className: 'care-muted' }, t('promptsLegacyTrace')) : null,
        prompt.evaluations?.length ? h('section', null, h('h4', null, t('promptsEvaluations')), raw(prompt.evaluations)) : null,
        ...(prompt.segments ?? []).map((segment, index) => h('section', { key: index }, h('h4', null, `${t('promptsSegment')} ${index + 1} · ${segment.ruleId}`), raw(segment))),
        h('section', null, h('h4', null, t('promptsCalls')), prompt.calls.length ? raw(prompt.calls) : h('p', { className: 'care-muted' }, t('promptsNoCalls'))),
        h('section', null, h('h4', null, t('promptsSources')), prompt.sources.length ? prompt.sources.map(source => h('details', { key: source.seq },
          h('summary', null, `#${source.seq} · ${source.type}${source.truncated ? ` · ${t('promptsExcerpt')}` : ''}`),
          h('pre', { className: 'care-prompt-text' }, source.excerpt || t('promptsNotRecorded')))) : h('p', { className: 'care-muted' }, t('promptsNoSources'))))))
      : h('p', { className: 'care-empty' }, t('promptsEmpty')))
}

/** A separate paged prompt collection retains event selection across refresh and clears it on session change. */
export function ContextCarePrompts({ sessionId, useCarePrompts, useCarePromptSelection, watchPrompts, refreshPrompts, t }) {
  // Each open action owns a fresh selection object, so reopening the same event relocates after manual paging.
  const selection = useCarePromptSelection(map => map.get(sessionId))
  const selectedSeq = selection?.seq
  const [page, setPage] = useState({ sessionId, selection, offset: 0, locate: true })
  const same = page.sessionId === sessionId && page.selection === selection
  const offset = same ? page.offset : 0
  const seq = (!same || page.locate) ? selectedSeq : undefined
  useEffect(() => watchPrompts(sessionId, offset, seq), [sessionId, offset, seq, watchPrompts])
  const value = useCarePrompts(map => map.get(`${sessionId}:${offset}${seq === undefined ? '' : `:${seq}`}`))
  const actualOffset = value?.offset ?? offset
  const ready = value?.status === 'ready'
  const navigate = next => setPage({ sessionId, selection, offset: next, locate: false })
  return h('section', { 'data-care-panel': '', 'aria-label': t('promptsTitle') }, h(CareStyles),
    h('header', null, h('h3', null, t('promptsTitle')), h('button', { type: 'button', onClick: () => refreshPrompts(sessionId, offset, seq) }, t('actionsRefresh'))),
    h('main', { key: `${sessionId}:${actualOffset}:${selectedSeq}` }, h(PromptDetails, { value, t, selectedSeq })),
    h('footer', null, h('span', { role: 'status' }, `${t('actionsPage')} ${Math.floor(actualOffset / 20) + 1}${ready ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ''}`),
      h('div', null, h('button', { type: 'button', disabled: actualOffset === 0, onClick: () => navigate(Math.max(0, actualOffset - 20)) }, t('actionsPrevious')),
        h('button', { type: 'button', disabled: !ready || value.nextOffset == null, onClick: () => navigate(value.nextOffset) }, t('actionsNext')))))
}
