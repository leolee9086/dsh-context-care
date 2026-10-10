/** Load the shipped Client unchanged and inspect its registered reader without rendering a substitute. */
export async function loadArtifactReader(candidate) {
  const script = path => new Promise((resolve, reject) => {
    const element = document.createElement('script')
    element.src = path; element.onload = resolve; element.onerror = () => reject(new Error(`Script unavailable: ${path}`))
    document.head.append(element)
  })
  await script('./react.js')
  let plugin
  window.__ModuleLoader__ = { load(row) {
    if (row.id !== 'dsh-context-care') throw new Error('Unexpected Client factory')
    plugin = row.factory(name => {
      if (name !== 'react') throw new Error(`Unexpected Client external: ${name}`)
      return window.React
    })
  } }
  await script('./client.js')
  const entries = []; const disposers = []; const dictionaries = new Map()
  const effect = callback => {
    const disposer = callback()
    if (typeof disposer === 'function') disposers.push(disposer)
    return disposer
  }
  // Only inspect actual registration metadata. Network and reader operations remain production code.
  // Official Slot/Sidebar rendering has separate Client assembly coverage; this fixture does not claim it.
  const ctx = {
    effect,
    locale: {
      register(name, values) { dictionaries.set(name, values.zh); return () => dictionaries.delete(name) },
      bind: name => key => dictionaries.get(name)?.[key] ?? key,
    },
    slots: {
      inject: (_name, register) => effect(register),
      register(entry) { entries.push(entry); return () => entries.splice(entries.indexOf(entry), 1) },
    },
    uiConversation: { events: { register: () => () => {} } },
    sidebarRightTabs: { register: () => () => {} },
  }
  plugin.apply(ctx)
  const entry = entries.find(row => row.name === (candidate ? 'sidebar.right.pane.tab' : 'conversation.chat.node')
    && row.key === (candidate ? 'dsh-context-care:display' : 'context-care-display-copy'))
  if (!entry) throw new Error('Actual display reader registration missing')
  const supplied = entry.inject()
  if (!supplied.hooks?.displayRecords || typeof supplied.watchDisplay !== 'function') throw new Error('Actual display reader unavailable')
  return { source: supplied.hooks.displayRecords, watch: supplied.watchDisplay,
    dispose() { for (const disposer of disposers.splice(0).reverse()) disposer() } }
}
