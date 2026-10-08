import React, { useEffect, useState } from 'react'
import { CareStyles } from './care-styles.js'
import { h, date, useRecordSelection } from './care-ui.js'
import { PromptRecord, promptTitle } from './prompt-detail.js'

/** One readable record at a time; a source selection opens its detail directly. */
export function PromptDetails({ value, t, selectedSeq, revealSource }) {
  const { selected, select, recordRef } = useRecordSelection(value?.prompts?.find(prompt => selectedSeq !== undefined && prompt.seq === selectedSeq)?.id ?? null)
  if (value?.status !== 'ready') return h('p', { className: 'care-empty', role: value?.status === 'error' ? 'alert' : 'status' }, value?.error ?? t('actionsLoading'))
  const prompt = value.prompts.find(item => item.id === selected)
  if (prompt) return h(PromptRecord, { key: prompt.id, prompt, t, revealSource, onBack: () => select(null) })
  return h(React.Fragment, null, h('p', { className: 'care-intro' }, t('promptsExplanation')),
    value.selectedFound === false ? h('p', { role: 'alert' }, t('promptsNotFound')) : null,
    h('div', { className: 'care-section-heading' }, h('h4', null, t('pageScope')), h('span', { className: 'care-muted' }, value.prompts.length, ' ', t('recordCount'))),
    value.prompts.length ? h('ul', { className: 'care-record-list' }, ...value.prompts.map(item => h('li', { key: item.id }, h('button', {
      type: 'button', ref: recordRef(item.id), className: 'care-record', onClick: () => select(item.id), 'aria-label': `${promptTitle(item, t)} · ${date(item.at)}`,
    }, h('span', { className: 'care-record-top' }, h('strong', null, promptTitle(item, t)), h('time', null, date(item.at))),
    h('span', { className: 'care-record-preview' }, item.text?.replace(/\s+/g, ' ').slice(0, 100)),
    h('span', { className: 'care-record-bottom' }, h('span', null, t(`prompt_${item.kind}`)), h('span', null, t('promptPreview'), ' →'))))))
      : h('p', { className: 'care-empty' }, t('promptsEmpty')))
}

/** Paged records retain a source selection across refresh and reset it on session changes. */
export function ContextCarePrompts({ sessionId, useCarePrompts, useCarePromptSelection, watchPrompts, refreshPrompts, revealSource, t }) {
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
    h('main', null, ready ? h(PromptDetails, { key: `${sessionId}:${actualOffset}:${seq}`, value, t, selectedSeq: seq, revealSource })
      : h('p', { className: 'care-empty', role: value?.status === 'error' ? 'alert' : 'status' }, value?.error ?? t('actionsLoading'))),
    h('footer', null, h('span', { role: 'status' }, `${t('actionsPage')} ${Math.floor(actualOffset / 20) + 1}${ready ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ''}`),
      h('div', null, h('button', { type: 'button', disabled: actualOffset === 0, onClick: () => navigate(Math.max(0, actualOffset - 20)) }, t('actionsPrevious')),
        h('button', { type: 'button', disabled: !ready || value.nextOffset == null, onClick: () => navigate(value.nextOffset) }, t('actionsNext')))))
}
