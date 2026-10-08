import { h, badge, date, Section, TextReader, RawRecord, Fields, Sources, JumpButton, row, evidenceValue, useDetailHeading } from './care-ui.js'

/** Human titles are derived from recorded rule identity, not from body guesses. */
export function promptTitle(prompt, t) {
  const rule = prompt.segments?.[0]?.ruleId
  if (rule === 'completion-observation') return t('promptCompletion')
  if (rule === 'output-pattern') return t('promptPattern')
  if (prompt.producer === 'dsh-context-care:state') return t('promptState')
  if (prompt.producer === 'dsh-context-care:loop') return t('promptLoop')
  return prompt.title || t(`prompt_${prompt.kind}`)
}
const evidenceWithoutBody = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['text', 'sourceSeqs', 'segmentId', 'key', 'operationId', 'evaluationId', 'callId'].includes(key)))

export function PromptRecord({ prompt, t, revealSource, onBack }) {
  const heading = useDetailHeading()
  return h('article', { className: 'care-detail' }, onBack ? h('button', { type: 'button', className: 'care-back', onClick: onBack }, '← ', t('back')) : null,
    h('div', { className: 'care-detail-heading' }, h('div', { className: 'care-eyebrow' }, t(`prompt_${prompt.kind}`), ' · ', date(prompt.at)), h('h3', { tabIndex: -1, ref: heading }, promptTitle(prompt, t)),
      prompt.kind === 'request' ? h('p', { className: 'care-muted' }, t('requestOnly')) : null,
      // Only persisted request/message sequences are chat identities. System sections use log revisions.
      ['request', 'message', 'checkpoint'].includes(prompt.kind) ? h(JumpButton, { seq: prompt.seq, revealSource, t }) : null),
    h(Section, { title: t('evidence') },
      prompt.source?.contextCareTrace ? h(Fields, { value: evidenceWithoutBody(prompt.source.contextCareTrace), t }) : null,
      ...(prompt.segments ?? []).map((segment, index) => h('div', { className: 'care-evidence', key: index },
        h('h4', null, t('ruleName'), ' · ', evidenceValue(segment.ruleId, t)), h(Fields, { value: evidenceWithoutBody(segment), t }))),
      ...(prompt.evaluations ?? []).map((evaluation, index) => h('div', { className: 'care-evidence', key: index }, h('h4', null, t('promptsEvaluations')), h(Fields, { value: evidenceWithoutBody(evaluation), t }))),
      !prompt.source?.contextCareTrace && !prompt.segments?.length && !prompt.evaluations?.length ? h('p', { className: 'care-muted' }, t('promptsLegacyTrace')) : null),
    h(Section, { title: t('exactText') }, prompt.bodyStatus === 'segments-only' ? h('p', { className: 'care-muted' }, t('promptsSegmentsOnly')) : null,
      h(TextReader, { text: prompt.text, t })),
    h(Section, { title: t('requestRoute') }, (prompt.calls ?? []).length ? prompt.calls.map((call, index) => h('div', { key: index, className: 'care-request' },
      h('div', { className: 'care-route' }, call.route ? `${call.route.provider} / ${call.route.model}` : t('noRoute')),
      h('div', { className: 'care-request-state' }, badge(t(call.dispatched === true ? 'actionsSent' : call.dispatched === false ? 'actionsNotSent' : 'deliveryUnknown'), call.dispatched === true ? 'success' : undefined),
        h('span', { className: 'care-muted' }, call.phase ? evidenceValue(call.phase, t) : t('phaseUnknown'))))) : h('p', { className: 'care-muted' }, t('promptsNoCalls'))),
    h(Section, { title: t('promptsSources') }, (prompt.sources ?? []).length ? h(Sources, { sources: prompt.sources, t, revealSource }) : h('p', { className: 'care-muted' }, t('promptsNoSources'))),
    h('dl', { className: 'care-fields care-muted' }, row(t('producer'), prompt.producer)),
    h(RawRecord, { value: prompt, t }))
}
