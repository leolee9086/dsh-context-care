import React from 'react'
import { CareStyles } from './care-styles.js'

export const DISPLAY_NODE = 'context-care-display-copy'
export const DISPLAY_TAB = 'dsh-context-care:display'
/** Native messages remain unchanged; a node is only a seat for an existing processing marker. */
export function createDisplayDefinition() {
  return {
    kind: DISPLAY_NODE, target: 'chat',
    match: event => ['assistant/message', 'user/message', 'system/message', 'tool/result'].includes(event.type)
      ? { id: `display:${event.seq}`, role: 'start' } : null,
    start: (_context, match) => ({ seq: match.event.seq }), update: context => context.state,
    buildViewNode(context) {
      const start = context.start
      if (!start) return null
      return { key: context.key, kind: DISPLAY_NODE, id: context.id, target: 'chat', anchorSeq: start.event.seq,
        location: start.location, visibility: 'visible', data: { seq: start.event.seq } }
    },
  }
}

/** Rendering a message performs no HTTP read. Only known changes/failures produce a marker. */
export function DisplayNodeView({ node, sessionId, useCareActions, openDisplay, t }) {
  const seq = node.data.seq
  const health = useCareActions(value => value.get(`${sessionId}:0`))
  const failed = health?.matchingFailures?.some(value => value.sourceSeqs.includes(seq))
  const changed = health?.displayMarkers?.includes(seq)
  if (!changed && !failed) return null
  return React.createElement('button', { type: 'button', 'data-context-care-marker': seq,
    onClick: () => openDisplay(sessionId, seq) }, t(failed ? 'processingFailed' : 'displayChanged'), ' →')
}

/** Comparison content lives exclusively in the selected right sidebar. */
export function DisplayDetails({ sessionId, useDisplaySelection, useDisplayRecords, useCareActions, watchDisplay, refreshDisplay, t }) {
  const seq = useDisplaySelection(value => value.get(sessionId))
  const health = useCareActions(value => value.get(`${sessionId}:0`))
  const failures = health?.matchingFailures?.filter(value => value.sourceSeqs.includes(seq)) ?? []
  React.useEffect(() => Number.isSafeInteger(seq) ? watchDisplay(sessionId, 0, seq) : undefined, [sessionId, seq, watchDisplay])
  const record = useDisplayRecords(value => value.get(`${sessionId}:0:${seq}`))
  const column = (key, blocks) => React.createElement('details', { key, open: true },
    React.createElement('summary', null, t(key)), blocks.length ? blocks.map(block => React.createElement('div', { key: block.id },
      React.createElement('small', null, `${block.role} · ${block.type}`),
      React.createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, block.text ?? t('displayNontext')))) : React.createElement('p', null, t('displayEmpty')))
  const projection = record?.projections?.find(value => value.seq === seq)
  return React.createElement('section', { 'data-care-panel': '', 'aria-label': t('displayTitle') }, React.createElement(CareStyles),
    React.createElement('header', null, React.createElement('h3', null, t('displayTitle')),
      Number.isSafeInteger(seq) ? React.createElement('button', { type: 'button', onClick: () => refreshDisplay(sessionId, 0, seq) }, t('actionsRefresh')) : null),
    failures.map(failure => React.createElement('details', { key: failure.id, open: true },
      React.createElement('summary', null, t('processingFailed'), ` · ${failure.count ?? 1}`),
      React.createElement('pre', null, JSON.stringify(failure.diagnostic, null, 2)))),
    !Number.isSafeInteger(seq) ? React.createElement('p', null, t('displaySelect'))
      : record?.status === 'error' ? React.createElement('div', { role: 'alert' }, React.createElement('p', null, t('displayUnavailable')),
        record.phase ? React.createElement('p', null, t(`displayFailure_${record.phase}`), record.httpStatus === undefined ? '' : ` · HTTP ${record.httpStatus}`) : null,
        React.createElement('pre', null, record.route, '\n', record.error))
      : !record || record.status === 'loading' ? React.createElement('p', { role: 'status' }, t('actionsLoading'))
      : projection ? React.createElement('div', null, React.createElement('p', null, t('displayExplanation')), column('displayOriginal', projection.before), column('displayTransformed', projection.after))
      : React.createElement('p', null, t('displayUnchanged')))
}
