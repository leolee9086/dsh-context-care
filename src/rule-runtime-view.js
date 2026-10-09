import React, { useEffect, useRef, useState } from 'react'
import { h } from './care-ui.js'
import { CareStyles } from './care-styles.js'
import { RuntimeWire, PreviewWire } from './rule-runtime-wire.js'
import { httpFailure } from './http-failure.js'

const statuses = ['queued', 'waiting-approval', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'unknown']
const json = value => JSON.stringify(value, null, 2)
const text = value => h('pre', { className: 'care-prompt-text' }, value)
function JsonDetails({ label, value }) {
  const [open, setOpen] = useState(false)
  return h('details', { className: 'care-technical', onToggle: event => setOpen(event.currentTarget.open) },
    h('summary', null, label), open ? h('pre', { className: 'care-code' }, json(value)) : null)
}
const details = (label, value) => h(JsonDetails, { key: label, label, value })
const fields = values => h('dl', { className: 'care-fields' }, ...values.flatMap(([label, value]) => [h('dt', { key: `${label}:label` }, label), h('dd', { key: label }, value)]))

/** Session-bound inspection has no document authoring path. Mutation is limited to cancelling a run. */
export function RuleRuntimePanel({ sessionId, mode, t, fetcher = fetch, pollMs = 5000 }) {
  const [data, setData] = useState(); const [error, setError] = useState(''); const [operationError, setOperationError] = useState('')
  const [busy, setBusy] = useState(false); const [preview, setPreview] = useState(); const [ack, setAck] = useState('')
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0); const mutation = useRef(); const lifetime = useRef()
  const [loading, setLoading] = useState(true); const [previewStale, setPreviewStale] = useState(false)
  const translated = (key, raw) => t(key) === key ? raw : t(key)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    return () => { controller.abort(); mutation.current?.abort() }
  }, [sessionId, mode])
  const endpoint = `/context-care/rule-runtime?sessionId=${encodeURIComponent(sessionId)}`
  const bump = () => setRefresh(value => value + 1)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setData(undefined)
    let pending; let ticket = 0
    const read = async () => {
      if (pending || mutation.current || controller.signal.aborted) return
      const child = new AbortController(); pending = child; const current = ++ticket
      try {
        const response = await fetcher(`${endpoint}&limit=20&offset=${offset}&status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`, { signal: child.signal })
        if (!response.ok) throw await httpFailure(response, '/context-care/rule-runtime')
        const value = RuntimeWire.parse(await response.json())
        if (value.sessionId !== sessionId) throw new Error('rule-runtime-session-mismatch')
        if (!controller.signal.aborted && !child.signal.aborted && current === ticket) {
          setData(value); setError(''); setLoading(false)
          setPreview(previous => {
            if (previous && previous.snapshotId !== value.snapshotId) { setPreviewStale(true); return undefined }
            return previous
          })
        }
      } catch (failure) {
        if (!controller.signal.aborted && !child.signal.aborted && current === ticket) { setError(String(failure)); setLoading(false) }
      } finally { if (pending === child) pending = undefined }
    }
    // Visibility suspends only reads. A user-requested cancellation keeps its own lifetime.
    const visible = () => { if (document.hidden) { pending?.abort(); pending = undefined; ticket++ } else void read() }
    void read()
    const timer = setInterval(() => { if (!document.hidden) void read() }, pollMs)
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible)
    return () => { controller.abort(); pending?.abort(); ticket++; clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [sessionId, endpoint, offset, status, search, refresh, fetcher, pollMs])
  useEffect(() => { setPreview(undefined) }, [mode])
  const act = async (body, parse) => {
    if (mutation.current || !lifetime.current || loading || error) return
    const sessionOwner = lifetime.current; const controller = new AbortController()
    mutation.current = controller; setBusy(true); setOperationError(''); setAck('')
    try {
      const response = await fetcher(endpoint, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw await httpFailure(response, '/context-care/rule-runtime')
      const value = await response.json()
      if (!controller.signal.aborted && !sessionOwner.signal.aborted && lifetime.current === sessionOwner) {
        if (value.sessionId !== sessionId) throw new Error('rule-runtime-session-mismatch')
        parse(value); bump()
      }
    } catch (failure) { if (!controller.signal.aborted && !sessionOwner.signal.aborted && lifetime.current === sessionOwner) setOperationError(String(failure)) }
    finally { if (mutation.current === controller) mutation.current = undefined; if (!controller.signal.aborted && !sessionOwner.signal.aborted && lifetime.current === sessionOwner) setBusy(false) }
  }
  const docs = (data?.documents ?? []).filter(doc => !search || [doc.id, doc.title, doc.plugin, doc.registration, ...doc.rules.map(rule => rule.title), ...doc.entries.map(entry => entry.title)].some(value => value.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
  const section = (label, children) => h('section', { className: 'care-section' }, h('h4', null, label), children)
  const renderRule = rule => h('details', { key: rule.id, className: 'care-technical' }, h('summary', null, `${rule.title || rule.id} · v${rule.revision}`),
    fields([[t('runtimeStage'), rule.on.map(stage => t(`stage_${stage}`)).join(', ')]]), details(t('runtimeDefinition'), rule), details(t('runtimeSelection'), rule.select), details(t('runtimeMatch'), rule.match),
    ...rule.actions.map(action => h('section', { key: action.id, className: 'care-section' }, h('h4', null, `${t(`control_${action.kind}`)} · ${action.id}`),
      fields([[t('runtimeStage'), t(`stage_${action.stage}`)], [t('runtimeDepends'), action.dependsOn.join(', ') || t('runtimeNone')]]),
      action.template !== undefined ? text(action.template) : null, action.executorRef ? fields([[t('runtimeExecutorRef'), action.executorRef]]) : null,
      ...[['inputs', 'runtimeInputs'], ['target', 'runtimeTarget'], ['patch', 'runtimePatch']].filter(([key]) => action[key] !== undefined).map(([key, label]) => details(t(label), action[key])))))
  return h('div', { 'data-care-panel': '', 'data-care-runtime': mode }, h(CareStyles),
    h('header', null, h('h3', null, t(`runtime_${mode}`)), h('button', { type: 'button', disabled: busy, onClick: bump }, t('runtimeRefresh'))),
    h('main', null, h('p', { className: 'care-intro' }, t(mode === 'preview' ? 'runtimePreviewIntro' : 'runtimeReadOnly')),
      error ? h('p', { role: 'alert' }, error) : null, operationError ? h('p', { role: 'alert' }, operationError) : null,
      data?.storageError || data?.fileError ? h('p', { role: 'alert' }, `${data.storageError ?? ''} ${data.fileError ?? ''}`) : null,
      !data && !error ? h('p', { role: 'status' }, t('controlsLoading')) : null, ack ? h('p', { role: 'status' }, ack) : null,
      mode !== 'preview' ? h('div', { className: 'care-sources' }, h('input', { type: 'search', disabled: busy, 'aria-label': t('runtimeSearch'), value: search,
        onChange: event => { setSearch(event.target.value); setOffset(0) } })) : null,
      mode === 'declarations' ? h(React.Fragment, null,
        !docs.length && data ? h('p', null, t('runtimeNoDeclarations')) : null,
        ...docs.map(doc => h('article', { key: doc.id, className: 'care-control-rule' }, h('h4', null, `${doc.title || doc.id} · v${doc.revision}`),
          fields([[t('controlsRegistrant'), doc.plugin], [t('controlsRegistration'), doc.registration], [t('controlsSource'), doc.sourceId]]),
          section(t('runtimeRules'), doc.rules.map(renderRule)),
          section(t('runtimeEntries'), doc.entries.map(entry => h('details', { key: entry.id, className: 'care-technical' }, h('summary', null, `${entry.title || entry.id} · v${entry.revision}`), text(entry.template), details(t('runtimeDefinition'), entry), details(t('runtimeMatch'), entry.activation), details(t('runtimeSelection'), entry.select), details(t('runtimeTarget'), entry.target)))),
          section(t('runtimeVariables'), doc.variables.map(variable => h('article', { key: variable.name }, h('h4', null, `${variable.name} · ${t(`scope_${variable.scope}`)} · ${variable.type}`), h('p', null, variable.description), details(t('runtimeCurrentValue'), variable.value)))),
          section(t('runtimePartials'), doc.partials.map(partial => h('details', { key: partial.name, className: 'care-technical' }, h('summary', null, `${partial.name} · v${partial.revision}`), text(partial.template)))))),
        section(t('runtimeExecutors'), (data?.executors ?? []).map(executor => h('article', { key: executor.executorRef }, fields([[t('runtimeExecutorRef'), executor.executorRef], [t('controlsRegistrant'), executor.plugin], [t('runtimeTool'), executor.toolName]]), details(t('runtimeDefinition'), executor))))) : null,
      mode === 'runs' ? h(React.Fragment, null,
        h('label', { className: 'care-control-line' }, t('runtimeFilter'), h('select', { value: status, disabled: busy, onChange: event => { setStatus(event.target.value); setOffset(0) } },
          h('option', { value: '' }, t('runtimeAll')), ...statuses.map(value => h('option', { key: value, value }, `${t(`run_${value}`)} (${data?.counts[value] ?? 0})`)))),
        ...(data?.dispatches ?? []).map(held => h('article', { key: held.key, className: 'care-evidence' }, h('h4', null, t(`dispatch_${held.status}`)), h('p', null, held.reason ?? held.callId), details(t('runtimeEvidence'), held))),
        !data?.runs.length && data ? h('p', null, t('runtimeNoRuns')) : null,
        h('ul', { className: 'care-record-list' }, ...(data?.runs ?? []).map(run => h('li', { key: run.id, className: 'care-control-rule' },
          h('h4', null, `${run.ruleId} / ${run.actionId}`), h('p', { role: 'status' }, `${t(`run_${run.status}`)} · ${t(`delivery_${run.delivery}`)}`),
          h('p', null, run.reason ? translated(`run_reason-${run.reason}`, run.reason) : ''), fields([[t('controlsSource'), run.sourceId], [t('runtimeTime'), new Date(run.createdAt).toLocaleString()]]),
          details(t('runtimeInputs'), run.inputs), run.result !== undefined ? details(t('runtimeResult'), run.result) : null, details(t('runtimeEvidence'), { sourceSeqs: run.sourceSeqs, id: run.id }),
          ['queued', 'waiting-approval', 'running'].includes(run.status) ? h('button', { type: 'button', disabled: busy || loading || !!error || run.cancellationRequested, onClick: () => act({ operation: 'cancel', runId: run.id }, value => {
            if (value.acknowledged !== true) throw new Error('invalid-cancel-acknowledgement')
            setAck(t('runtimeCancelAck'))
          }) }, t(run.cancellationRequested ? 'runtimeCancelRequested' : 'runtimeCancel')) : null)))) : null,
      mode === 'preview' ? h(React.Fragment, null,
        h('button', { type: 'button', disabled: busy || loading || !!error || !data || !!data.storageError || !!data.fileError, onClick: () => act({ operation: 'preview' }, value => { setPreviewStale(false); setPreview(PreviewWire.parse(value)) }) }, t('runtimePreview')),
        previewStale ? h('p', { role: 'status' }, t('runtimePreviewStale')) : null,
        preview ? h(React.Fragment, null, h('p', { role: 'status' }, `${t('runtimeInjected')}: ${preview.injectedChars}`),
          preview.injectionBudget ? section(t('runtimeBudget'), fields([[t('runtimeEstimatedTokens'), preview.injectionBudget.tokens ?? t('runtimeUnknown')],
            [t('runtimeTokenLimit'), preview.injectionBudget.limit ?? t('runtimeUnknown')]])) : null,
          preview.impact ? section(t('runtimeImpact'), h(React.Fragment, null, h('p', null, t('runtimeImpactNote')),
            fields([[t('runtimeCommonPrefix'), preview.impact.commonPrefixBytes], [t('runtimeChangedSuffix'), preview.impact.changedSuffixBytes]]),
            details(t('runtimeByteDetails'), preview.impact))) : null,
          section(t('runtimeMatches'), preview.records.map((record, index) => h('article', { key: index }, details(`${record.ruleId ?? ''} / ${record.actionId ?? ''} · ${record.status ?? ''}`, record)))),
          section(t('runtimeScheduled'), preview.scheduled.map((job, index) => h('article', { key: index }, h('p', null, `${job.ruleId} / ${job.actionId}`), details(t('runtimeInputs'), job)))),
          section(t('runtimeBefore'), details(t('runtimeContext'), preview.diff.before)), section(t('runtimeAfter'), details(t('runtimeContext'), preview.diff.after))) : null) : null),
    mode === 'runs' ? h('footer', null, h('span', { role: 'status' }, `${offset + (data?.runs.length ? 1 : 0)}–${offset + (data?.runs.length ?? 0)} / ${data?.total ?? 0}`),
      h('button', { type: 'button', disabled: busy || loading || !!error || offset === 0, onClick: () => setOffset(value => Math.max(0, value - 20)) }, t('runtimeNewer')),
      h('button', { type: 'button', disabled: busy || loading || !!error || !data || data.nextOffset === null, onClick: () => setOffset(data.nextOffset) }, t('runtimeOlder'))) : null)
}
