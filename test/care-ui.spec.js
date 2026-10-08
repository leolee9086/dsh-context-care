import { test, expect, vi } from 'vitest'
import { createElement as h } from 'react'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Sources, TextReader, Fields, RawRecord } from '../src/care-ui.js'
import { ActionDetails } from '../src/action-view.js'
import { PromptDetails } from '../src/prompt-view.js'
import { dictionaries } from '../src/client-view.js'
const t = key => dictionaries.zh[key] ?? key

test('thousands of source references stay bounded and remain searchable and navigable', async () => {
  const revealSource = vi.fn(async () => {})
  const view = render(h(Sources, { sources: Array.from({ length: 4500 }, (_, index) => index + 100), revealSource, t }))
  try {
    expect(view.container.querySelectorAll('li')).toHaveLength(0)
    fireEvent.click(view.getByRole('button', { name: '查看来源 +' }))
    expect(view.container.querySelectorAll('li')).toHaveLength(20)
    expect(view.getByText('#100')).toBeTruthy()
    expect(view.queryByText('#120')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '下一页来源' }))
    expect(view.getByText('#120')).toBeTruthy()
    fireEvent.change(view.getByRole('searchbox'), { target: { value: '4599' } })
    expect(view.container.querySelectorAll('li')).toHaveLength(1)
    fireEvent.click(view.getByRole('button', { name: '定位消息' }))
    await waitFor(() => expect(view.getByText('已定位到聊天中的来源')).toBeTruthy())
    expect(revealSource).toHaveBeenCalledWith(4599)
  } finally { cleanup() }
})

test('the exact saved prompt can be expanded and copied without altering wrappers or line breaks', async () => {
  const text = '<context-care>\n' + 'Saved line\n'.repeat(100) + '</context-care>'
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const view = render(h(TextReader, { text, t }))
  try {
    expect(view.container.querySelector('pre').textContent).toBe(text)
    fireEvent.click(view.getByRole('button', { name: '展开全文' }))
    expect(view.getByRole('button', { name: '收起全文' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '复制正文' }))
    await waitFor(() => expect(view.getByText('已复制')).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(text)
  } finally { cleanup() }
})

test('list and detail preserve result facts while raw identifiers and coverage arrays stay opt-in', () => {
  const action = { id: 'hidden-uuid', action: 'summary', phase: 'failed', outcome: 'partial', beforeInput: 153300, afterInput: 57348,
    error: 'Late summary failure', coverage: { depth: 3, leafSeqs: Array.from({ length: 4000 }, (_, index) => index + 20) }, journalPersisted: true }
  const view = render(h(ActionDetails, { value: { status: 'ready', actions: [action] }, t }))
  try {
    expect(view.container.textContent).not.toContain('hidden-uuid')
    fireEvent.click(view.getByRole('button', { name: /摘要 ·/ }))
    expect(view.getByText('Late summary failure')).toBeTruthy()
    expect(document.activeElement).toBe(view.getByRole('heading', { name: '摘要' }))
    expect(view.getByText('输入估算减少 95,952 tok · 63%')).toBeTruthy()
    expect(view.container.querySelectorAll('li')).toHaveLength(0)
    expect(view.getByText('4,000 条原始来源')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '原始记录 +' }))
    expect(view.container.textContent).toContain('hidden-uuid')
    expect(view.container.querySelector('.care-code').textContent).toContain('4019')
    fireEvent.click(view.getByRole('button', { name: /返回列表/ }))
    expect(document.activeElement).toBe(view.getByRole('button', { name: /摘要 ·/ }))
  } finally { cleanup() }
})

test('unknown rule fields remain readable and intact in an optional original record', () => {
  const value = { customEvidence: { unknownMetric: 42, body: 'Unfamiliar evidence' }, many: Array.from({ length: 100 }, (_, index) => index) }
  const view = render(h('div', null, h(Fields, { value, t }), h(RawRecord, { value, t })))
  try {
    expect(view.getByText('unknownMetric')).toBeTruthy()
    expect(view.getByText('Unfamiliar evidence')).toBeTruthy()
    expect(view.container.querySelector('.care-code')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '原始记录 +' }))
    expect(JSON.parse(view.container.querySelector('.care-code').textContent)).toEqual(value)
  } finally { cleanup() }
})

test('prompt navigation starts with summaries and exposes sources only in the selected detail', () => {
  const prompt = { id: 'request-only-private-id', seq: 33106, kind: 'request', producer: 'dsh-context-care:scoped-prompts', text: '<care>exact</care>',
    segments: [{ ruleId: 'completion-observation', metrics: { repeats: 3 } }], calls: [{ dispatched: false, phase: 'failed', route: { provider: 'p', model: 'm' } }], sources: [] }
  const view = render(h(PromptDetails, { value: { status: 'ready', prompts: [prompt] }, t }))
  try {
    expect(view.queryByText('当时的完整提示')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /完成表述提醒 ·/ }))
    expect(view.getByText('<care>exact</care>')).toBeTruthy()
    expect(view.getByText('尚未派发')).toBeTruthy()
    expect(view.container.textContent).not.toContain('request-only-private-id')
    expect(view.container.querySelector('.care-code')).toBeNull()
  } finally { cleanup() }
})
