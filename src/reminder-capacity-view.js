import { CapacityWire } from '@leolee9086/dsh-rule-engine/catalog-capacity'
import React, { useEffect, useRef, useState } from 'react'
import { h } from './care-ui.js'

import { httpFailure } from './http-failure.js'

/** Global reminder catalog settings, shown alongside session rules with their scope made explicit. */
export function ReminderCapacityPanel({ sessionId, t, fetcher = fetch }) {
  const [data, setData] = useState()
  const [limit, setLimit] = useState('0')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const pending = useRef()
  const endpoint = `/context-care/rules?sessionId=${encodeURIComponent(sessionId)}&scope=reminder-capacity`
  async function request(change) {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(''); setSaved(false)
    try {
      const response = await fetcher(endpoint, { signal: controller.signal,
        headers: { accept: 'application/json', ...(change ? { 'content-type': 'application/json' } : {}) },
        ...(change ? { method: 'PATCH', body: JSON.stringify(change) } : {}) })
      if (!response.ok) throw await httpFailure(response, '/context-care/rules')
      const value = CapacityWire.parse(await response.json())
      if (change && (value.revision !== change.revision + 1 || value.maxRules !== change.maxRules)) throw new Error('Invalid capacity save acknowledgement')
      if (!controller.signal.aborted) { setData(value); setLimit(String(value.maxRules)); setSaved(Boolean(change)) }
    } catch (failure) { if (!controller.signal.aborted) setError(String(failure)) }
    finally { if (pending.current === controller) pending.current = undefined; if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    void request()
    return () => { pending.current?.abort(); pending.current = undefined }
  }, [sessionId, fetcher])
  const valid = /^\d+$/.test(limit) && Number.isSafeInteger(Number(limit))
  return h('main', { 'data-care-reminder-capacity': '' },
    h('h3', null, t('reminderCapacityTitle')),
    h('p', { className: 'care-intro' }, t('reminderCapacityIntro')),
    h('button', { type: 'button', disabled: busy, onClick: () => request() }, t('controlsRefresh')),
    busy ? h('p', { role: 'status' }, t('controlsLoading')) : null,
    error ? h('p', { role: 'alert' }, error) : null,
    saved ? h('p', { role: 'status' }, t('controlsSaved')) : null,
    data ? h('dl', { className: 'care-fields' },
      h('dt', null, t('reminderRegistered')), h('dd', null, data.registeredRules),
      h('dt', null, t('reminderEffectiveLimit')), h('dd', null, data.maxRules || t('reminderUnlimited'))) : null,
    data && data.maxRules > 0 && data.registeredRules > data.maxRules ? h('p', { role: 'status' }, t('reminderOverLimit')) : null,
    h('form', { onSubmit: event => { event.preventDefault(); if (data && valid && !busy) void request({ revision: data.revision, maxRules: Number(limit) }) } },
      h('label', { className: 'care-control-line' }, t('reminderLimit'),
        h('input', { type: 'number', min: 0, step: 1, value: limit, disabled: busy || !data,
          'aria-label': t('reminderLimit'), onChange: event => { setLimit(event.target.value); setSaved(false) } })),
      h('p', { className: 'care-muted' }, t('reminderLimitHelp')),
      h('button', { type: 'submit', disabled: busy || !data || !valid }, t('reminderSave'))),
    h('h4', null, t('reminderRejected')),
    !data?.rejections.length ? h('p', null, t('reminderNoRejections')) : h('ul', null, ...data.rejections.map(item =>
      h('li', { key: item.sourceId }, h('p', null, item.sourceId),
        h('p', null, `${t('reminderSourceCount')}: ${item.sourceRules} · ${t('reminderAttemptedTotal')}: ${item.totalRules} · ${t('reminderEffectiveLimit')}: ${item.limit}`),
        h('p', { role: 'alert' }, item.message)))),
    h('p', { className: 'care-muted' }, t('reminderRetryHelp')))
}
