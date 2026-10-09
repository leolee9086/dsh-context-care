import { GUIDANCE, renderState } from './policy.js'

export const CARE_SOURCE = 'dsh-context-care'
export const LEGACY_SOURCE = 'memoryNoticeRules'
export const LOOP_IDS = ['line-repeat', 'filler-lines', 'line-cycle', 'prefix-monotony']
const GUIDANCE_IDS = ['meaning', 'capacity', 'continuity', 'handoff', 'automatic', 'labels', 'pressure', 'hesitation']
const action = (id, extra = {}) => ({ id, defaultEnabled: true, available: true, requires: [], ...extra })
const rule = (id, actions) => ({ id, title: `control_${id}`, actions })

/** Current executors describe only the rules actually visible to this session's owner. */
export function runtimeControlSource({ prompts, cleanupActive, pruner, compaction }) {
  return { sourceId: CARE_SOURCE, plugin: CARE_SOURCE, registration: 'runtime/agent', executor: CARE_SOURCE, rules: [
    rule('state', [action('report'), action('advice')]),
    ...GUIDANCE_IDS.map(id => rule(`guidance-${id}`, [action('notice')])),
    ...['time-anxiety', 'context-anxiety'].map(id => rule(`stream-${id}`, [action('notice')])),
    rule('stream-line-repeat', [action('notice'), action('abort'), action('resume', { requires: ['abort'] })]),
    ...LOOP_IDS.map(id => rule(`loop-${id}`, [action('notice'), ...(id === 'line-repeat' || id === 'filler-lines'
      ? [action('clean', { available: cleanupActive, reason: 'executor-unavailable' })] : [])])),
    rule('maintenance', [action('prune', { available: pruner, reason: 'executor-unavailable' }),
      action('summary', { available: compaction, reason: 'executor-unavailable' })]),
    rule('overflow', [action('prune', { available: pruner, reason: 'executor-unavailable' }),
      action('summary', { available: compaction, reason: 'executor-unavailable' }), action('retry')]),
    ...prompts.map(prompt => ({ id: `prompt:${prompt.ruleId}`, title: prompt.ruleId,
      description: `${prompt.provider}/${prompt.model} · ${prompt.trigger}`, actions: [action('notice')] })),
  ] }
}

/** Legacy pure-data rules retain their service identity; unknown registrants remain explicit null. */
export function legacyControlSource(rules = [], cleanupActive) {
  return { sourceId: LEGACY_SOURCE, plugin: null, registration: LEGACY_SOURCE, executor: CARE_SOURCE,
    rules: rules.filter(rule => ['notify', 'transform'].includes(rule.action?.kind)).map(rule => ({ id: rule.id, title: rule.id,
      actions: [action(rule.action.kind, { available: rule.action.by === 'context-care' && (rule.action.kind !== 'transform' || cleanupActive),
        reason: 'executor-unavailable' })], definition: rule })) }
}

/** Resolve notification and transform definitions with namespaced engine IDs before engine bookkeeping. */
export function controlledEngineRules(controls, sessionId, kind, evidence) {
  if (!sessionId) return []
  return controls.catalog(sessionId).flatMap(source => source.rules.filter(rule => rule.definition?.action?.kind === kind && rule.definition.action.by === 'context-care'
    && controls.enabled(sessionId, source.sourceId, rule.id, kind)
    && (evidence === undefined || ((evidence.userSeq === undefined || evidence.userSeq > controls.sinceSeq(sessionId, source.sourceId, rule.id))
      && (rule.definition.when?.produced === undefined || (evidence.assistantSeq !== undefined && evidence.assistantSeq > controls.sinceSeq(sessionId, source.sourceId, rule.id)))))).map(rule => ({ ...rule.definition,
      id: source.sourceId === LEGACY_SOURCE ? rule.id : JSON.stringify([source.sourceId, rule.id]), action: { ...rule.definition.action } })))
}

/** Dynamic prompt text is resolved during assembly; already logged snapshots remain historical facts. */
export function controlledGuidance(enabled) {
  const [heading, ...lines] = GUIDANCE.split('\n')
  const active = lines.filter((_, index) => enabled(`guidance-${GUIDANCE_IDS[index]}`, 'notice'))
  return active.length ? [heading, ...active].join('\n') : ''
}

/** Preserve explicit outcomes while independently selecting automatic facts and advice. */
export function controlledState(state, outcome, enabled, explicit = false) {
  return renderState(state, outcome, { report: explicit || enabled('state', 'report'), advice: enabled('state', 'advice') })
}
