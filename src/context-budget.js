/** Complete input admission limits; these functions never mutate a session. */
export const BUDGET_DEFAULTS = Object.freeze({ safetyTokens: 0, burstTokens: 0, releaseMarginTokens: 0, maxOverflowRetries: 1 })

/** Resolve one exact route and purpose; duplicate policies fail at configuration load. */
export function resolveBudgetConfig(raw = {}) {
  const result = { ...BUDGET_DEFAULTS, ...raw }
  for (const field of ['safetyTokens', 'burstTokens', 'releaseMarginTokens', 'maxOverflowRetries', 'retainTokens', 'contextBudgetTokens', 'billingInputCeilingTokens', 'summarySafetyTokens']) {
    if (result[field] !== undefined && (!Number.isSafeInteger(result[field]) || result[field] < 0 || (['contextBudgetTokens', 'billingInputCeilingTokens'].includes(field) && result[field] === 0))) {
      throw new Error(`context-care: ${field} must be ${field.endsWith('CeilingTokens') || field === 'contextBudgetTokens' ? 'positive' : 'nonnegative'} safe integer`)
    }
  }
  const seen = new Set()
  for (const policy of result.routeBudgets ?? []) {
    if (typeof policy.provider !== 'string' || !policy.provider.trim() || typeof policy.model !== 'string' || !policy.model.trim()) throw new Error('context-care: routeBudgets requires exact provider and model')
    if (!['conversation', 'compaction', 'session-title'].includes(policy.purpose)) throw new Error('context-care: routeBudgets requires explicit purpose')
    const key = JSON.stringify([policy.provider, policy.model, policy.purpose])
    if (seen.has(key)) throw new Error('context-care: duplicate route budget ' + key)
    seen.add(key)
    for (const field of Object.keys(policy)) if (!['provider', 'model', 'purpose', 'contextBudgetTokens', 'billingInputCeilingTokens'].includes(field)) throw new Error(`context-care: unknown route budget field ${field}`)
    resolveBudgetConfig({ contextBudgetTokens: policy.contextBudgetTokens, billingInputCeilingTokens: policy.billingInputCeilingTokens })
  }
  return result
}

/** Match only the actual route; auxiliary calls never inherit another route's capacity. */
export function budgetPolicy(spec, route, purpose = 'conversation') {
  const policy = spec.routeBudgets?.find(item => item.provider === route.provider && item.model === route.model && item.purpose === purpose)
  return { contextBudgetTokens: policy?.contextBudgetTokens ?? spec.contextBudgetTokens,
    billingInputCeilingTokens: policy?.billingInputCeilingTokens ?? spec.billingInputCeilingTokens }
}

/** Calculate admission from complete input Q and the current operation's explicit allowances. */
export function contextBudget({ inputTokens, physicalCapacity, policyCapacity, billingInputCeilingTokens, maxTokens, defaultMaxTokens, safetyTokens = 0, burstTokens = 0, releaseMarginTokens = 0, softRatio = 0.8, retainRatio = 0.16, retainTokens, active = false }) {
  const input = Math.ceil(inputTokens)
  if (!Number.isFinite(input) || input < 0) throw new Error('context-care: invalid complete input price')
  const physical = Number.isFinite(physicalCapacity) && physicalCapacity > 0 ? physicalCapacity : undefined
  const capacities = [physical, policyCapacity].filter(value => value !== undefined)
  if (!capacities.length) return { phase: 'unknown', inputTokens: input, capacity: undefined, shouldMaintain: false, hardInput: undefined }
  const capacity = Math.min(...capacities)
  const reservation = maxTokens ?? defaultMaxTokens ?? 0
  const hardInput = Math.min(capacity - reservation - safetyTokens, billingInputCeilingTokens === undefined ? Infinity : billingInputCeilingTokens - safetyTokens)
  const physicalInput = physical === undefined ? undefined : physical - reservation - safetyTokens
  const softInput = Math.min(Math.floor(softRatio * capacity), hardInput - burstTokens)
  const tail = retainTokens ?? Math.floor(retainRatio * (capacity - reservation))
  const releaseTarget = softInput - releaseMarginTokens
  if (hardInput <= 0 || softInput <= 0 || softInput > hardInput || tail < 0 || tail >= softInput || releaseTarget <= 0) {
    throw new Error(`context-care: invalid resolved budget (capacity=${capacity}, maxTokens=${reservation}, safetyTokens=${safetyTokens}, burstTokens=${burstTokens}, retainTokens=${tail}, releaseMarginTokens=${releaseMarginTokens})`)
  }
  const physicalExceeded = physicalInput !== undefined && input > physicalInput
  const policyExceeded = (policyCapacity !== undefined && input > policyCapacity - reservation - safetyTokens)
    || (billingInputCeilingTokens !== undefined && input > billingInputCeilingTokens - safetyTokens)
  return Object.freeze({ inputTokens: input, capacity, physicalCapacity: physical, policyCapacity,
    completionTokens: reservation, completionSource: maxTokens !== undefined ? 'explicit' : defaultMaxTokens !== undefined ? 'adapter-default' : 'absent',
    hardInput, physicalInput, softInput, retainTail: tail, releaseTarget,
    shouldMaintain: input >= (active ? releaseTarget : softInput),
    phase: input > hardInput ? 'hard' : input >= softInput ? 'soft' : 'normal',
    hardDeficit: Math.max(0, input - hardInput), physicalDeficit: physicalInput === undefined ? undefined : Math.max(0, input - physicalInput),
    budgetKind: physicalExceeded && policyExceeded ? 'both' : physicalExceeded ? 'physical' : policyExceeded ? 'policy' : undefined,
  })
}

/** Local admission failure flows through the ordinary terminal failure and recovery chain. */
export class RequestBudgetExceeded extends Error {
  constructor(budget) {
    super(`Request input ${budget.inputTokens} exceeds hard input budget ${budget.hardInput}`)
    this.name = 'RequestBudgetExceeded'
    this.code = 'REQUEST_BUDGET_EXCEEDED'
    // The public terminal-error protocol carries matching own code/failure data
    // across independently installed package copies; class identity is unnecessary.
    this.failure = Object.freeze({ code: this.code, message: this.message })
    this.origin = 'preflight'
    this.budget = budget
    this.budgetKind = budget.budgetKind
  }
}
