import { matchConditionV2 } from '@leolee9086/dsh-rule-engine'

export interface RecipientIdentity {
  sessionId: string
  agentPreset?: string
  agentPresetName?: string
  provider?: string
  model?: string
}
export type RecipientFacts = Omit<RecipientIdentity, 'sessionId'>
const fields = {
  'session.sessionId': 'sessionId',
  'session.agentPreset': 'agentPreset',
  'session.agentPresetName': 'agentPresetName',
  'session.provider': 'provider',
  'session.model': 'model',
} as const
export type RecipientCondition =
  | { kind: 'all'; conditions: RecipientCondition[] }
  | { kind: 'any'; conditions: RecipientCondition[] }
  | { kind: 'not'; condition: RecipientCondition }
  | { kind: 'compare'; field: keyof typeof fields; op: 'exists' }
  | { kind: 'compare'; field: keyof typeof fields; op: 'eq' | 'ne' | 'contains'; value: string }
export type RecipientScope = {
  sessionIds?: string[]
  agentPresets?: string[]
  condition?: RecipientCondition
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('reminder scope must be an object')
  return input as Record<string, unknown>
}
function keys(input: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new TypeError(`unknown reminder scope field: ${key}`)
}
function list(name: string, value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) throw new TypeError(`${name} must be a non-empty array with at most 128 entries`)
  const values: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 256) {
      throw new TypeError(`${name} entries must be non-empty strings up to 256 characters`)
    }
    if (!values.includes(item)) values.push(item)
  }
  return values
}
function isField(value: unknown): value is keyof typeof fields {
  return typeof value === 'string' && Object.hasOwn(fields, value)
}

/** Recipient conditions use the engine's boolean/comparison syntax over current session facts. */
function condition(input: unknown, budget: { nodes: number }, depth = 0): RecipientCondition {
  if (++budget.nodes > 128 || depth > 16) throw new TypeError('reminder scope condition exceeds 128 nodes or depth 16')
  const value = object(input)
  if (value.kind === 'all' || value.kind === 'any') {
    keys(value, ['kind', 'conditions'])
    if (!Array.isArray(value.conditions) || !value.conditions.length || value.conditions.length > 64) throw new TypeError('scope group requires 1..64 conditions')
    return { kind: value.kind, conditions: value.conditions.map(child => condition(child, budget, depth + 1)) }
  }
  if (value.kind === 'not') {
    keys(value, ['kind', 'condition'])
    return { kind: 'not', condition: condition(value.condition, budget, depth + 1) }
  }
  if (value.kind !== 'compare' || !isField(value.field)) throw new TypeError('scope condition requires a supported session field and comparison')
  if (value.op === 'exists') {
    keys(value, ['kind', 'field', 'op'])
    return { kind: 'compare', field: value.field, op: 'exists' }
  }
  keys(value, ['kind', 'field', 'op', 'value'])
  const op = value.op
  if ((op !== 'eq' && op !== 'ne' && op !== 'contains') || typeof value.value !== 'string' || value.value.length > 4096) {
    throw new TypeError('scope comparison requires eq/ne/contains and a string up to 4096 characters')
  }
  return { kind: 'compare', field: value.field, op, value: value.value }
}

/** Parse external recipient configuration before it enters the runtime. */
export function normalizeScope(input: unknown = {}): RecipientScope {
  const value = object(input)
  keys(value, ['sessionIds', 'agentPresets', 'condition'])
  const sessionIds = list('sessionIds', value.sessionIds), agentPresets = list('agentPresets', value.agentPresets)
  return { ...(sessionIds === undefined ? {} : { sessionIds }), ...(agentPresets === undefined ? {} : { agentPresets }),
    ...(value.condition === undefined ? {} : { condition: condition(value.condition, { nodes: 0 }) }) }
}

function matchesCondition(identity: RecipientIdentity, node: RecipientCondition): boolean {
  if (node.kind === 'all') return node.conditions.every(child => matchesCondition(identity, child))
  if (node.kind === 'any') return node.conditions.some(child => matchesCondition(identity, child))
  if (node.kind === 'not') return !matchesCondition(identity, node.condition)
  // An absent fact cannot satisfy a comparison, including ne. `not exists` selects absence explicitly.
  if (identity[fields[node.field]] === undefined) return false
  return matchConditionV2(node, { session: { ...identity } }).ok
}

/** Every declared dimension intersects; names and model IDs are case-sensitive. */
export function matchesScope(identity: RecipientIdentity, scope: RecipientScope) {
  if (scope.sessionIds !== undefined && !scope.sessionIds.includes(identity.sessionId)) return false
  if (scope.agentPresets !== undefined &&
      (identity.agentPreset === undefined || !scope.agentPresets.includes(identity.agentPreset))) return false
  return scope.condition === undefined || matchesCondition(identity, scope.condition)
}
