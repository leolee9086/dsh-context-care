// Test renderer binds the production components' observable seats to real Host reads.
import React, { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { DisplayNodeView, DisplayDetails } from '../src/display-view.js'
import { createDisplayRecords } from '../src/display-records.js'
import { dictionaries } from '../src/client-view.js'

const { sessionId, seq } = window.testIdentity
const display = createDisplayRecords()
let health = new Map(); const listeners = new Set()
const healthSource = { getSnapshot: () => health, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
const useCareActions = selector => selector(useSyncExternalStore(healthSource.subscribe, healthSource.getSnapshot))
const useDisplayRecords = selector => selector(useSyncExternalStore(display.source.subscribe, display.source.getSnapshot))
const t = key => dictionaries.zh[key] ?? key
function App() {
  const [selected, setSelected] = useState(null)
  return React.createElement('main', null,
    React.createElement('pre', { 'data-original': '' }, 'ORIGINAL'),
    React.createElement(DisplayNodeView, { node: { data: { seq } }, sessionId, useCareActions, openDisplay: (_id, next) => setSelected(next), t }),
    selected === null ? null : React.createElement('aside', null, React.createElement(DisplayDetails, { sessionId,
      useDisplaySelection: selector => selector(new Map([[sessionId, selected]])), useDisplayRecords, useCareActions,
      watchDisplay: display.watch, refreshDisplay: display.refresh, t })))
}
createRoot(document.querySelector('#root')).render(React.createElement(App))
const response = await fetch(`/context-care/actions?sessionId=${encodeURIComponent(sessionId)}&limit=20`)
if (!response.ok) throw new Error(`Health: HTTP ${response.status}`)
health = new Map([[`${sessionId}:0`, { status: 'ready', ...await response.json() }]])
for (const listener of listeners) listener()
window.readerReady = true
