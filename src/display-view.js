import React from 'react'
import { CareStyles } from './care-styles.js'

export const DISPLAY_NODE = 'context-care-display-copy'
/** A separate comparison node references committed evidence; it never replaces a native renderer. */
export function createDisplayDefinition() {
  return {
    kind: DISPLAY_NODE, target: 'chat',
    match: event => ['assistant/message', 'user/message', 'system/message', 'tool/result'].includes(event.type)
      ? { id: `display:${event.seq}`, role: 'start' } : null,
    start: (_context, match) => ({ seq: match.event.seq }),
    update: context => context.state,
    buildViewNode(context) {
      const start = context.start
      if (!start) return null
      return { key: context.key, kind: DISPLAY_NODE, id: context.id, target: 'chat', anchorSeq: start.event.seq,
        location: start.location, visibility: 'visible', data: { seq: start.event.seq } }
    },
  }
}

/** Default to original/transformed comparison and escape all rule-produced text as ordinary text. */
export function DisplayNodeView({ node, sessionId, useDisplayRecords, watchDisplay, t }) {
  const seq = node.data.seq
  React.useEffect(() => watchDisplay(sessionId, 0, seq), [sessionId, seq, watchDisplay])
  const record = useDisplayRecords(value => value.get(`${sessionId}:0:${seq}`))
  if (!record || record.status === 'loading') return null
  if (record.status === 'error') return React.createElement('div', { 'data-care-card': '' }, React.createElement(CareStyles),
    React.createElement('strong', null, t('displayTitle')), React.createElement('p', { role: 'status' }, t('displayUnavailable')),
    React.createElement('details', null, React.createElement('summary', null, t('displayError')), record.error))
  const projection = record.projections?.find(value => value.seq === seq)
  if (!projection) return null
  const column = (key, blocks) => React.createElement('details', { key, open: true },
    React.createElement('summary', null, t(key)),
    blocks.length ? blocks.map(block => React.createElement('div', { key: block.id },
      React.createElement('small', null, `${block.role} · ${block.type}${block.path === undefined ? '' : ` · ${block.path}`}`),
      React.createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, block.text ?? t('displayNontext'))))
      : React.createElement('p', null, t('displayEmpty')))
  return React.createElement('article', { 'data-care-card': '', 'data-context-care-display-seq': seq }, React.createElement(CareStyles),
    React.createElement('strong', null, t('displayTitle')), React.createElement('p', null, t('displayExplanation')),
    column('displayOriginal', projection.before), column('displayTransformed', projection.after))
}
