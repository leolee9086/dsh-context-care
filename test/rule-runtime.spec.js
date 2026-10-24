import { test, expect, vi, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { RuleRuntimePanel } from '../src/rule-runtime-view.js'
import { ReminderCapacityPanel } from '../src/reminder-capacity-view.js'
import { ContextCareControls } from '../src/control-view.js'
import { controlCopy } from '../src/control-copy.js'
const t = key => controlCopy.zh[key] ?? key
const reply = value => ({ ok: true, json: async () => value })
const run = (id = 'run-one') => ({ id, sourceId: 'source', ruleId: 'rule', actionId: 'notify', kind: 'notify', status: 'queued', reason: null,
  delivery: 'not-delivered', createdAt: 100, updatedAt: 100, sourceSeqs: [2], inputs: { note: 'hello' } })
const page = (patch = {}) => ({ sessionId: 'one', snapshotId: 'snapshot-one', turnId: 'turn:1', storageError: null, fileError: null,
  documents: [], executors: [], dispatches: [], runs: [], total: 0, offset: 0, nextOffset: null, counts: {}, ...patch })
const preview = (patch = {}) => ({ sessionId: 'one', snapshotId: 'snapshot-one', injectedChars: 7, documents: [], records: [], scheduled: [],
  diff: { before: { messages: [{ role: 'user', content: 'original' }] }, after: { messages: [{ role: 'user', content: 'changed' }] } }, ...patch })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

/** The component's subscription input; transport delivery has its own real-stream tests. */
function runtimeUpdates(initial = page()) {
  let current = initial
  const active = new Set()
  const emit = entry => { const value = typeof current === 'function' ? current(entry.query) : current; if (value) entry.listener({ type: 'snapshot', value }) }
  const watchRuntime = vi.fn((query, listener) => {
    const entry = { query, listener }; active.add(entry); emit(entry)
    return () => active.delete(entry)
  })
  return { watchRuntime, refreshRuntime: vi.fn(() => { for (const entry of active) emit(entry) }), active,
    push(value) { current = value; for (const entry of active) emit(entry) } }
}

test('reminder capacity waits for acknowledgement and preserves effective limits after failed saves', async () => {
  let finish, fail = false
  const initial = { revision: 0, maxRules: 0, registeredRules: 2000, rejections: [] }
  const fetcher = vi.fn(async (url, options) => {
    expect(url).toContain('scope=reminder-capacity')
    if (options.method !== 'PATCH') return reply(initial)
    if (fail) return { ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({ error: 'disk-failed' }) }
    return new Promise(resolve => { finish = () => resolve(reply({ ...initial, ...JSON.parse(options.body), revision: 1 })) })
  })
  const view = render(h(ReminderCapacityPanel, { sessionId: 'one', t, fetcher }))
  await waitFor(() => expect(view.getByText('2000')).toBeTruthy())
  const input = view.getByRole('spinbutton')
  fireEvent.change(input, { target: { value: '1500' } })
  fireEvent.click(view.getByRole('button', { name: '保存容量设置' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(view.getByText('不限制')).toBeTruthy()
  expect(view.getByRole('button', { name: '保存容量设置' }).disabled).toBe(true)
  await act(async () => finish())
  expect(view.getByText('已保存')).toBeTruthy()
  expect(view.getByText('1500')).toBeTruthy()
  expect(view.getByText(/现有规则超过新上限/)).toBeTruthy()
  fail = true
  fireEvent.change(input, { target: { value: '0' } })
  fireEvent.click(view.getByRole('button', { name: '保存容量设置' }))
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('disk-failed'))
  expect(view.getByText('1500')).toBeTruthy()
  expect(view.queryByText('已保存')).toBeNull()
  expect(JSON.parse(fetcher.mock.calls.at(-1)[1].body)).toEqual({ revision: 1, maxRules: 0 })
})

test('pushed declarations show foreign sources and templates with no HTTP read', async () => {
  const data = page({ documents: [{ id: 'foreign', revision: 3, title: 'Foreign document', sourceId: 'foreign-source', plugin: 'memory', registration: 'memory/entry',
    rules: [{ id: 'entry:legal-rule', revision: 1, title: 'Legal prefixed rule', on: ['request.assemble'], select: {}, match: { kind: 'always' },
      actions: [{ id: 'program', kind: 'program', stage: 'request.assemble', dependsOn: [], executorRef: 'memory:tool', inputs: { typed: 42 } }] }],
    entries: [{ id: 'template', revision: 1, title: 'Template entry', template: '{{mood}}', activation: { kind: 'constant' }, select: {}, target: { view: 'model' } }],
    variables: [{ name: 'mood', scope: 'session', type: 'string', description: 'Current mood', value: 'calm' }], partials: [{ name: 'hello', revision: 2, template: 'Hello {{mood}}' }] }],
    executors: [{ executorRef: 'memory:tool', plugin: 'memory', toolName: 'remember' }] })
  const fetcher = vi.fn(); const updates = runtimeUpdates(data)
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'declarations', t, fetcher, ...updates }))
  expect(view.getByText('Foreign document · v3')).toBeTruthy()
  expect(view.getByText('memory/entry')).toBeTruthy()
  expect(view.getByText('Legal prefixed rule · v1')).toBeTruthy()
  expect(view.getByText('{{mood}}')).toBeTruthy(); expect(view.getByText('Hello {{mood}}')).toBeTruthy()
  expect(view.container.querySelector('textarea')).toBeNull()
  expect(view.queryByRole('button', { name: /新建|保存|导入/ })).toBeNull()
  expect(view.container.querySelector('.care-code')).toBeNull()
  const summary = view.getByText('当前值'); summary.parentElement.open = true
  fireEvent(summary.parentElement, new Event('toggle'))
  await waitFor(() => expect(view.container.querySelector('.care-code').textContent).toContain('calm'))
  expect(fetcher).not.toHaveBeenCalled()
})

test('pagination changes the subscription and a pushed refresh does not erase cancellation failure', async () => {
  const first = page({ runs: [run()], total: 21, nextOffset: 20, counts: { queued: 21 } })
  const updates = runtimeUpdates(query => query.offset === 20 ? undefined : first)
  const fetcher = vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({ error: 'disk-failed' }) }))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher, ...updates }))
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('disk-failed'))
  fireEvent.click(view.getByRole('button', { name: '刷新' }))
  expect(updates.refreshRuntime).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(view.getByRole('alert').textContent).toContain('disk-failed')
  fireEvent.click(view.getByRole('button', { name: '下一页' }))
  expect(updates.watchRuntime.mock.calls.at(-1)[0].offset).toBe(20)
  expect(updates.active.size).toBe(1)
  expect(view.getByRole('button', { name: '下一页' }).disabled).toBe(true)
  expect(view.queryByRole('button', { name: '请求取消' })).toBeNull()
  await act(async () => updates.push(page({ runs: [run('last')], total: 21, offset: 20 })))
  expect(view.container.textContent).toContain('21–21 / 21')
  fireEvent.change(view.getByRole('combobox'), { target: { value: 'failed' } })
  expect(updates.watchRuntime.mock.calls.at(-1)[0]).toMatchObject({ status: 'failed', offset: 0 })
  expect(fetcher.mock.calls.every(([, options]) => options.method === 'POST')).toBe(true)
})

test('cancel waits for durable acknowledgement, locks query controls and aborts on unmount', async () => {
  let finish; let signal
  const fetcher = vi.fn(async (_url, options) => {
    expect(options.method).toBe('POST'); signal = options.signal
    return new Promise(resolve => { finish = resolve })
  })
  const updates = runtimeUpdates(page({ runs: [run()], total: 1 }))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher, ...updates }))
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  expect(view.getByRole('searchbox').disabled).toBe(true); expect(view.getByRole('combobox').disabled).toBe(true)
  expect(view.queryByText(t('runtimeCancelAck'))).toBeNull()
  await act(async () => finish(reply({ sessionId: 'one', acknowledged: true })))
  expect(view.getByText(t('runtimeCancelAck'))).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  view.unmount(); expect(signal.aborted).toBe(true); expect(updates.active.size).toBe(0)
  await act(async () => finish(reply({ sessionId: 'one', acknowledged: true })))
})

test('preview is explicit and a pushed context change invalidates it without another request', async () => {
  vi.useFakeTimers()
  const updates = runtimeUpdates()
  const fetcher = vi.fn(async () => reply(preview()))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher, ...updates }))
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '生成预览' })); await act(async () => {})
  expect(view.getByText('注入字符数: 7')).toBeTruthy(); expect(view.container.querySelector('.care-code')).toBeNull()
  await act(async () => vi.advanceTimersByTimeAsync(15000))
  expect(fetcher).toHaveBeenCalledTimes(1)
  await act(async () => updates.push(page({ snapshotId: 'context-changed' })))
  expect(view.getByText(t('runtimePreviewStale'))).toBeTruthy(); expect(view.queryByText('注入字符数: 7')).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('invalid nested data and wrong sessions cannot expose actionable runs', async () => {
  const fetcher = vi.fn()
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher, ...runtimeUpdates(page({ runs: [{ id: 'broken', status: 'queued' }] })) }))
  expect(view.getByRole('alert')).toBeTruthy(); expect(view.queryByRole('button', { name: '请求取消' })).toBeNull()
  view.unmount()
  const wrong = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher, ...runtimeUpdates(page({ sessionId: 'two' })) }))
  expect(wrong.getByRole('alert').textContent).toContain('session-mismatch'); expect(fetcher).not.toHaveBeenCalled()
})

test('malformed preview records fail before rendering a successful preview', async () => {
  const fetcher = vi.fn(async () => reply(preview({ records: [null] })))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher, ...runtimeUpdates() }))
  fireEvent.click(view.getByRole('button', { name: '生成预览' }))
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy()); expect(view.queryByText('注入字符数: 7')).toBeNull()
})

test('preview displays estimated tokens and byte comparison without claiming provider cache hits', async () => {
  const data = preview({ injectionBudget: { kind: 'estimate', tokens: 12, limit: 20 },
    impact: { basis: 'public-request-json-estimate', providerSerialization: 'unknown', cacheHitTokens: null,
      beforeBytes: 200, afterBytes: 300, commonPrefixBytes: 100, firstChangedByte: 100, changedSuffixBytes: 200 } })
  const fetcher = vi.fn(async () => reply(data))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher, ...runtimeUpdates() }))
  fireEvent.click(view.getByRole('button', { name: '生成预览' }))
  await waitFor(() => expect(view.getByText('估算注入 token')).toBeTruthy())
  expect(view.getByText('12')).toBeTruthy(); expect(view.getByText('20')).toBeTruthy()
  expect(view.getByText(t('runtimeImpactNote'))).toBeTruthy(); expect(view.container.querySelector('.care-code')).toBeNull()
})

test.each([
  { injectionBudget: { kind: 'estimate', tokens: null, limit: 20 } },
  { impact: { basis: 'public-request-json-estimate', providerSerialization: 'exact', cacheHitTokens: 90 } },
])('invalid budget and cache estimates are rejected before displaying a successful preview: %j', async patch => {
  const fetcher = vi.fn(async () => reply(preview(patch)))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher, ...runtimeUpdates() }))
  fireEvent.click(view.getByRole('button', { name: '生成预览' }))
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy()); expect(view.queryByText('注入字符数: 7')).toBeNull()
})

test('visibility and focus do not open requests or cancel an explicit mutation', async () => {
  vi.useFakeTimers()
  let finish; let postSignal
  const fetcher = vi.fn(async (_url, options) => {
    expect(options.method).toBe('POST'); postSignal = options.signal
    return new Promise(resolve => { finish = resolve })
  })
  const updates = runtimeUpdates(page({ runs: [run()], total: 1 }))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher, ...updates }))
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange')); await act(async () => vi.advanceTimersByTimeAsync(15000))
  expect(postSignal.aborted).toBe(false)
  await act(async () => finish(reply({ sessionId: 'one', acknowledged: true })))
  expect(view.getByText(t('runtimeCancelAck'))).toBeTruthy()
  hidden.mockReturnValue(false); fireEvent(document, new Event('visibilitychange')); fireEvent(window, new Event('focus'))
  expect(fetcher).toHaveBeenCalledTimes(1); expect(updates.watchRuntime).toHaveBeenCalledTimes(1)
})

test('manager retains controls across views and ignores a released runtime subscription', async () => {
  const updates = runtimeUpdates(query => undefined)
  const dispose = vi.fn(); const watchControls = vi.fn(() => dispose)
  const props = { sessionId: 'one', useCareControls: () => ({ status: 'ready', sources: [] }), watchControls, changeControls: vi.fn(), refreshControls: vi.fn(), t, fetcher: vi.fn(), ...updates }
  const view = render(h(ContextCareControls, props))
  fireEvent.click(view.getByRole('button', { name: '声明与模板' }))
  expect(watchControls).toHaveBeenCalledTimes(1); expect(updates.active.size).toBe(1)
  const late = updates.watchRuntime.mock.calls[0][1]
  view.rerender(h(ContextCareControls, { ...props, sessionId: 'two' }))
  expect(dispose).toHaveBeenCalledTimes(1); expect(updates.active.size).toBe(0)
  expect(view.getByRole('button', { name: '规则开关' }).getAttribute('aria-pressed')).toBe('true')
  await act(async () => late({ type: 'snapshot', value: page() }))
  expect(view.container.querySelector('[data-care-runtime]')).toBeNull(); expect(props.fetcher).not.toHaveBeenCalled()
})
