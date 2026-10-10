import { test, expect, vi } from 'vitest'
import { createElement as h, useState, useSyncExternalStore } from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@care-test/sidebar-tabs'
import { createSidebarRightController } from '@care-test/sidebar-service'
import { createSidebarRightStore } from '@care-test/sidebar-store'
import { UiConversation } from '@care-test/conversation'
import { chatViewDefinition } from '@care-test/chat-builder'
import { messageDefinition } from '@care-test/message-definition'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const TAB = 'dsh-context-care:actions'
const PROMPTS = 'dsh-context-care:prompts'
const hostRequire = createRequire(pathToFileURL(resolve(process.env.DSH_TEST_CHECKOUT, 'packages/test-support/client-runtime/package.json')))
const plugin = { exports: {} }
runInNewContext(readFileSync(resolve(process.env.DSH_TEST_PLUGIN_ROOT ?? '.', 'lib/client.js'), 'utf8'), {
  window: { addEventListener: (...args) => window.addEventListener(...args), removeEventListener: (...args) => window.removeEventListener(...args), __ModuleLoader__: { load: row => { expect(row.id).toBe('dsh-context-care'); plugin.exports = row.factory(name => { expect(name).toBe('react'); return hostRequire(name) }) } } },
  fetch: (...args) => globalThis.fetch(...args), setInterval, clearInterval, setTimeout, clearTimeout, AbortController, document,
})
const event = seq => ({ type: 'event', event: { type: 'user/message', seq, time: seq, surfaceOp: 'append',
  data: { id: `message-${seq}`, content: [{ type: 'text', text: `Source ${seq}` }], source: { kind: 'user' } } } })
// Snapshot rendered structure separately from the production theme sheet (visually checked).
function snapshotView(container) {
  const copy = container.cloneNode(true)
  for (const style of copy.querySelectorAll('style')) style.remove()
  return copy.outerHTML
}
const rectangle = { top: 20, bottom: 100, left: 20, right: 320, width: 300, height: 80 }

test('native slots show readable records, locate paged sources, isolate sessions and release navigation on unload', async () => {
  const runtime = await SlotTestRuntime.create()
  const dictionaries = new Map()
  const bind = name => key => dictionaries.get(name)?.[key] ?? key
  runtime.ctx.provide('locale', { bind, register(name, values) { dictionaries.set(name, values.zh); return () => dictionaries.delete(name) } })
  const conversation = new UiConversation(runtime.ctx, runtime.ctx.sessions)
  runtime.ctx.effect(() => conversation.events.register(messageDefinition))
  runtime.ctx.effect(() => conversation.views.register(chatViewDefinition))
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
  runtime.ctx.provide('layout', { openRightbar: () => stores.get(selected).actions.setExpanded(selected, true) })
  const load = vi.fn(async seq => { runtime.sessions.behavior('session-one').eventSource.prepend([event(seq)], false) })
  await runtime.sessions.add({ id: 'session-one', events: [event(24)], session: { loadThrough: load } })
  await runtime.sessions.add({ id: 'session-two', events: [event(24)], session: { loadThrough: vi.fn(async () => {}) } })
  await runtime.sessions.setProjection('session-one', 'contextCareNumeric', { fatigueValue: 40, wakefulnessValue: 60, fatigue: 'normal', wakefulness: 'elevated' })
  const one = runtime.sessions.retainFor(runtime.ctx, 'session-one')
  const two = runtime.sessions.retainFor(runtime.ctx, 'session-two')
  let routeFailure = false
  const selections = new Map()
  const fetcher = vi.fn(async (url, options) => {
    if (routeFailure) return { ok: false, status: 404 }
    if (url.includes('rewrite-journal')) return { ok: true, json: async () => ({ records: [] }) }
    const query = new URL(url, 'http://localhost').searchParams
    if (url.includes('/rules?')) {
      const sessionId = query.get('sessionId')
      const saved = selections.get(sessionId) ?? { revision: 0, selected: true }
      if (options?.method === 'PATCH') {
        const change = JSON.parse(options.body)
        expect(change.revision).toBe(saved.revision)
        saved.revision++; saved.selected = change.enabled
        selections.set(sessionId, saved)
      }
      return { ok: true, json: async () => ({ sessionId, revision: saved.revision, sources: [{ sourceId: 'external', plugin: 'memory-plugin',
        registration: 'memory-plugin/rules', executor: 'dsh-context-care', rules: [{ id: 'check', title: 'Memory check', paused: false,
          actions: [{ id: 'notice', selected: saved.selected, enabled: saved.selected, reason: saved.selected ? 'enabled' : 'action-disabled' }] }] }] }) }
    }
    if (url.includes('/rule-runtime?')) {
      const sessionId = query.get('sessionId')
      const common = { sessionId, snapshotId: `snapshot-${sessionId}` }
      if (options?.method === 'POST') return { ok: true, json: async () => ({ ...common, injectedChars: 3, documents: [], records: [], scheduled: [], diff: { before: { messages: [] }, after: { messages: [] } } }) }
      return { ok: true, json: async () => ({ ...common, turnId: 'turn:1', storageError: null, fileError: null,
        documents: [{ id: `doc-${sessionId}`, revision: 1, title: `Declarations ${sessionId}`, sourceId: 'memory', plugin: 'memory', registration: 'memory/decl', rules: [], entries: [], variables: [], partials: [] }],
        executors: [], dispatches: [], runs: [], total: 0, offset: 0, nextOffset: null, counts: {} }) }
    }
    if (url.includes('/prompts?')) {
      const offset = query.has('seq') ? 20 : Number(query.get('offset'))
      const sessionId = query.get('sessionId')
      return { ok: true, json: async () => ({ total: 21, offset, selectedFound: query.has('seq') ? query.get('seq') === '4' : undefined,
        nextOffset: offset === 0 ? 20 : null, prompts: [{ id: `${sessionId}-prompt-${offset}`, seq: offset === 20 ? 4 : 24, kind: 'message',
          producer: 'dsh-context-care:state', at: 100, text: `<context-care>exact ${sessionId} prompt ${offset}</context-care>`,
          source: { contextCareTrace: { trigger: 'budget-state' } }, calls: [{ callId: 'call-one', dispatched: false }],
          sources: [{ seq: 2, type: 'user/message', excerpt: 'verified source', truncated: false }] }] }) }
    }
    return { ok: true, json: async () => ({ total: 21, nextOffset: query.get('offset') === '0' ? 20 : null,
      actions: [{ id: `${query.get('sessionId')}-${query.get('offset')}`, action: 'summary', phase: 'committed', beforeInput: 30000, afterInput: 2000, journalPersisted: true }] }) }
  })
  vi.stubGlobal('fetch', fetcher)
  const scroll = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [rectangle])
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rectangle)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  let selectSession
  await runtime.root.declare({
    'conversation.composer.dock': { kind: 'list', scope: 'session' }, 'conversation.input.right': { kind: 'list', scope: 'session' },
    'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
  }, ({ renderSlot, SessionProvider }) => {
    const [session, select] = useState(one)
    selectSession = select
    selected = session.sessionId
    sidebar.show(selected)
    const state = useSyncExternalStore(stores.get(selected).subscribe, stores.get(selected).getSnapshot)
    const surface = state.bySession[selected]
    const tab = surface?.layout.tabs[surface.layout.nodes[surface.layout.activePaneId]?.activeTabId]
    const assembly = conversation.binding(session.sessionId)
    assembly.activate('chat')
    const projection = useSyncExternalStore(assembly.snapshot.subscribe, assembly.snapshot.getSnapshot)
    const chat = projection.views.get('chat')
    // Test-owned Chat seats consume actual host-generated node identities.
    return h(SessionProvider, { session }, h('div', { 'data-surface': 'composer' },
      h('div', { 'data-surface': 'toolbar' }, renderSlot('conversation.input.right', {})),
      h('div', { 'data-surface': 'status' }, renderSlot('conversation.composer.dock', {}))),
      h('div', { 'data-conversation-session': selected, 'data-conversation-region': 'chat' },
        ...chat.nodes.values().filter(node => node.kind !== 'context-care-display-copy').map(node => h('div', { key: node.key, 'data-chat-node-key': node.key }, `Source ${node.data.seq}`))),
      renderSlot('conversation.chat.node', { node: { data: { seq: 4, producer: 'dsh-context-care:state', body: 'Original notice', summary: '', values: [] } } }, { entryKey: 'context-care-notice' }),
      surface?.layout.expanded && tab ? h('aside', { 'data-surface': 'right-sidebar' }, renderSlot('sidebar.right.pane.tab', {}, { entryKey: tabs.get(tab.kind)?.id })) : null)
  })
  const feature = await runtime.mount(plugin.exports)
  try {
    const view = runtime.renderRoot()
    const composer = view.container.querySelector('[data-surface="composer"]')
    expect(composer.textContent).toContain('疲劳度: 40%')
    expect(composer.querySelector('[data-surface="status"] button')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '预算与维护记录' }))
    await waitFor(() => expect(view.getByRole('button', { name: /摘要 ·/ })).toBeTruthy())
    expect(sidebar.controller.isExpanded()).toBe(true)
    expect(view.container.querySelector('aside').textContent).not.toContain('session-one-0')
    expect(view.container.querySelector('aside').textContent).toContain('30,000 → 2,000')
    fireEvent.click(view.getByRole('button', { name: /摘要 ·/ }))
    expect(view.getByRole('button', { name: /返回列表/ })).toBeTruthy()
    expect(view.container.querySelector('aside').textContent).toContain('输入估算减少 28,000 tok · 93%')
    expect(snapshotView(view.container)).toMatchSnapshot('maintenance detail in official sidebar')
    fireEvent.click(view.getByRole('button', { name: /返回列表/ }))
    fireEvent.click(view.getByText('更早记录'))
    await waitFor(() => expect(view.getByText('页 2 / 2')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '详情与溯源 →' }))
    await waitFor(() => expect(view.container.querySelector('aside').textContent).toContain('exact session-one prompt 20'))
    expect(fetcher.mock.calls.some(([url]) => url.includes('seq=4'))).toBe(true)
    expect(view.container.querySelector('aside').textContent).toContain('尚未派发')
    expect(view.container.querySelector('aside').textContent).not.toContain('"dispatched"')
    fireEvent.click(view.getByRole('button', { name: '查看来源 +' }))
    expect(view.getByText('verified source')).toBeTruthy()
    const jumpButtons = view.getAllByRole('button', { name: '定位消息' })
    fireEvent.click(jumpButtons.at(-1))
    await waitFor(() => expect(view.getByText('已定位到聊天中的来源')).toBeTruthy())
    expect(load).toHaveBeenCalledWith(2)
    const landed = scroll.mock.instances.at(-1)
    expect(landed.getAttribute('data-chat-node-key')).toBe(conversation.binding('session-one').snapshot.getSnapshot().views.get('chat').nodes.values().find(node => node.data.seq === 2).key)
    expect(snapshotView(view.container)).toMatchSnapshot('selected prompt and source navigation')
    fireEvent.click(view.getByRole('button', { name: '原始记录 +' }))
    await waitFor(() => expect(view.container.querySelector('aside').textContent).toContain('"dispatched": false'))
    fireEvent.click(view.getByRole('button', { name: '原始记录 −' }))
    const beforeRefresh = fetcher.mock.calls.length
    fireEvent.click(view.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(beforeRefresh))
    fireEvent.click(view.getByText('较新记录'))
    await waitFor(() => expect(view.getByRole('button', { name: /负荷与留存状态 ·/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '详情与溯源 →' }))
    await waitFor(() => expect(view.container.querySelector('aside').textContent).toContain('exact session-one prompt 20'))
    expect(Object.values(stores.get(selected).getSnapshot().bySession[selected].layout.tabs).filter(tab => tab.kind === PROMPTS)).toHaveLength(1)
    await act(async () => selectSession(two))
    expect(view.container.querySelector('aside')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '提示详情与溯源' }))
    await waitFor(() => expect(view.getByRole('button', { name: /负荷与留存状态 ·/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /负荷与留存状态 ·/ }))
    expect(view.container.querySelector('aside').textContent).toContain('exact session-two prompt 0')
    expect(view.container.textContent).not.toContain('exact session-one prompt')
    fireEvent.click(view.getByRole('button', { name: '打开会话规则控制' }))
    await waitFor(() => expect(view.getByText('memory-plugin')).toBeTruthy())
    expect(view.getByRole('checkbox', { name: '提醒' }).checked).toBe(true)
    fireEvent.click(view.getByRole('checkbox', { name: '提醒' }))
    await waitFor(() => expect(view.getByText('已保存')).toBeTruthy())
    expect(view.getByRole('checkbox', { name: '提醒' }).checked).toBe(false)
    expect(selections.get('session-two').selected).toBe(false)
    fireEvent.click(view.getByRole('button', { name: '声明与模板' }))
    await waitFor(() => expect(view.getByText('Declarations session-two · v1')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '运行任务' }))
    await waitFor(() => expect(view.getByText('没有匹配的任务')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '请求预览' }))
    await waitFor(() => expect(view.getByRole('button', { name: '生成预览' }).disabled).toBe(false))
    expect(fetcher.mock.calls.filter(([url, options]) => url.includes('/rule-runtime?') && options?.method === 'POST')).toHaveLength(0)
    fireEvent.click(view.getByRole('button', { name: '生成预览' }))
    await waitFor(() => expect(view.getByText('注入字符数: 3')).toBeTruthy())
    await act(async () => selectSession(one))
    fireEvent.click(view.getByRole('button', { name: '打开会话规则控制' }))
    await waitFor(() => expect(view.getByText('memory-plugin')).toBeTruthy())
    expect(view.getByRole('checkbox', { name: '提醒' }).checked).toBe(true)
    expect(tabs.get('dsh-context-care:workbench')).toBeUndefined()
    expect(dictionaries.has('dsh-context-care-workbench')).toBe(false)
    expect(view.queryByRole('button', { name: '上下文规则工作台' })).toBeNull()
    expect(view.queryByRole('button', { name: '新建文档' })).toBeNull()
    expect(view.container.querySelector('textarea')).toBeNull()
    expect(fetcher.mock.calls.some(([url]) => url.includes('/workbench?'))).toBe(false)
    routeFailure = true
    await waitFor(() => expect(view.container.querySelector('aside [role="alert"]')?.textContent).toContain('HTTP 404'), { timeout: 5000 })
    await feature.dispose()
    for (const name of ['conversation.composer.dock', 'conversation.input.right', 'sidebar.right.pane.tab', 'conversation.chat.node']) expect(runtime.slots.entries(name)).toHaveLength(0)
    expect(tabs.get(TAB)).toBeUndefined()
    expect(tabs.get(PROMPTS)).toBeUndefined()
    expect(tabs.get('dsh-context-care:rules')).toBeUndefined()
    expect(tabs.get('dsh-context-care:workbench')).toBeUndefined()
    expect(dictionaries.has('dsh-context-care-workbench')).toBe(false)
  } finally { sidebar.controller.tabDomain.dispose(); await runtime.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
})

test('built client leaves unchanged native messages without markers or display HTTP reads', async () => {
  const runtime = await SlotTestRuntime.create(); const dictionaries = new Map()
  const bind = name => key => dictionaries.get(name)?.[key] ?? key
  runtime.ctx.provide('locale', { bind, register(name, values) { dictionaries.set(name, values.zh); return () => dictionaries.delete(name) } })
  runtime.slots.installLocale({ getSnapshot: () => 0, subscribe: () => () => {}, bind })
  const conversation = new UiConversation(runtime.ctx, runtime.ctx.sessions)
  runtime.ctx.effect(() => conversation.events.register(messageDefinition))
  runtime.ctx.effect(() => conversation.views.register(chatViewDefinition))
  const tabs = new SidebarRightTabRegistry(runtime.ctx)
  runtime.ctx.provide('sidebarRightTabs', tabs)
  runtime.ctx.provide('sidebarRight', { openTabIn() {}, isExpanded: () => false })
  runtime.ctx.provide('layout', { openRightbar() {} })
  await runtime.sessions.add({ id: 'display-session', events: [event(24)] })
  const session = runtime.sessions.retainFor(runtime.ctx, 'display-session')
  const fetcher = vi.fn(() => { throw new Error('Rendering an unchanged message must not read display details') })
  vi.stubGlobal('fetch', fetcher)
  await runtime.root.declare({ 'conversation.chat.node': { kind: 'keyed', scope: 'session' } }, ({ SessionProvider, renderSlot }) => {
    const assembly = conversation.binding(session.sessionId); assembly.activate('chat')
    const projection = useSyncExternalStore(assembly.snapshot.subscribe, assembly.snapshot.getSnapshot)
    return h(SessionProvider, { session }, h('main', null, ...projection.views.get('chat').nodes.values().map(node =>
      h('div', { key: node.key }, node.kind === 'context-care-display-copy'
        ? renderSlot('conversation.chat.node', { node }, { entryKey: node.kind })
        : h('pre', { 'data-native-message': '' }, node.data.content.map(block => block.text).join(''))))))
  })
  const feature = await runtime.mount(plugin.exports)
  try {
    const view = runtime.renderRoot()
    expect(view.container.querySelector('[data-native-message]').textContent).toBe('Source 24')
    expect(view.container.querySelector('[data-context-care-marker]')).toBeNull()
    expect(view.queryByText('原文')).toBeNull(); expect(view.queryByText('变换后')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
    await feature.dispose()
    expect(conversation.binding(session.sessionId).snapshot.getSnapshot().views.get('chat').nodes.values().some(node => node.kind === 'context-care-display-copy')).toBe(false)
    expect(runtime.slots.entries('conversation.chat.node')).toHaveLength(0)
  } finally { await runtime.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
})
