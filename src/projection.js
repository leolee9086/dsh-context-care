import { z } from 'zod'

const level = z.enum(['unknown', 'low', 'normal', 'elevated', 'high', 'very-high'])
const value = z.number().min(0).max(100).nullable()
const schema = z.object({ fatigue: level, fatigueValue: value, wakefulness: level, wakefulnessValue: value, sampledSeq: z.number().int().nonnegative() }).nullable()

/** Numeric UI samples live in message provenance, outside model-facing text. */
export const contextCareProjection = {
  key: 'contextCareNumeric',
  stateVersion: 1,
  stateSchema: schema,
  init: () => null,
  apply(state, event) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== 'dsh-context-care:state') return state
    const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const match = /^<context-care>\nFatigue: (unknown|normal|elevated|high|very-high); wakefulness: (unknown|low|normal|elevated|high)\./.exec(text)
    if (!match) return state
    // Old events have grades only. Never manufacture a number from a grade.
    const sample = event.data.source.contextCare
    const numeric = input => typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= 100 ? input : null
    return { fatigue: match[1], fatigueValue: numeric(sample?.fatigueValue), wakefulness: match[2], wakefulnessValue: numeric(sample?.wakefulnessValue), sampledSeq: event.seq }
  },
  wire: { viewSchema: schema, view: state => state },
}
