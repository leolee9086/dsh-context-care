/** S-forge curves, separated from host lifecycle and model-facing text. */
export function resolveConfig(raw = {}) {
  const spec = {
    budgetRatio: 0.8,
    wakefulnessRatio: 1 / 3,
    fatigueExponent: 1.5,
    retainRatio: 0.16,
    minFreshTokens: 1024,
    maxNoteChars: 4000,
    ...raw,
  }
  for (const key of Object.keys(raw)) {
    if (!['budgetRatio', 'wakefulnessRatio', 'fatigueExponent', 'retainRatio', 'minFreshTokens', 'maxNoteChars'].includes(key)) {
      throw new Error(`context-care: unknown config ${key}`)
    }
  }
  for (const key of ['budgetRatio', 'wakefulnessRatio', 'retainRatio']) {
    if (!Number.isFinite(spec[key]) || spec[key] <= 0 || spec[key] >= 1) {
      throw new Error(`context-care: ${key} must be between 0 and 1`)
    }
  }
  if (spec.retainRatio >= spec.budgetRatio) throw new Error('context-care: retainRatio must be below budgetRatio')
  if (!Number.isFinite(spec.fatigueExponent) || spec.fatigueExponent <= 0) throw new Error('context-care: invalid fatigueExponent')
  for (const key of ['minFreshTokens', 'maxNoteChars']) {
    if (!Number.isSafeInteger(spec[key]) || spec[key] <= 0) throw new Error(`context-care: ${key} must be a positive integer`)
  }
  return Object.freeze(spec)
}

/** Values describe measured load and retained information volume, not cognitive quality. */
export function calculateState(totalTokens, historyTokens, capacity, spec) {
  if (!Number.isFinite(capacity) || capacity <= 0) return { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null }
  const rounded = value => Math.round(Math.min(100, value) * 10) / 10
  const fatigueValue = rounded(100 * (Math.max(0, totalTokens) / (capacity * spec.budgetRatio)) ** spec.fatigueExponent)
  const wakefulnessValue = rounded(100 * Math.sqrt(Math.max(0, historyTokens) / (capacity * spec.wakefulnessRatio)))
  const level = value => value < 30 ? 0 : value < 60 ? 1 : value < 85 ? 2 : 3
  return {
    fatigue: ['normal', 'elevated', 'high', 'very-high'][level(fatigueValue)],
    fatigueValue,
    wakefulness: ['low', 'normal', 'elevated', 'high'][level(wakefulnessValue)],
    wakefulnessValue,
  }
}

export const GUIDANCE = `Context care (fatigue / wakefulness):
These are load and retained-information estimates, not evidence of memory loss, hallucinations, impaired ability, or a task deadline. Do not infer remaining capacity from conversation length or an internal feeling of running out.
Continue the task normally. Low wakefulness only means less retained context; consult the checkpoint or relevant files when facts are missing, without inventing details or padding the conversation.
You may call context_rest at a useful task boundary, even before fatigue is high. Include a concise continuation note with the current objective, verified progress, unresolved work and important paths. Preserve irreplaceable details in files first. A request is not a completed compaction; wait for the next status report, then continue work.
Existing automatic compaction remains the capacity fallback. Do not rush, stop, or repeatedly compact solely because of a status label.`

/** Bounded, cache-stable status text: no raw remaining-token countdown. */
export function renderState(state, outcome) {
  const lines = [
    '<context-care>',
    `Fatigue: ${state.fatigue}; wakefulness: ${state.wakefulness}.`,
    'Estimate based on the latest recorded request and currently retained history, not a task deadline.',
  ]
  if (state.fatigue === 'unknown') lines.push('Capacity is not calibrated for this request. Do not guess it.')
  if (outcome) lines.push(`Rest outcome: ${outcome}.`)
  lines.push('Continue the task; use context_rest when a checkpoint would help.', '</context-care>')
  return lines.join('\n')
}
