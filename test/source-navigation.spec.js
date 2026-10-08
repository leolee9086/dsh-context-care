import { test, expect, vi, afterEach } from 'vitest'
import { createSourceNavigator, sourceTarget } from '../src/source-navigation.js'
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = '' })

function fixture({ loadThrough = vi.fn(async () => {}), nodes, entries } = {}) {
  document.body.innerHTML = '<div data-conversation-session="s" data-conversation-region="chat"><div id="outer" hidden="until-found"><div id="inner" hidden="until-found"><div data-chat-node-key="exact">Exact message</div></div></div></div>'
  const host = document.querySelector('[data-conversation-session]')
  const card = document.querySelector('[data-chat-node-key]')
  const box = { top: 20, bottom: 100, left: 20, right: 320 }
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [box])
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => box)
  const scroll = vi.fn()
  card.scrollIntoView = scroll
  for (const id of ['outer', 'inner']) document.getElementById(id).addEventListener('beforematch', event => {
    // This fixture stands in for the native disclosure handler, not plugin DOM mutation.
    event.currentTarget.removeAttribute('hidden')
  })
  let current = true
  const navigator = createSourceNavigator({ binding: { sessionId: 's', session: { loadThrough }, eventSource: { getSnapshot: () => ({ entries: entries ?? [{ event: { seq: 42, type: 'user/message' } }] }) } },
    conversation: { snapshot: { getSnapshot: () => ({ views: { get: () => ({ nodes: { values: () => nodes ?? [{ key: 'exact', kind: 'user', data: { seq: 42 } }] } }) } }) } }, isCurrent: () => current })
  return { navigator, host, card, scroll, loadThrough, switchSession: () => { current = false; navigator.cancel() } }
}

test('historical messages expand outer disclosures first and scroll the exact source', async () => {
  vi.useFakeTimers()
  const value = fixture()
  const promise = value.navigator.reveal(42)
  await vi.runAllTimersAsync()
  expect(await promise).toMatchObject({ seq: 42, id: 'exact' })
  expect(value.loadThrough).toHaveBeenCalledWith(42)
  expect(value.card.closest('[hidden]')).toBeNull()
  expect(value.scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' })
  value.navigator.dispose()
})

test('load completion after a session switch or disposal cannot revive navigation', async () => {
  for (const mode of ['switch', 'dispose']) {
    let resolve
    const value = fixture({ loadThrough: () => new Promise(done => { resolve = done }) })
    const promise = value.navigator.reveal(42).catch(error => error)
    if (mode === 'switch') value.switchSession()
    else value.navigator.dispose()
    resolve()
    expect((await promise).code).toBe('jumpCancelled')
    expect(value.scroll).not.toHaveBeenCalled()
    value.navigator.dispose()
  }
})

test('a newer click cancels the prior load and a missing chat node is reported truthfully', async () => {
  vi.useFakeTimers()
  let resolve
  const value = fixture({ loadThrough: vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(undefined) })
  const old = value.navigator.reveal(42).catch(error => error)
  const next = value.navigator.reveal(42)
  resolve()
  await vi.runAllTimersAsync()
  expect((await old).code).toBe('jumpCancelled')
  expect(await next).toMatchObject({ seq: 42 })
  value.navigator.dispose()
  const missing = fixture({ nodes: [] })
  const promise = missing.navigator.reveal(42).catch(error => error)
  await vi.runAllTimersAsync()
  expect((await promise).code).toBe('jumpMissing')
  expect(missing.scroll).not.toHaveBeenCalled()
  missing.navigator.dispose()
})

test('matching outside the chat viewport does not count as successful navigation', async () => {
  vi.useFakeTimers()
  const value = fixture()
  value.card.getBoundingClientRect = () => ({ top: 900, bottom: 1000, left: 20, right: 320 })
  const promise = value.navigator.reveal(42).catch(error => error)
  await vi.runAllTimersAsync()
  expect((await promise).code).toBe('jumpUnsettled')
  value.navigator.dispose()
})

test('a historical child result loads its missing parent without changing exact target identity', async () => {
  vi.useFakeTimers()
  const loadThrough = vi.fn(async () => {})
  const value = fixture({ loadThrough, entries: [{ event: { seq: 42, type: 'tool/result', data: { callId: 'child', rootCallId: 'root' } } }] })
  value.card.removeAttribute('data-chat-node-key')
  value.card.setAttribute('data-chat-call-id', 'child')
  const promise = value.navigator.reveal(42)
  await vi.runAllTimersAsync()
  expect(await promise).toMatchObject({ seq: 42, id: 'child' })
  expect(loadThrough.mock.calls).toEqual([[42], [0]])
  value.navigator.dispose()
})

test('request, checkpoint and tool identities never fall back to a nearby message', () => {
  const entries = [
    { event: { seq: 1, type: 'request/header' } }, { event: { seq: 2, type: 'user/message' } },
    { event: { seq: 3, type: 'assistant/message' } }, { event: { seq: 4, type: 'tool/result', data: { callId: 'child:unsafe"id' } } },
  ]
  const nodes = [{ key: 'request', kind: 'system-prompt', id: '1', anchorSeq: 0 }, { key: 'checkpoint', kind: 'manual-compaction', data: { compaction: { seq: 2 } } },
    { key: 'assistant', kind: 'assistant-step', data: { finalNode: { seq: 3 } } }]
  expect(sourceTarget(1, entries, nodes)).toEqual({ attribute: 'data-chat-node-key', id: 'request' })
  expect(sourceTarget(2, entries, nodes)?.id).toBe('checkpoint')
  expect(sourceTarget(3, entries, nodes)?.id).toBe('assistant')
  expect(sourceTarget(4, entries, nodes)).toEqual({ attribute: 'data-chat-call-id', id: 'child:unsafe"id' })
  expect(sourceTarget(1, entries, nodes.filter(node => node.key !== 'request'))).toBeNull()
  expect(sourceTarget(99, entries, nodes)).toBeNull()
})
