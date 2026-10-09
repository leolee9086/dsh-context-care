import { sanitizeRegexMacro } from './regex.js'

export const V2_STAGES = ['request.assemble', 'output.complete', 'tool.result', 'tool.before-execute', 'display.render', 'output.delta']
export const V2_ACTIONS = ['notify', 'guidance', 'inject', 'replace', 'filter', 'program', 'tool', 'job', 'set-variable', 'abort', 'resume', 'compact']
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`rules-v2: ${label} must be an object`)
  return value
}
function id(value, label) {
  if (typeof value !== 'string' || !value || value.length > 256) throw new TypeError(`rules-v2: invalid ${label}`)
  return value
}
function one(value, choices, label) {
  if (!choices.includes(value)) throw new TypeError(`rules-v2: unsupported ${label}: ${value}`)
  return value
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`rules-v2: invalid ${label}`)
  return value
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`rules-v2: unknown ${label}.${key}`)
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`rules-v2: ${label} must be boolean`)
}
function text(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit) throw new TypeError(`rules-v2: invalid ${label}`)
}
function path(value, label) {
  text(value, 1024, label)
  const parts = value.startsWith('/') ? value.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~')) : value.split('.')
  if (parts.some(part => forbidden.has(part))) throw new TypeError(`rules-v2: forbidden ${label}`)
  if (!value || parts.some(part => !part)) throw new TypeError(`rules-v2: invalid ${label}`)
}
/** Reject lossy values before clone/queue serialization; plugins must register owned JSON declarations. */
function json(value, label, depth = 0, seen = new Set()) {
  if (depth > 32) throw new TypeError(`rules-v2: ${label} exceeds JSON nesting limit`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError(`rules-v2: ${label} must be acyclic JSON`)
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`rules-v2: ${label} must be plain JSON`)
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || forbidden.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`rules-v2: invalid ${label} property`)
    json(descriptor.value, label, depth + 1, seen)
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new TypeError(`rules-v2: ${label} must be a dense array`)
  seen.delete(value)
}
function bindings(value, label, depth = 0) {
  if (depth > 32) throw new TypeError(`rules-v2: ${label} exceeds binding nesting limit`)
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && Object.hasOwn(value, 'bind')) { keys(value, ['bind'], 'binding'); path(value.bind, 'binding path') }
    else for (const child of Object.values(value)) bindings(child, label, depth + 1)
  }
}
/** Read own properties only. Missing paths are errors, not invented empty values. */
export function readBinding(root, path) {
  if (typeof path !== 'string' || path.length > 1024) throw new TypeError('rules-v2: invalid binding path')
  const parts = path.startsWith('/') ? path.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~')) : path.split('.')
  let value = root
  for (const part of parts) {
    if (forbidden.has(part)) throw new Error('rules-v2: forbidden binding path')
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) throw new Error(`rules-v2: missing binding ${path}`)
    value = value[part]
  }
  if (value === undefined) throw new Error(`rules-v2: missing binding ${path}`)
  return structuredClone(value)
}
/** Bind JSON values without stringifying numbers, objects, booleans or argv arrays. */
export function bindInputs(input, snapshot) {
  json(input, 'inputs'); bindings(input, 'inputs')
  return bound(input, snapshot)
}
function bound(input, snapshot) {
  if (Array.isArray(input)) return input.map(value => bound(value, snapshot))
  if (input && typeof input === 'object') {
    if (Object.hasOwn(input, 'bind')) {
      keys(input, ['bind'], 'binding')
      return readBinding(snapshot, input.bind)
    }
    const result = Object.create(null)
    for (const [key, value] of Object.entries(input)) {
      if (forbidden.has(key)) throw new Error('rules-v2: forbidden input property')
      result[key] = bound(value, snapshot)
    }
    return result
  }
  if (input === undefined || (typeof input === 'number' && !Number.isFinite(input))) throw new TypeError('rules-v2: inputs must be JSON values')
  return input
}
function condition(input, depth = 0) {
  object(input, 'match')
  if (depth > 16) throw new Error('rules-v2: condition nesting exceeds 16')
  if (['all', 'any', 'not'].includes(input.kind)) {
    keys(input, input.kind === 'not' ? ['kind', 'condition'] : ['kind', 'conditions'], 'match')
    if (input.kind === 'not') condition(input.condition, depth + 1)
    else {
      if (!Array.isArray(input.conditions) || !input.conditions.length || input.conditions.length > 64) throw new Error('rules-v2: empty or oversized condition group')
      input.conditions.forEach(child => condition(child, depth + 1))
    }
  } else if (input.kind === 'regex') {
    keys(input, ['kind', 'pattern', 'flags', 'field', 'all'], 'match')
    if (input.all !== undefined) { boolean(input.all, 'match.all'); if (input.all && depth > 0) throw new Error('rules-v2: all regex matches require a root condition') }
    if (typeof input.pattern !== 'string' || !input.pattern || input.pattern.length > 4096) throw new TypeError('rules-v2: invalid regex pattern')
    if (typeof (input.flags ?? '') !== 'string' || /[^imsu]/.test(input.flags ?? '')) throw new Error('rules-v2: only i/m/s/u regex flags are supported')
    new RegExp(input.pattern, input.flags ?? '')
  } else if (input.kind === 'keywords') {
    keys(input, ['kind', 'values', 'mode', 'caseSensitive', 'wordBoundary', 'field'], 'match')
    if (!Array.isArray(input.values) || !input.values.length || input.values.length > 256 || input.values.some(v => typeof v !== 'string' || !v || v.length > 4096)) throw new TypeError('rules-v2: keywords must be nonempty strings')
    one(input.mode ?? 'ANY', ['ANY', 'ALL', 'NOT-ANY', 'NOT-ALL'], 'keyword mode')
    for (const field of ['caseSensitive', 'wordBoundary']) if (input[field] !== undefined) boolean(input[field], `match.${field}`)
  } else if (input.kind === 'compare') {
    keys(input, ['kind', 'field', 'op', 'value'], 'match')
    id(input.field, 'comparison field')
    one(input.op, ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'], 'comparison')
    if (input.op !== 'exists' && !Object.hasOwn(input, 'value')) throw new TypeError('rules-v2: comparison value is required')
    if (['gt', 'gte', 'lt', 'lte'].includes(input.op) && typeof input.value !== 'number') throw new TypeError('rules-v2: numeric comparison requires a number')
  } else if (input.kind === 'detector') {
    keys(input, ['kind', 'ref', 'revision', 'params'], 'match')
    if (depth > 0) throw new Error('rules-v2: detectors require a root condition')
    id(input.ref, 'detector ref'); integer(input.revision, 1, Number.MAX_SAFE_INTEGER, 'detector revision')
    if (input.params !== undefined) json(input.params, 'detector params')
  } else if (input.kind === 'always') keys(input, ['kind'], 'match')
  else throw new TypeError(`rules-v2: unknown match kind ${input.kind}`)
  if (input.field !== undefined) path(input.field, 'field')
  return structuredClone(input)
}
/** Normalize the native multi-action protocol without changing v1 normalization. */
export function normalizeRuleV2(input) {
  object(input, 'rule')
  json(input, 'rule')
  keys(input, ['schemaVersion', 'sourceId', 'id', 'revision', 'title', 'description', 'on', 'select', 'match', 'actions', 'priority', 'exclusiveGroup'], 'rule')
  if (input.schemaVersion !== 2) throw new TypeError('rules-v2: schemaVersion must be 2')
  const rule = structuredClone(input)
  id(rule.sourceId, 'sourceId'); id(rule.id, 'rule id')
  if (rule.title !== undefined) text(rule.title, 4096, 'title')
  if (rule.description !== undefined) text(rule.description, 16384, 'description')
  if (rule.exclusiveGroup !== undefined) id(rule.exclusiveGroup, 'exclusiveGroup')
  integer(rule.revision, 1, Number.MAX_SAFE_INTEGER, 'revision')
  if (!Array.isArray(rule.on) || !rule.on.length) throw new TypeError('rules-v2: on stages are required')
  rule.on.forEach(stage => one(stage, V2_STAGES, 'stage'))
  const select = object(rule.select, 'select')
  keys(select, ['view', 'roles', 'blockTypes', 'depth', 'crossBlock', 'separator', 'includeCurrent'], 'select')
  one(select.view, ['original', 'model', 'display'], 'view')
  for (const field of ['roles', 'blockTypes']) if (!Array.isArray(select[field]) || !select[field].length) throw new TypeError(`rules-v2: select.${field} is required`)
  select.roles.forEach(role => one(role, ['system', 'developer', 'user', 'assistant', 'tool'], 'role'))
  select.blockTypes.forEach(type => one(type, ['text', 'reasoning', 'tool-call', 'tool-result', 'image', 'file', 'unknown'], 'block type'))
  if (select.depth !== undefined) {
    keys(object(select.depth, 'depth'), ['unit', 'limit'], 'depth')
    one(select.depth.unit, ['message', 'turn', 'block'], 'depth unit')
    integer(select.depth.limit, 1, 10000, 'depth limit')
  }
  for (const field of ['crossBlock', 'includeCurrent']) if (select[field] !== undefined) boolean(select[field], `select.${field}`)
  if (select.separator !== undefined) text(select.separator, 4096, 'select.separator')
  if (select.crossBlock && typeof select.separator !== 'string') throw new Error('rules-v2: crossBlock requires an explicit separator')
  rule.match = condition(rule.match)
  integer(rule.priority ?? 0, -100000, 100000, 'priority')
  rule.priority ??= 0
  if (!Array.isArray(rule.actions) || !rule.actions.length || rule.actions.length > 64) throw new TypeError('rules-v2: actions are required')
  const ids = new Set()
  for (const action of rule.actions) {
    object(action, 'action')
    keys(action, ['id', 'kind', 'enabledDefault', 'stage', 'target', 'template', 'executorRef', 'inputs', 'timeoutMs', 'cooldownMs', 'dedupe', 'dependsOn', 'variable', 'value', 'patch', 'maxChars', 'failurePolicy'], 'action')
    id(action.id, 'action id'); one(action.kind, V2_ACTIONS, 'action kind')
    // A declaration must not silently carry fields that its executor ignores.
    const fieldsByKind = {
      notify: ['template', 'maxChars', 'target'], guidance: ['template', 'maxChars', 'target'], inject: ['template', 'maxChars', 'target'],
      replace: ['template', 'maxChars', 'patch'], filter: [],
      program: ['executorRef', 'inputs', 'timeoutMs'], tool: ['executorRef', 'inputs', 'timeoutMs'], job: ['executorRef', 'inputs', 'timeoutMs'],
      'set-variable': ['variable', 'value'], abort: [], resume: ['template', 'maxChars'], compact: ['template', 'maxChars', 'timeoutMs'],
    }
    keys(action, ['id', 'kind', 'enabledDefault', 'stage', 'cooldownMs', 'dedupe', 'dependsOn', 'failurePolicy', ...fieldsByKind[action.kind]], `${action.kind} action`)
    if (ids.has(action.id)) throw new Error('rules-v2: duplicate action id')
    ids.add(action.id)
    if (typeof action.enabledDefault !== 'boolean') throw new TypeError('rules-v2: enabledDefault must be boolean')
    one(action.stage, rule.on, 'action stage')
    action.cooldownMs ??= 0; integer(action.cooldownMs, 0, 86400000, 'cooldownMs')
    action.dedupe ??= { mode: 'occurrence' }
    keys(object(action.dedupe, 'dedupe'), ['mode'], 'dedupe')
    one(action.dedupe.mode, ['occurrence', 'none'], 'dedupe mode')
    action.dependsOn ??= []
    if (!Array.isArray(action.dependsOn) || action.dependsOn.length > 64) throw new TypeError('rules-v2: dependsOn must be a bounded array')
    action.dependsOn.forEach(ref => id(ref, 'dependency id'))
    if (new Set(action.dependsOn).size !== action.dependsOn.length) throw new TypeError('rules-v2: duplicate dependency')
    if (action.timeoutMs !== undefined) integer(action.timeoutMs, 1, 86400000, 'timeoutMs')
    if (action.maxChars !== undefined) integer(action.maxChars, 1, 1048576, 'maxChars')
    if (action.failurePolicy !== undefined) one(action.failurePolicy, ['skip-dependents', 'continue'], 'failurePolicy')
    if (['program', 'tool', 'job'].includes(action.kind)) id(action.executorRef, 'executorRef')
    if (['notify', 'guidance', 'inject', 'resume', 'compact'].includes(action.kind) || action.kind === 'replace' && action.patch === undefined) {
      if (typeof action.template !== 'string') throw new TypeError('rules-v2: template is required')
    }
    if (action.template !== undefined) text(action.template, 16384, 'template')
    if (action.inputs !== undefined) bindings(action.inputs, 'inputs')
    if (action.kind === 'set-variable') {
      id(action.variable, 'variable')
      if (!Object.hasOwn(action, 'value')) throw new TypeError('rules-v2: variable value is required')
      bindings(action.value, 'variable value')
    }
    if (action.patch !== undefined) {
      if (action.kind !== 'replace') throw new TypeError('rules-v2: patch requires replace action')
      keys(object(action.patch, 'patch'), ['kind', 'path', 'value'], 'patch')
      one(action.patch.kind, ['tool-arguments'], 'patch kind')
      if (typeof action.patch.path !== 'string' || !action.patch.path.startsWith('/')) throw new TypeError('rules-v2: patch requires JSON Pointer')
      path(action.patch.path, 'patch path')
      if (!Object.hasOwn(action.patch, 'value')) throw new TypeError('rules-v2: patch value is required')
      bindings(action.patch.value, 'patch value')
    }
    if (action.target !== undefined) {
      keys(object(action.target, 'target'), ['view', 'role', 'anchor', 'position', 'depth', 'lifetime'], 'target')
      one(action.target.view, ['model', 'display'], 'target view')
      if (action.target.role !== undefined) one(action.target.role, ['system', 'developer', 'user', 'assistant', 'tool'], 'target role')
      if (action.target.position !== undefined) one(action.target.position, ['before', 'after'], 'position')
      if (action.target.anchor !== undefined) id(action.target.anchor, 'target anchor')
      if (action.target.depth !== undefined) integer(action.target.depth, 0, 10000, 'target depth')
      if (action.target.anchor === 'depth' && action.target.depth === undefined) throw new TypeError('rules-v2: depth anchor requires depth')
      if (action.target.depth !== undefined && action.target.anchor !== 'depth') throw new TypeError('rules-v2: depth requires depth anchor')
      if (action.target.lifetime !== undefined) one(action.target.lifetime, ['request', 'turn', 'session'], 'target lifetime')
      if (action.target.role === 'tool') throw new TypeError('rules-v2: tool injection requires a real result')
      if (['notify', 'guidance'].includes(action.kind) && Object.keys(action.target).some(key => !['view', 'lifetime'].includes(key))) throw new TypeError('rules-v2: notice target only supports view and lifetime')
      if (action.stage === 'display.render' ? action.target.view !== 'display' : action.target.view !== 'model') throw new TypeError('rules-v2: target view does not match action stage')
    }
    if (action.kind === 'replace' && action.patch !== undefined && action.template !== undefined) throw new TypeError('rules-v2: argument patch cannot also replace text')
    if (action.stage === 'output.delta' && ['program', 'tool', 'job', 'replace', 'filter', 'set-variable', 'compact'].includes(action.kind)) throw new TypeError('rules-v2: action requires a complete block')
    if (action.stage === 'display.render' && !['inject', 'replace', 'filter'].includes(action.kind)) throw new TypeError('rules-v2: display actions must be pure')
  }
  const visited = new Set(); const visiting = new Set()
  function visit(action) {
    if (visiting.has(action.id)) throw new Error('rules-v2: cyclic action dependency')
    if (visited.has(action.id)) return
    visiting.add(action.id)
    for (const ref of action.dependsOn) {
      const parent = rule.actions.find(value => value.id === ref)
      if (!parent) throw new Error(`rules-v2: missing dependency ${ref}`)
      if (parent.stage !== action.stage) throw new Error('rules-v2: dependency must use the same stage')
      visit(parent)
    }
    visiting.delete(action.id); visited.add(action.id)
  }
  rule.actions.forEach(visit)
  for (const action of rule.actions.filter(action => action.kind === 'resume')) {
    if (action.failurePolicy === 'continue' || !action.dependsOn.some(ref => rule.actions.find(parent => parent.id === ref)?.kind === 'abort'))
      throw new Error('rules-v2: resume requires a successful same-stage abort dependency')
  }
  return rule
}
/** Depth windows count messages/turns before role/type selection; nested blocks share their parent's identity. */
export function selectBlocksV2(blocks, select) {
  let window = blocks
  if (select.depth) {
    const unit = select.depth.unit
    const key = block => unit === 'block' ? block.id : unit === 'message' ? block.messageId : block.turnId
    if (blocks.some(block => key(block) === undefined)) throw new Error(`rules-v2: ${unit} identity unavailable`)
    const units = [...new Set(blocks.map(key))]
    const admitted = new Set(units.slice(-select.depth.limit))
    window = blocks.filter(block => admitted.has(key(block)))
  }
  return window.filter(block => block.view === select.view && select.roles.includes(block.role) && select.blockTypes.includes(block.type))
}
function equalJson(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]))
}
function textValue(node, snapshot) {
  const value = node.field === undefined ? snapshot.block.text : readBinding(snapshot, node.field)
  if (typeof value !== 'string') throw new TypeError('rules-v2: text matcher selected a non-text value')
  return value
}
function touchesCurrent(block, ranges, freshSeq) {
  if (freshSeq === undefined) return true
  if (!block.segments) return block.seq === freshSeq
  const segments = block.segments.filter(segment => segment.seq === freshSeq)
  if (!ranges.length) return segments.length > 0
  return ranges.some(([start, end]) => segments.some(segment => start === end
    ? start >= segment.start && start <= segment.end
    : start < segment.end && end > segment.start))
}
function textMatch(pattern, flags, text, snapshot, freshSeq, field) {
  const regex = new RegExp(pattern, freshSeq === undefined ? flags : flags + 'g')
  let first
  for (let match; (match = regex.exec(text)) !== null;) {
    first ??= match
    if (freshSeq === undefined || field !== 'block.text' || touchesCurrent(snapshot.block, [[match.index, match.index + match[0].length]], freshSeq)) return match
    // Global zero-width scans must advance by a Unicode code point when u is set.
    if (!match[0].length) regex.lastIndex = match.index + (flags.includes('u') && text.codePointAt(match.index) > 0xffff ? 2 : 1)
  }
  return first ?? null
}
/** Pure conditions return captures from the selected match. A fresh seq prefers matches touching that output within a joined history window. */
export function matchConditionV2(node, snapshot, freshSeq) {
  if (node.kind === 'always') return { ok: true, ranges: [], captures: {} }
  if (node.kind === 'all' || node.kind === 'any') {
    const found = []
    for (const child of node.conditions) {
      const result = matchConditionV2(child, snapshot, freshSeq)
      if (node.kind === 'any' && result.ok && touchesCurrent(snapshot.block, result.ranges, freshSeq)) return result
      if (node.kind === 'all' && !result.ok) return result
      found.push(result)
    }
    if (node.kind === 'any') return found.find(result => result.ok) ?? { ok: false, ranges: [], captures: {} }
    return { ok: true, ranges: found.flatMap(v => v.ranges), captures: Object.assign({}, ...found.map(v => v.captures)) }
  }
  if (node.kind === 'not') return { ok: !matchConditionV2(node.condition, snapshot, freshSeq).ok, ranges: [], captures: {} }
  if (node.kind === 'compare') {
    let actual
    if (node.op === 'exists') {
      try { actual = readBinding(snapshot, node.field) }
      catch (error) { if (error.message.startsWith('rules-v2: missing binding')) return { ok: false, ranges: [], captures: {} }; throw error }
      return { ok: actual !== undefined, ranges: [], captures: {} }
    }
    actual = readBinding(snapshot, node.field)
    let ok
    if (node.op === 'eq' || node.op === 'ne') { ok = equalJson(actual, node.value); if (node.op === 'ne') ok = !ok }
    else if (node.op === 'contains') { if (!['string', 'object'].includes(typeof actual) || (typeof actual === 'object' && !Array.isArray(actual))) throw new TypeError('rules-v2: contains requires string or array'); ok = actual.includes(node.value) }
    else {
      if (typeof actual !== 'number' || typeof node.value !== 'number') throw new TypeError('rules-v2: ordered comparison requires numbers')
      ok = ({ gt: () => actual > node.value, gte: () => actual >= node.value, lt: () => actual < node.value, lte: () => actual <= node.value })[node.op]()
    }
    return { ok, ranges: [], captures: {} }
  }
  const text = textValue(node, snapshot)
  if (node.kind === 'regex') {
    // Execution hosts must run untrusted native regex matching in an abortable worker.
    const evidence = match => ({ ok: true, ranges: [[match.index, match.index + match[0].length]],
      captures: { ...Object.fromEntries([...match].map((value, i) => [String(i), value === undefined ? null : value])), ...match.groups }, field: node.field ?? 'block.text' })
    if (node.all) {
      const regex = new RegExp(node.pattern, (node.flags ?? '') + 'g'); const matches = []
      for (let match; (match = regex.exec(text)) !== null;) {
        matches.push(evidence(match))
        if (matches.length > 1000) throw new Error('rules-v2: regex occurrence budget exceeded')
        if (!match[0].length) regex.lastIndex = match.index + ((node.flags ?? '').includes('u') && text.codePointAt(match.index) > 0xffff ? 2 : 1)
      }
      return matches.length ? { ...matches[0], matches } : { ok: false, ranges: [], captures: {} }
    }
    const match = textMatch(node.pattern, node.flags ?? '', text, snapshot, freshSeq, node.field ?? 'block.text')
    return match ? evidence(match) : { ok: false, ranges: [], captures: {} }
  }
  const results = node.values.map(value => {
    // Match the original string so Unicode case folding never changes UTF-16 coordinates.
    const literal = sanitizeRegexMacro(value)
    const pattern = node.wordBoundary ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal
    const match = textMatch(pattern, node.caseSensitive ? 'u' : 'iu', text, snapshot, freshSeq, node.field ?? 'block.text')
    return match === null ? undefined : [match.index, match.index + match[0].length]
  })
  const any = results.some(Boolean); const all = results.every(Boolean)
  const ok = ({ ANY: any, ALL: all, 'NOT-ANY': !any, 'NOT-ALL': !all })[node.mode ?? 'ANY']
  return { ok, ranges: results.filter(Boolean), captures: {}, field: node.field ?? 'block.text' }
}
/** Validate external evidence before any lifecycle phase can replace it or publish an event. */
export function validateDetectorEvidenceV2(detected, block, maxMatches = 1000) {
  json(detected, 'detector evidence'); object(detected, 'detector evidence')
  if (Object.hasOwn(detected, 'matches')) {
    keys(detected, ['matches'], 'detector evidence')
    if (!Array.isArray(detected.matches) || detected.matches.length > maxMatches) throw new Error('rules-v2: invalid detector occurrences')
  }
  for (const result of detected.matches ?? [detected]) {
    object(result, 'detector result'); boolean(result.ok, 'detector result.ok')
    keys(result, ['ok', 'ranges', 'captures', 'facts', 'field'], 'detector result')
    if (result.field !== undefined && result.field !== 'block.text') throw new Error('rules-v2: detector ranges require block.text')
    if (result.facts !== undefined) object(result.facts, 'detector facts')
    if (!Array.isArray(result.ranges) || result.ranges.length > 1000) throw new Error('rules-v2: invalid detector ranges')
    for (const range of result.ranges) if (!Array.isArray(range) || range.length !== 2 || !Number.isSafeInteger(range[0]) || !Number.isSafeInteger(range[1])
      || range[0] < 0 || range[1] < range[0] || range[1] > (block.text?.length ?? 0)) throw new Error('rules-v2: invalid detector range')
    object(result.captures, 'detector captures')
  }
  return detected
}
/** One event per selected block, shared by every action. freshSeq restricts triggers before exclusive groups are claimed; sourceSeqs retain the complete inspected window. */
export function detectRulesV2({ rules, blocks, stage, snapshot = {}, freshSeq, maxMatches = 1000, detectorMatch }) {
  if (freshSeq !== undefined) integer(freshSeq, 0, Number.MAX_SAFE_INTEGER, 'freshSeq')
  const events = []
  const exclusive = new Set()
  for (const rule of [...rules].sort((a, b) => b.priority - a.priority || a.sourceId.localeCompare(b.sourceId) || a.id.localeCompare(b.id))) {
    if (!rule.on.includes(stage) || (rule.exclusiveGroup && exclusive.has(rule.exclusiveGroup))) continue
    let selected = selectBlocksV2(blocks, rule.select)
    if (rule.select.includeCurrent === false) selected = selected.filter(block => block.seq !== snapshot.currentSeq)
    if (rule.select.crossBlock && selected.length) {
      if (selected.some(block => typeof block.text !== 'string')) throw new Error('rules-v2: crossBlock requires textual blocks')
      let offset = 0
      const segments = selected.map((block, i) => { const start = offset; offset += block.text.length + (i < selected.length - 1 ? rule.select.separator.length : 0); return { blockId: block.id, seq: block.seq, start, end: start + block.text.length } })
      selected = [{ ...selected[0], id: JSON.stringify(selected.map(block => block.id)), text: selected.map(block => block.text).join(rule.select.separator), segments }]
    }
    let matched = false
    for (const block of selected) {
      const context = { ...snapshot, stage, block, tool: { name: block.raw?.name, arguments: block.arguments, result: block.raw?.content } }
      const detected = rule.match.kind === 'detector' ? detectorMatch?.(rule, context) : matchConditionV2(rule.match, context, freshSeq)
      if (!detected) throw new Error(`rules-v2: detector unavailable:${rule.match.ref}`)
      if (rule.match.kind === 'detector') validateDetectorEvidenceV2(detected, block, maxMatches)
      for (const result of detected.matches ?? [detected]) {
        if (!result.ok || !touchesCurrent(block, result.ranges, freshSeq)) continue
        matched = true
        events.push({ schemaVersion: 2, occurrenceId: JSON.stringify([rule.sourceId, rule.id, rule.revision, stage, block.id, result.ranges]),
          sourceId: rule.sourceId, ruleId: rule.id, ruleRevision: rule.revision, sessionId: block.sessionId, stage, view: block.view,
          blockId: block.id, sourceSeqs: [...new Set((block.segments ?? [block]).map(part => part.seq ?? blocks.find(b => b.id === part.blockId)?.seq).filter(Number.isSafeInteger))],
          ...(freshSeq === undefined ? {} : { triggerSeq: freshSeq }),
          coordinate: 'utf16', ranges: result.ranges, captures: result.captures, field: result.field ?? (rule.match.kind === 'detector' ? 'block.text' : undefined), segments: block.segments,
          block, facts: structuredClone(result.facts ?? snapshot.facts ?? {}) })
        if (events.length > maxMatches) throw new Error('rules-v2: match budget exceeded')
      }
    }
    if (matched && rule.exclusiveGroup) exclusive.add(rule.exclusiveGroup)
  }
  return events
}

/** Immutable text patches resolve overlaps by explicit priority; signed/opaque and cross-block writes are rejected. */
export function applyBlockPatchesV2(blocks, patches) {
  const changes = new Map(); const results = []
  for (const patch of [...patches].sort((a, b) => b.priority - a.priority || a.actionId.localeCompare(b.actionId))) {
    const block = blocks.find(value => value.id === patch.blockId)
    if (!block) throw new Error('rules-v2: stale block anchor')
    if (block.signed || typeof block.text !== 'string') throw new Error('rules-v2: block cannot be text-patched')
    if (block.segments) throw new Error('rules-v2: cross-block replacement requires per-block patches')
    const [start, end] = patch.range
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > block.text.length) throw new Error('rules-v2: invalid patch range')
    if (typeof patch.text !== 'string') throw new TypeError('rules-v2: replacement must be text')
    const accepted = changes.get(block.id) ?? []
    if (accepted.some(old => start < old.range[1] && end > old.range[0])) { results.push({ actionId: patch.actionId, status: 'skipped', reason: 'overlapping-patch' }); continue }
    accepted.push(patch); changes.set(block.id, accepted)
    results.push({ actionId: patch.actionId, status: 'planned', blockId: block.id, before: block.text.slice(start, end), after: patch.text })
  }
  const transformed = blocks.map(block => {
    const accepted = changes.get(block.id)
    if (!accepted) return block
    let text = block.text
    for (const patch of accepted.sort((a, b) => b.range[0] - a.range[0])) text = text.slice(0, patch.range[0]) + patch.text + text.slice(patch.range[1])
    return { ...block, text, raw: { ...block.raw, text } }
  })
  return { blocks: transformed, results }
}
