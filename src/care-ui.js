import React, { useEffect, useRef, useState } from 'react'
export const h = React.createElement
export const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—'
export const date = at => Number.isFinite(at) ? new Date(at).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
export const label = (t, prefix, value) => {
  if (value == null) return '—'
  const key = `${prefix}_${value}`
  const translated = t(key)
  return translated && translated !== key ? translated : String(value)
}
export const badge = (text, tone) => h('span', { className: 'care-badge', 'data-tone': tone }, text)
export const row = (name, value) => h(React.Fragment, { key: name }, h('dt', null, name), h('dd', null, value))
/** Detail focus and return focus follow record navigation without touching host UI. */
export function useRecordSelection(initial = null) {
  const [selected, setSelected] = useState(initial)
  const previous = useRef(initial)
  const buttons = useRef(new Map())
  useEffect(() => { if (selected === null && previous.current != null) buttons.current.get(previous.current)?.focus() }, [selected])
  return { selected, select(id) { if (id !== null) previous.current = id; setSelected(id) },
    recordRef: id => element => { if (element) buttons.current.set(id, element); else buttons.current.delete(id) } }
}
export function useDetailHeading() {
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
  return ref
}
export function Section({ title, children, extra }) { return h('section', { className: 'care-section' }, h('div', { className: 'care-section-heading' }, h('h4', null, title), extra), children) }

/** Original JSON is opt-in and mounted only while reading it. */
export function RawRecord({ value, t }) {
  const [open, setOpen] = useState(false)
  return h('div', { className: 'care-raw' }, h('button', { type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open) }, t('rawRecord'), open ? ' −' : ' +'),
    open ? h('pre', { className: 'care-code' }, JSON.stringify(value, null, 2)) : null)
}

/** The saved body remains exact; the reading viewport, not the string, is bounded. */
export function TextReader({ text = '', t }) {
  const [full, setFull] = useState(false)
  const [copy, setCopy] = useState('')
  return h('div', { className: 'care-reader' }, h('pre', { className: 'care-prompt-text', 'data-full': full || undefined }, text),
    h('div', { className: 'care-reader-tools' }, text.length > 600 ? h('button', { type: 'button', 'aria-expanded': full, onClick: () => setFull(!full) }, t(full ? 'collapseText' : 'fullText')) : null,
      h('button', { type: 'button', onClick: async () => { try { await navigator.clipboard.writeText(text); setCopy('copied') } catch (error) { setCopy('copyFailed') } } }, t('copy')),
      copy ? h('span', { role: 'status' }, t(copy)) : null))
}

/** Translate only known recorded values; unknown/custom facts keep their exact text. */
export function evidenceValue(value, t) {
  if (typeof value === 'boolean') return t(value ? 'fieldYes' : 'fieldNo')
  const key = ({ 'completion-observation': 'promptCompletion', 'output-pattern': 'promptPattern', 'budget-state': 'triggerBudget',
    'completion': 'triggerCompletion', 'prepared': 'phase_prepared', 'dispatched': 'phase_dispatched', 'failed': 'phase_failed',
    'completed': 'phase_completed', 'static': 'triggerStatic', 'model-switch': 'triggerModelSwitch', 'conversation': 'purposeConversation', 'summary': 'summaryWork', 'measured': 'fieldMeasured', 'unavailable': 'fieldUnavailable', 'matched': 'decisionMatched', 'suppressed': 'decisionSuppressed' })[value]
  return key ? t(key) : String(value)
}

/** Fields retain custom evidence with bounded depth and item count; raw data stays available. */
export function Fields({ value, t, depth = 0 }) {
  if (value == null) return h('span', { className: 'care-muted' }, '—')
  if (typeof value !== 'object') return h('span', null, evidenceValue(value, t))
  if (depth >= 3) return h('span', { className: 'care-muted' }, t('fieldMore'))
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  const names = { ruleId: 'ruleName', version: 'ruleVersion', trigger: 'trigger', metrics: 'metrics', sourceRoute: 'sourceRoute', producer: 'producer', fatigueValue: 'fatigue', wakefulnessValue: 'wakefulness', facts: 'evidence', purpose: 'fieldPurpose', provider: 'fieldProvider', model: 'fieldModel', phase: 'fieldPhase', decision: 'fieldDecision', repeats: 'fieldRepeats', matched: 'fieldMatched', reason: 'actionsReason', cooldown: 'fieldCooldown', completionCount: 'fieldCompletions', observationCount: 'fieldObservations', windowSize: 'fieldWindow', sourceCount: 'actionsSourceCount', threshold: 'fieldThreshold', score: 'fieldScore', total: 'fieldTotal', passed: 'fieldPassed', dispatched: 'fieldDispatched', observation: 'fieldObservation', request: 'fieldRequest', status: 'fieldStatus', detectorVersion: 'fieldDetectorVersion', locale: 'fieldLocale', N: 'metricN', K: 'metricK', H: 'metricH', F: 'metricF', J: 'metricJ', D: 'metricD', R: 'metricR', words: 'fieldWords', familyStatements: 'fieldFamilyStatements', evidence: 'evidence', exclusions: 'fieldExclusions', phraseId: 'fieldPhrase', family: 'fieldFamily', start: 'fieldStart', end: 'fieldEnd', text: 'fieldText', count: 'fieldCount', ratio: 'fieldRatio', severity: 'fieldSeverity' }
  return h(React.Fragment, null, h('dl', { className: 'care-fields' }, ...entries.slice(0, 12).map(([key, item]) => row(names[key] ? t(names[key]) : key,
    typeof item === 'string' && item.length > 300 ? h('span', null, item.slice(0, 300), '… ', t('fieldMore')) : h(Fields, { value: item, t, depth: depth + 1 })))),
    entries.length > 12 ? h('p', { className: 'care-muted' }, t('fieldMore')) : null)
}

/** Result callbacks cannot update an unmounted detail or an earlier click. */
export function JumpButton({ seq, revealSource, t }) {
  const [state, setState] = useState({ status: '', error: '' })
  const ticket = useRef(0)
  useEffect(() => () => { ticket.current++ }, [])
  if (!Number.isSafeInteger(seq) || !revealSource) return null
  return h('div', { className: 'care-jump' }, h('button', { type: 'button', disabled: state.status === 'jumping', onClick: async () => {
    const id = ++ticket.current
    setState({ status: 'jumping', error: '' })
    try { await revealSource(seq); if (ticket.current === id) setState({ status: 'jumped', error: '' }) }
    catch (error) { if (ticket.current === id) setState({ status: '', error: t(error.code) || String(error.message ?? error) }) }
  } }, t(state.status === 'jumping' ? 'jumping' : 'jump')),
  state.status === 'jumped' ? h('span', { role: 'status' }, t('jumped')) : null,
  state.error ? h('p', { role: 'alert' }, state.error) : null)
}

const sourceKind = type => ({ 'user/message': 'sourceUser', 'assistant/message': 'sourceAssistant', 'tool/result': 'sourceTool', 'request/header': 'sourceRequest', 'system/message': 'sourceSystem' })[type] ?? 'sourceUnknown'
/** Source arrays of any length render twenty rows at a time, with an explicit text search. */
export function Sources({ sources = [], t, revealSource }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selected, select] = useState(null)
  const records = sources.map(source => typeof source === 'number' ? { seq: source } : source)
  const filtered = query.trim() ? records.filter(source => `${source.seq} ${source.excerpt ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) : records
  const offset = Math.min(page * 20, Math.max(0, Math.floor((filtered.length - 1) / 20) * 20))
  return h('div', { className: 'care-sources' }, h('div', { className: 'care-source-heading' },
    h('span', null, number(records.length), ' ', t('actionsSourceCount')),
    h('button', { type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open) }, t('sourceList'), open ? ' −' : ' +')),
    open ? h('div', null,
      h('input', { type: 'search', value: query, placeholder: t('sourceSearch'), 'aria-label': t('sourceSearch'), onChange: event => { setQuery(event.target.value); setPage(0); select(null) } }),
      h('ol', { className: 'care-source-rows' }, ...filtered.slice(offset, offset + 20).map(source => h('li', { key: source.seq },
        h('div', { className: 'care-source-row' }, h('button', { type: 'button', className: 'care-source-name', 'aria-expanded': selected === source.seq,
          onClick: () => select(selected === source.seq ? null : source.seq) }, h('strong', null, t(sourceKind(source.type))), h('span', { className: 'care-muted' }, `#${source.seq}`)),
          h(JumpButton, { seq: source.seq, revealSource, t })),
        source.excerpt ? h('p', { className: 'care-source-preview' }, source.excerpt.slice(0, 120)) : null,
        selected === source.seq ? h('div', { className: 'care-source-excerpt' }, h('pre', { className: 'care-prompt-text', 'data-full': true }, source.excerpt || t('promptsNotRecorded')),
          source.truncated ? h('p', { className: 'care-muted' }, t('excerptLimit')) : null) : null))),
      filtered.length ? h('nav', { className: 'care-source-pager', 'aria-label': t('sourcePage') },
        h('button', { type: 'button', disabled: offset === 0, onClick: () => { setPage(page - 1); select(null) } }, t('sourcePrev')),
        h('span', null, `${Math.floor(offset / 20) + 1} / ${Math.ceil(filtered.length / 20)}`),
        h('button', { type: 'button', disabled: offset + 20 >= filtered.length, onClick: () => { setPage(page + 1); select(null) } }, t('sourceNext')))
        : h('p', { className: 'care-empty' }, t('sourceEmpty'))) : null)
}
