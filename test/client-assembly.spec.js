import { test, expect, vi } from 'vitest'
import { createElement, useState, useSyncExternalStore } from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@care-test/sidebar-tabs'
import { createSidebarRightController } from '@care-test/sidebar-service'
import { createSidebarRightStore } from '@care-test/sidebar-store'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const TAB = 'dsh-context-care:actions'
// Consume the distributed factory, real framework hooks and real sidebar state.
const hostRequire = createRequire(pathToFileURL(resolve(process.env.DSH_TEST_CHECKOUT, 'packages/test-support/client-runtime/package.json')))
const plugin = { exports: {} }
runInNewContext(readFileSync('lib/client.js', 'utf8'), {
  window: { __ModuleLoader__: { load: row => { expect(row.id).toBe('dsh-context-care'); plugin.exports = row.factory(name => {
    if (name !== 'react') throw new Error(`Unexpected module ${name}`)
    return hostRequire(name)
  }) } } },
  fetch: (...args) => globalThis.fetch(...args), setInterval, clearInterval, AbortController })

test('records open in the real right sidebar, remain session scoped, and leave runtime independent on display unload', async () => {
  const runtime = await SlotTestRuntime.create()
  const dictionaries = new Map()
  const bind = name => key => dictionaries.get(name)?.[key] ?? key
  runtime.ctx.provide('locale', { bind, register(name, values) { dictionaries.set(name, values.zh); return () => dictionaries.delete(name) } })
  runtime.ctx.provide('uiConversation', { events: { register() { return () => {} } } })
  runtime.slots.installLocale({ getSnapshot: () => 0, subscribe: () => () => {}, bind })
  const tabs = new SidebarRightTabRegistry(runtime.ctx)
  const sidebar = createSidebarRightController(tabs, () => {}, { autoFullscreen: () => false,
    openWithFocus: (_sessionId, open) => open(), closeWithFocus: (_sessionId, _paneId, close) => close() })
  const stores = new Map(['session-one', 'session-two'].map(id => [id, createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create()]))
  for (const [id, store] of stores) sidebar.adopt(id, store)
  let selected = 'session-one'
  sidebar.show(selected)
  runtime.ctx.provide('sidebarRightTabs', tabs)
  runtime.ctx.provide('sidebarRight', sidebar.controller)
  const expand = vi.fn(() => stores.get(selected).actions.setExpanded(selected, true))
  runtime.ctx.provide('layout', { openRightbar: expand })
  await runtime.sessions.add({ id: 'session-one' })
  await runtime.sessions.add({ id: 'session-two' })
  await runtime.sessions.setProjection('session-one', 'contextCareNumeric', { fatigueValue: 40, wakefulnessValue: 60, fatigue: 'normal', wakefulness: 'elevated' })
  const one = runtime.sessions.retainFor(runtime.ctx, 'session-one')
  const two = runtime.sessions.retainFor(runtime.ctx, 'session-two')
  let routeFailure = false
  const fetcher = vi.fn(async url => {
    if (routeFailure) return { ok: false, status: 404 }
    if (url.includes('rewrite-journal')) return { ok: true, json: async () => ({ records: [] }) }
    const query = new URL(url, 'http://localhost').searchParams
    return { ok: true, json: async () => ({ total: 21, nextOffset: query.get('offset') === '0' ? 20 : null,
      actions: [{ id: `${query.get('sessionId')}-${query.get('offset')}`, action: 'summary', phase: 'committed', beforeInput: 30000, afterInput: 2000, journalPersisted: true }] }) }
  })
  vi.stubGlobal('fetch', fetcher)
  let selectSession
  await runtime.root.declare({
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
    'conversation.input.right': { kind: 'list', scope: 'session' },
    'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
  }, ({ renderSlot, SessionProvider }) => {
    const [session, select] = useState(one)
    selectSession = select
    selected = session.sessionId
    sidebar.show(selected)
    const store = stores.get(selected)
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    const surface = state.bySession[selected]
    const tab = Object.values(surface?.layout.tabs ?? {}).find(tab => tab.kind === TAB)
    return createElement(SessionProvider, { session },
      createElement('div', { 'data-surface': 'composer' },
        createElement('div', { 'data-surface': 'toolbar' }, renderSlot('conversation.input.right', {})),
        createElement('div', { 'data-surface': 'status' }, renderSlot('conversation.composer.dock', {}))),
      surface?.layout.expanded && tab ? createElement('aside', { 'data-surface': 'right-sidebar' },
        renderSlot('sidebar.right.pane.tab', {}, { entryKey: tabs.get(TAB)?.id })) : null)
  })
  const feature = await runtime.mount(plugin.exports)
  try {
    const view = runtime.renderRoot()
    const composer = view.container.querySelector('[data-surface="composer"]')
    expect(composer.textContent).toContain('疲劳度: 40%')
    expect(composer.querySelector('[data-surface="status"] button')).toBeNull()
    expect(composer.querySelector('[data-surface="toolbar"] button')?.getAttribute('aria-label')).toBe('预算与维护记录')
    expect(composer.querySelector('[data-context-care-actions]')).toBeNull()
    expect(view.container.textContent).not.toContain('session-one-0')
    fireEvent.click(view.getByRole('button', { name: '预算与维护记录' }))
    await waitFor(() => expect(view.container.querySelector('aside')?.textContent).toContain('session-one-0'))
    expect(sidebar.controller.isExpanded()).toBe(true)
    expect(composer.textContent).not.toContain('30,000 → 2,000')
    expect(view.container.querySelector('aside').textContent).toContain('30,000 → 2,000')
    fireEvent.click(view.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.includes('/actions?')).length).toBeGreaterThan(1))
    fireEvent.click(view.getByText('摘要'))
    expect(view.container.querySelector('.care-action')?.open).toBe(true)
    expect(view.getByText('页 1 / 2')).toBeTruthy()
    expect(view.container).toMatchSnapshot('composer entry and right sidebar records')
    fireEvent.click(view.getByRole('button', { name: '预算与维护记录' }))
    expect(Object.values(stores.get(selected).getSnapshot().bySession[selected].layout.tabs).filter(tab => tab.kind === TAB)).toHaveLength(1)
    fireEvent.click(view.getByText('更早记录'))
    await waitFor(() => expect(view.container.querySelector('aside').textContent).toContain('session-one-20'))
    await act(async () => selectSession(two))
    expect(view.container.querySelector('aside')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '预算与维护记录' }))
    await waitFor(() => expect(view.container.querySelector('aside')?.textContent).toContain('session-two-0'))
    expect(view.container.textContent).not.toContain('session-one-20')
    routeFailure = true
    await waitFor(() => expect(view.container.querySelector('aside').textContent).toContain('HTTP 404'), { timeout: 5000 })
    expect(view.container.querySelector('aside [role="alert"]')?.textContent).toContain('HTTP 404')
    await feature.dispose()
    expect(runtime.slots.entries('conversation.composer.dock')).toHaveLength(0)
    expect(runtime.slots.entries('conversation.input.right')).toHaveLength(0)
    expect(runtime.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(runtime.slots.entries('conversation.chat.node')).toHaveLength(0)
    expect(tabs.get(TAB)).toBeUndefined()
  } finally { sidebar.controller.tabDomain.dispose(); await runtime.dispose(); vi.unstubAllGlobals() }
})
