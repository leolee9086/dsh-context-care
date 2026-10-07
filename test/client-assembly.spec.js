import { test, expect, vi } from 'vitest'
import { createElement, useState } from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Consume the actual distributed CJS bundle with the shared React identity.
const hostRequire = createRequire(pathToFileURL(resolve(process.env.DSH_TEST_CHECKOUT, 'packages/test-support/client-runtime/package.json')))
const plugin = { exports: {} }
runInNewContext(readFileSync('lib/client.js', 'utf8'), {
  window: { __ModuleLoader__: { load: row => { expect(row.id).toBe('dsh-context-care'); plugin.exports = row.factory(name => {
    if (name !== 'react') throw new Error(`Unexpected module ${name}`)
    return hostRequire(name)
  }) } } },
  fetch: (...args) => globalThis.fetch(...args), setInterval, clearInterval, AbortController })

test('the distributed client mounts real framework hooks, pages within the selected session and removes entries on unload', async () => {
  const runtime = await SlotTestRuntime.create()
  const dictionaries = new Map()
  runtime.ctx.provide('locale', { register(name, values) { dictionaries.set(name, values.zh); return () => dictionaries.delete(name) } })
  runtime.ctx.provide('uiConversation', { events: { register() { return () => {} } } })
  runtime.slots.installLocale({ getSnapshot: () => 0, subscribe: () => () => {}, bind: name => key => dictionaries.get(name)?.[key] ?? key })
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
    'conversation.chat.node': { kind: 'keyed', scope: 'session' },
  }, ({ renderSlot, SessionProvider }) => {
    const [session, select] = useState(one)
    selectSession = select
    return createElement(SessionProvider, { session }, renderSlot('conversation.composer.dock', {}))
  })
  const feature = await runtime.mount(plugin.exports)
  try {
    const view = runtime.renderRoot()
    await waitFor(() => expect(view.container.textContent).toContain('session-one-0'))
    expect(view.container.textContent).toContain('预算与维护记录')
    expect(view.container.textContent).toContain('疲劳度: 40%')
    expect(view.container.textContent).toContain('30,000 → 2,000')
    expect(view.container).toMatchSnapshot('selected-session budget and maintenance')
    fireEvent.click(view.getByText('更早记录'))
    await waitFor(() => expect(view.container.textContent).toContain('session-one-20'))
    await act(async () => selectSession(two))
    await waitFor(() => expect(view.container.textContent).toContain('session-two-0'))
    expect(view.container.textContent).not.toContain('session-one-20')
    expect(fetcher.mock.calls.some(([url]) => url.includes('sessionId=session-two&limit=20&offset=0'))).toBe(true)
    routeFailure = true
    await waitFor(() => expect(view.container.textContent).toContain('HTTP 404'), { timeout: 5000 })
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 404')
    expect(view.container.textContent).not.toContain('等待首次状态')
    await feature.dispose()
    expect(view.container.textContent).not.toContain('预算与维护记录')
    expect(runtime.slots.entries('conversation.composer.dock')).toHaveLength(0)
    expect(runtime.slots.entries('conversation.chat.node')).toHaveLength(0)
  } finally { await runtime.dispose(); vi.unstubAllGlobals() }
})
