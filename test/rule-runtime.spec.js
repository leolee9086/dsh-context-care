import { test, expect, vi, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { RuleRuntimePanel } from '../src/rule-runtime-view.js'
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

test('declarations show foreign sources, templates and current variables without authoring controls; JSON mounts on demand', async () => {
  const data = page({ documents: [{ id: 'foreign', revision: 3, title: 'Foreign document', sourceId: 'foreign-source', plugin: 'memory', registration: 'memory/entry',
    rules: [{ id: 'entry:legal-rule', revision: 1, title: 'Legal prefixed rule', on: ['request.assemble'], select: {}, match: { kind: 'always' },
      actions: [{ id: 'program', kind: 'program', stage: 'request.assemble', dependsOn: [], executorRef: 'memory:tool', inputs: { typed: 42 } }] }],
    entries: [{ id: 'template', revision: 1, title: 'Template entry', template: '{{mood}}', activation: { kind: 'constant' }, select: {}, target: { view: 'model' } }],
    variables: [{ name: 'mood', scope: 'session', type: 'string', description: 'Current mood', value: 'calm' }], partials: [{ name: 'hello', revision: 2, template: 'Hello {{mood}}' }] }],
    executors: [{ executorRef: 'memory:tool', plugin: 'memory', toolName: 'remember' }] })
  const fetcher = vi.fn(async () => reply(data))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'declarations', t, fetcher }))
  await waitFor(() => expect(view.getByText('Foreign document · v3')).toBeTruthy())
  expect(view.getByText('memory/entry')).toBeTruthy()
  expect(view.getByText('Legal prefixed rule · v1')).toBeTruthy()
  expect(view.getByText('{{mood}}')).toBeTruthy()
  expect(view.getByText('Hello {{mood}}')).toBeTruthy()
  expect(view.container.querySelector('textarea')).toBeNull()
  expect(view.queryByRole('button', { name: /新建|保存|导入/ })).toBeNull()
  expect(view.container.querySelector('.care-code')).toBeNull()
  const summary = view.getByText('当前值')
  summary.parentElement.open = true
  fireEvent(summary.parentElement, new Event('toggle'))
  await waitFor(() => expect(view.container.querySelector('.care-code').textContent).toContain('calm'))
  expect(fetcher.mock.calls.every(([, options]) => !options.method)).toBe(true)
})

test('runs paginate and filter with no stale page controls; cancellation failure survives successful reads', async () => {
  let resolvePage
  const fetcher = vi.fn(async (url, options) => {
    if (options.method === 'POST') return { ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({ error: 'disk-failed' }) }
    const query = new URL(url, 'http://localhost').searchParams
    if (query.get('offset') === '20') return new Promise(resolve => { resolvePage = resolve })
    return reply(page({ runs: [run()], total: 21, nextOffset: 20, counts: { queued: 21 } }))
  })
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher }))
  await waitFor(() => expect(view.getByRole('button', { name: '请求取消' }).disabled).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('disk-failed'))
  fireEvent.click(view.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(fetcher.mock.calls.length).toBe(3))
  expect(view.getByRole('alert').textContent).toContain('disk-failed')
  fireEvent.click(view.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(resolvePage).toBeTypeOf('function'))
  expect(view.getByRole('button', { name: '下一页' }).disabled).toBe(true)
  expect(view.queryByRole('button', { name: '请求取消' })).toBeNull()
  await act(async () => resolvePage(reply(page({ runs: [run('last')], total: 21, offset: 20 }))))
  expect(view.container.textContent).toContain('21–21 / 21')
  fireEvent.change(view.getByRole('combobox'), { target: { value: 'failed' } })
  await waitFor(() => expect(fetcher.mock.calls.at(-1)[0]).toContain('status=failed'))
  expect(fetcher.mock.calls.at(-1)[0]).toContain('offset=0')
})

test('cancel waits for durable acknowledgement, locks query controls and aborts on unmount', async () => {
  let finish; let signal
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method === 'POST') { signal = options.signal; return new Promise(resolve => { finish = resolve }) }
    return reply(page({ runs: [run()], total: 1 }))
  })
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher }))
  await waitFor(() => expect(view.getByRole('button', { name: '请求取消' }).disabled).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  expect(view.getByRole('searchbox').disabled).toBe(true)
  expect(view.getByRole('combobox').disabled).toBe(true)
  expect(view.queryByText(t('runtimeCancelAck'))).toBeNull()
  await act(async () => finish(reply({ sessionId: 'one', acknowledged: true })))
  expect(view.getByText(t('runtimeCancelAck'))).toBeTruthy()
  await waitFor(() => expect(view.getByRole('button', { name: '请求取消' }).disabled).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => finish(reply({ sessionId: 'one', acknowledged: true })))
})

test('preview is explicit and pure on mount; polling invalidates it after context changes', async () => {
  vi.useFakeTimers()
  let current = page()
  const fetcher = vi.fn(async (_url, options) => reply(options.method === 'POST' ? preview() : current))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher }))
  await act(async () => {})
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0)
  fireEvent.click(view.getByRole('button', { name: '生成预览' }))
  await act(async () => {})
  expect(view.getByText('注入字符数: 7')).toBeTruthy()
  expect(view.container.querySelector('.care-code')).toBeNull()
  current = page({ snapshotId: 'context-changed' })
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(view.getByText(t('runtimePreviewStale'))).toBeTruthy()
  expect(view.queryByText('注入字符数: 7')).toBeNull()
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
})

test('invalid nested data and wrong sessions cannot expose actionable runs', async () => {
  const fetcher = vi.fn(async () => reply(page({ runs: [{ id: 'broken', status: 'queued' }] })))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher }))
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy())
  expect(view.queryByRole('button', { name: '请求取消' })).toBeNull()
  view.unmount()
  const wrong = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher: async () => reply(page({ sessionId: 'two' })) }))
  await waitFor(() => expect(wrong.getByRole('alert').textContent).toContain('session-mismatch'))
})

test('malformed preview records fail before rendering and never masquerade as a successful preview', async () => {
  const fetcher = vi.fn(async (_url, options) => reply(options.method === 'POST' ? preview({ records: [null] }) : page()))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher }))
  await waitFor(() => expect(view.getByRole('button', { name: '生成预览' }).disabled).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '生成预览' }))
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy())
  expect(view.queryByText('注入字符数: 7')).toBeNull()
})

test('preview displays estimated tokens and byte comparison without claiming provider cache hits', async () => {
  const data = preview({ injectionBudget: { kind: 'estimate', tokens: 12, limit: 20 },
    impact: { basis: 'public-request-json-estimate', providerSerialization: 'unknown', cacheHitTokens: null,
      beforeBytes: 200, afterBytes: 300, commonPrefixBytes: 100, firstChangedByte: 100, changedSuffixBytes: 200 } })
  const fetcher = vi.fn(async (_url, options) => reply(options.method === 'POST' ? data : page()))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher }))
  await waitFor(() => expect(view.getByRole('button', { name: '生成预览' }).disabled).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '生成预览' }))
  await waitFor(() => expect(view.getByText('估算注入 token')).toBeTruthy())
  expect(view.getByText('12')).toBeTruthy(); expect(view.getByText('20')).toBeTruthy()
  expect(view.getByText(t('runtimeImpactNote'))).toBeTruthy()
  expect(view.container.querySelector('.care-code')).toBeNull()
})

test.each([
  { injectionBudget: { kind: 'estimate', tokens: null, limit: 20 } },
  { impact: { basis: 'public-request-json-estimate', providerSerialization: 'exact', cacheHitTokens: 90 } },
])('invalid budget and cache estimates are rejected before displaying a successful preview: %j', async patch => {
  const fetcher = vi.fn(async (_url, options) => reply(options.method === 'POST' ? preview(patch) : page()))
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'preview', t, fetcher }))
  await waitFor(() => expect(view.getByRole('button', { name: '生成预览' }).disabled).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '生成预览' }))
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy())
  expect(view.queryByText('注入字符数: 7')).toBeNull()
})

test('hidden pages suspend reads while an explicit cancellation retains its lifetime', async () => {
  vi.useFakeTimers()
  let finish; let postSignal
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method === 'POST') { postSignal = options.signal; return new Promise(resolve => { finish = resolve }) }
    return reply(page({ runs: [run()], total: 1 }))
  })
  const view = render(h(RuleRuntimePanel, { sessionId: 'one', mode: 'runs', t, fetcher }))
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: '请求取消' }))
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(15000))
  expect(postSignal.aborted).toBe(false)
  expect(fetcher.mock.calls.filter(([, options]) => !options.method)).toHaveLength(1)
  await act(async () => finish(reply({ sessionId: 'one', acknowledged: true })))
  expect(view.getByText(t('runtimeCancelAck'))).toBeTruthy()
  const before = fetcher.mock.calls.length
  hidden.mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => {})
  expect(fetcher.mock.calls.length).toBeGreaterThan(before)
})

test('manager retains control subscription across views, resets on session switch and ignores late requests', async () => {
  let finish; let signal
  const fetcher = vi.fn((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve }) })
  const dispose = vi.fn(); const watchControls = vi.fn(() => dispose)
  const props = { sessionId: 'one', useCareControls: () => ({ status: 'ready', sources: [] }), watchControls, changeControls: vi.fn(), refreshControls: vi.fn(), t, fetcher }
  const view = render(h(ContextCareControls, props))
  fireEvent.click(view.getByRole('button', { name: '声明与模板' }))
  expect(watchControls).toHaveBeenCalledTimes(1)
  view.rerender(h(ContextCareControls, { ...props, sessionId: 'two' }))
  expect(signal.aborted).toBe(true)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(view.getByRole('button', { name: '规则开关' }).getAttribute('aria-pressed')).toBe('true')
  await act(async () => finish(reply(page({ documents: [] }))))
  expect(view.container.querySelector('[data-care-runtime]')).toBeNull()
})
