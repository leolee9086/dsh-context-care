/**
 * Pressure admission for the one maintenance controller.
 *
 * The controller remembers only whether maintenance is armed. It enters at the
 * hard limit and clears below a lower recovery limit, so one boundary cannot
 * oscillate between maintenance and normal work when pruning changes a few
 * tokens at a time.
 */

export const DEFAULT_MAINTENANCE = Object.freeze({
  softBudgetRatio: 0.72,
  hardBudgetRatio: 0.8,
  hysteresisRatio: 0.05,
  maxPasses: 2,
  auxiliaryBudgetRatio: 0.12,
})

/** Validate the maintenance fields without accepting unrelated configuration. */
export function resolveMaintenanceConfig(raw = {}) {
  const spec = { ...DEFAULT_MAINTENANCE, ...raw }
  const keys = Object.keys(DEFAULT_MAINTENANCE)
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) throw new Error(`context-care: unknown maintenance config ${key}`)
  }
  for (const key of ['softBudgetRatio', 'hardBudgetRatio', 'hysteresisRatio', 'auxiliaryBudgetRatio']) {
    if (!Number.isFinite(spec[key]) || spec[key] < 0 || spec[key] >= 1) {
      throw new Error(`context-care: ${key} must be between 0 and 1`)
    }
  }
  if (spec.softBudgetRatio <= 0 || spec.softBudgetRatio >= spec.hardBudgetRatio) {
    throw new Error('context-care: softBudgetRatio must be below hardBudgetRatio')
  }
  if (spec.softBudgetRatio - spec.hysteresisRatio <= 0) {
    throw new Error('context-care: hysteresisRatio leaves no positive recovery budget')
  }
  if (!Number.isSafeInteger(spec.maxPasses) || spec.maxPasses < 1) {
    throw new Error('context-care: maxPasses must be a positive integer')
  }
  return Object.freeze(spec)
}

/**
 * Create a hysteresis gate for measured request pressure.
 * @param {object} [config] resolved or raw maintenance configuration
 * @returns {{observe: (totalTokens: number, capacity: number) => object, reset: () => void}}
 */
export function createMaintenanceController(config = {}) {
  const spec = resolveMaintenanceConfig(config)
  let armed = false

  function observe(totalTokens, capacity) {
    if (!Number.isFinite(totalTokens) || !Number.isFinite(capacity) || capacity <= 0) {
      return { phase: 'unknown', ratio: null, shouldMaintain: false, armed }
    }
    const ratio = Math.max(0, totalTokens) / capacity
    const recoveryRatio = spec.softBudgetRatio - spec.hysteresisRatio
    if (armed) {
      if (ratio <= recoveryRatio) armed = false
    } else if (ratio >= spec.hardBudgetRatio) {
      armed = true
    }
    return {
      phase: ratio >= spec.hardBudgetRatio ? 'hard' : ratio >= spec.softBudgetRatio ? 'soft' : 'normal',
      ratio,
      shouldMaintain: armed,
      armed,
      recoveryRatio,
    }
  }

  function observeBudget(budget) {
    if (budget.capacity === undefined) return budget
    if (armed) {
      if (budget.inputTokens < budget.releaseTarget) armed = false
    } else if (budget.inputTokens >= budget.softInput) armed = true
    return { ...budget, shouldMaintain: armed, armed }
  }
  return { observe, observeBudget, reset: () => { armed = false } }
}

/**
 * Prune once, then measure again before deciding whether summarization remains needed.
 * The caller owns the real session and meter; this helper only sequences their operations.
 * @param {object} input
 * @returns {Promise<object>} measurements and the remaining pressure decision
 */
export async function pruneThenMeasure({ session, measure, pruner, controller }) {
  const before = await measure()
  const initial = before.budget === undefined ? controller.observe(before.totalTokens, before.capacity) : controller.observeBudget(before.budget)
  if (!initial.shouldMaintain || pruner?.pruneSession === undefined) {
    return { before, after: before, pruned: null, pressure: initial }
  }
  const pruned = await pruner.pruneSession(session)
  const after = await measure()
  const pressure = after.budget === undefined ? controller.observe(after.totalTokens, after.capacity) : controller.observeBudget(after.budget)
  return { before, after, pruned, pressure }
}
