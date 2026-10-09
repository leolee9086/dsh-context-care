/**
 * 规则的校验与规范化。
 *
 * 校验严格：任何一条规则说不清楚，都直接抛错，让调用方拒绝安装、保持原行为
 * （fetch-router 的风格）。为什么不是「跳过坏规则继续跑」：
 * 规则引擎的产物是要发出去的请求，静默跳过一条写坏的规则，
 * 等于让用户以为它在生效 —— 那比报错危险得多。
 *
 * 所以这里不做降级：该给的东西没给就抛错，给了但类型不对也抛错。
 */

import { NUMBER_COMPARISONS } from './match.js'
import { PLACEMENTS, SCOPES, SCOPE } from './placement.js'
import { regexFromString, isRegexLiteral, SUBSTITUTE_FIND_REGEX } from './regex.js'

/** 省略字段时的默认值。这些默认都有明确语义：「没说就是不做 / 不限」。 */
export const DEFAULT_RULE = Object.freeze({
  scope: SCOPE.GLOBAL,
  enabled: true,
  placement: [],
  depth: { min: null, max: null },
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: false,
  cooldownMinutes: 0,
  oncePerSurface: false,
})

/** 合法的动作类型。 */
export const ACTION_KINDS = Object.freeze(['notify', 'transform'])

/** 合法的宏替换方式。 */
const SUBSTITUTE_MODES = Object.freeze([
  SUBSTITUTE_FIND_REGEX.NONE,
  SUBSTITUTE_FIND_REGEX.RAW,
  SUBSTITUTE_FIND_REGEX.ESCAPED,
])

/**
 * 判断一个值是否匹配 glob（只支持 `*` 通配）。
 *
 * 与 fetch-router 的 globMatch 同语义：`*` 匹配任意串，不含 `*` 就是全等。
 * provider / model / purpose / tool 这些维度用它，因为它们都是「一族名字」而不是单值。
 *
 * @param {string} pattern 模式。
 * @param {string|undefined} value 待匹配的值。
 * @returns {boolean} 是否匹配。
 */
export function globMatch(pattern, value) {
  if (typeof pattern !== 'string') {
    throw new TypeError('dsh-rule-engine: globMatch pattern must be a string')
  }
  if (value === undefined || value === null) return false
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === value
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp('^' + escaped + '$').test(value)
}

/** 可选布尔字段：没给就用 fallback，给了就必须是布尔。 */
function optionalBoolean(raw, field, fallback, id) {
  const value = raw[field]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new Error('dsh-rule-engine: rule "' + id + '" ' + field + ' must be a boolean')
  }
  return value
}

/** 可选字符串字段：没给就跳过，给了就必须是非空字符串。 */
function checkOptionalString(when, field, id) {
  const value = when[field]
  if (value === undefined) return
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('dsh-rule-engine: rule "' + id + '" when.' + field + ' must be a non-empty string')
  }
}

/**
 * 校验并规范化一组规则，返回排好序的数组。
 *
 * @param {object[]|undefined} rawRules 原始规则。
 * @returns {object[]} 规范化并按优先级排好序的规则。
 * @throws {Error} 任何一条规则不合法时抛出。
 */
export function normalizeRules(rawRules) {
  if (rawRules === undefined || rawRules === null) return []
  if (!Array.isArray(rawRules)) {
    throw new Error('dsh-rule-engine: rules must be an array')
  }
  const seen = new Set()
  const rules = rawRules.map((raw, index) => normalizeRule(raw, index))
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new Error('dsh-rule-engine: duplicate rule id "' + rule.id + '"')
    }
    seen.add(rule.id)
  }
  return sortRules(rules)
}

/**
 * 校验并规范化一条规则。
 *
 * @param {object} raw 原始规则。
 * @param {number} index 在数组里的位置（只用于报错时指认是哪一条）。
 * @returns {object} 规范化后的规则。
 * @throws {Error} 规则不合法时抛出。
 */
export function normalizeRule(raw, index) {
  const where = 'rules[' + index + ']'
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('dsh-rule-engine: ' + where + ' must be an object')
  }
  // id 要显式写：规则可能来自多处，「数组里第几个」在那里不是个稳定的名字。
  const id = raw.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('dsh-rule-engine: ' + where + ' needs an explicit non-empty id')
  }

  const scope = raw.scope ?? DEFAULT_RULE.scope
  if (!SCOPES.includes(scope)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" has an unknown scope ' + JSON.stringify(raw.scope))
  }

  // 优先级必须显式写出来：规则可能来自静态配置，也可能来自别的插件，
  // 合并之后「谁先声明」这件事根本不存在，拿它当优先级是假的。
  const order = raw.order
  if (typeof order !== 'number' || !Number.isFinite(order)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" needs an explicit order (a finite number)')
  }

  const placement = raw.placement ?? DEFAULT_RULE.placement
  if (!Array.isArray(placement)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" placement must be an array')
  }
  for (const spot of placement) {
    if (!PLACEMENTS.includes(spot)) {
      throw new Error('dsh-rule-engine: rule "' + id + '" has an unknown placement ' + JSON.stringify(spot))
    }
  }

  const when = raw.when ?? {}
  if (typeof when !== 'object' || when === null || Array.isArray(when)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" when must be an object')
  }
  checkWhen(when, id)

  const action = raw.action
  if (typeof action !== 'object' || action === null || Array.isArray(action)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" needs an action object')
  }
  if (!ACTION_KINDS.includes(action.kind)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" action.kind must be "notify" or "transform"')
  }
  if (action.by !== undefined && (typeof action.by !== 'string' || action.by.length === 0)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" action.by must be a non-empty string')
  }

  // transform 必须说清楚「把什么换成什么」和「能废掉多少缓存」。
  if (action.kind === 'transform') {
    if (typeof when.findRegex !== 'string') {
      throw new Error('dsh-rule-engine: transform rule "' + id + '" needs when.findRegex')
    }
    if (typeof when.replaceString !== 'string') {
      throw new Error('dsh-rule-engine: transform rule "' + id + '" needs when.replaceString (use "" to delete the match)')
    }
    if (raw.budget === undefined || raw.budget === null) {
      throw new Error('dsh-rule-engine: transform rule "' + id + '" needs budget.maxCacheLoss')
    }
  }
  const budget = checkBudget(raw.budget, id, action.kind === 'transform')

  const depth = raw.depth ?? DEFAULT_RULE.depth
  if (typeof depth !== 'object' || depth === null || Array.isArray(depth)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" depth must be an object like { min, max }')
  }
  const min = depth.min ?? null
  const max = depth.max ?? null
  if (min !== null && (typeof min !== 'number' || !Number.isFinite(min))) {
    throw new Error('dsh-rule-engine: rule "' + id + '" depth.min must be a number')
  }
  if (max !== null && (typeof max !== 'number' || !Number.isFinite(max))) {
    throw new Error('dsh-rule-engine: rule "' + id + '" depth.max must be a number')
  }

  const cooldownMinutes = raw.cooldownMinutes ?? DEFAULT_RULE.cooldownMinutes
  if (typeof cooldownMinutes !== 'number' || !Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) {
    throw new Error('dsh-rule-engine: rule "' + id + '" cooldownMinutes must be a non-negative number')
  }

  return {
    id,
    scope,
    order,
    enabled: optionalBoolean(raw, 'enabled', DEFAULT_RULE.enabled, id),
    when,
    action,
    placement: [...placement],
    depth: { min, max },
    markdownOnly: optionalBoolean(raw, 'markdownOnly', DEFAULT_RULE.markdownOnly, id),
    promptOnly: optionalBoolean(raw, 'promptOnly', DEFAULT_RULE.promptOnly, id),
    runOnEdit: optionalBoolean(raw, 'runOnEdit', DEFAULT_RULE.runOnEdit, id),
    budget,
    cooldownMinutes,
    oncePerSurface: optionalBoolean(raw, 'oncePerSurface', DEFAULT_RULE.oncePerSurface, id),
  }
}

/** 校验 when 里的每个条件。 */
function checkWhen(when, id) {
  if (when.findRegex !== undefined && typeof when.findRegex !== 'string') {
    throw new Error('dsh-rule-engine: rule "' + id + '" when.findRegex must be a string like "/pattern/flags"')
  }
  if (when.replaceString !== undefined && typeof when.replaceString !== 'string') {
    throw new Error('dsh-rule-engine: rule "' + id + '" when.replaceString must be a string')
  }
  if (when.substituteRegex !== undefined) {
    if (typeof when.substituteRegex !== 'number' || !SUBSTITUTE_MODES.includes(when.substituteRegex)) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.substituteRegex must be 0, 1 or 2')
    }
  }
  // NONE 模式下正则里没有宏，现在就能编译；RAW / ESCAPED 要等宏替换完才能判，
  // 那种情况只能到运行时再抛错。
  const mode = when.substituteRegex ?? SUBSTITUTE_FIND_REGEX.NONE
  if (typeof when.findRegex === 'string' && mode === SUBSTITUTE_FIND_REGEX.NONE && regexFromString(when.findRegex) === null) {
    throw new Error('dsh-rule-engine: rule "' + id + '" when.findRegex is not a valid regex: ' + JSON.stringify(when.findRegex))
  }
  if (when.trimStrings !== undefined) {
    if (!Array.isArray(when.trimStrings)) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.trimStrings must be an array of strings')
    }
    for (const trimString of when.trimStrings) {
      if (typeof trimString !== 'string' || trimString.length === 0) {
        throw new Error('dsh-rule-engine: rule "' + id + '" when.trimStrings must not contain an empty or non-string item')
      }
    }
  }
  for (const field of ['provider', 'model', 'purpose']) {
    checkOptionalString(when, field, id)
  }
  // tool 允许数组：数组表示「其中任意一个」，不是「同时调用」这几个工具。
  if (when.tool !== undefined) {
    const wants = Array.isArray(when.tool) ? when.tool : [when.tool]
    if (wants.length === 0) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.tool must not be an empty array')
    }
    for (const item of wants) {
      if (typeof item !== 'string' || item.length === 0) {
        throw new Error('dsh-rule-engine: rule "' + id + '" when.tool must be a non-empty string or an array of them')
      }
    }
  }
  for (const field of ['said', 'produced']) {
    checkOptionalString(when, field, id)
    const value = when[field]
    // 写成 /.../ 就是正则，那就得能编译出来。
    if (typeof value === 'string' && isRegexLiteral(value) && regexFromString(value) === null) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.' + field + ' is not a valid regex: ' + JSON.stringify(value))
    }
  }
  if (when.args !== undefined) {
    if (typeof when.args !== 'object' || when.args === null || Array.isArray(when.args)) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.args must be an object of parameter name to substring')
    }
    for (const [key, want] of Object.entries(when.args)) {
      const wants = Array.isArray(want) ? want : [want]
      if (wants.length === 0) {
        throw new Error('dsh-rule-engine: rule "' + id + '" when.args.' + key + ' must not be an empty array')
      }
      for (const item of wants) {
        if (typeof item !== 'string' || item.length === 0) {
          throw new Error('dsh-rule-engine: rule "' + id + '" when.args.' + key + ' must be a non-empty string or an array of them')
        }
      }
    }
  }
  if (when.idle !== undefined) {
    const idle = when.idle
    if (typeof idle !== 'object' || idle === null || Array.isArray(idle)) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.idle must be an object like { since, minutes }')
    }
    if (typeof idle.since !== 'string' || idle.since.length === 0) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.idle.since must be a tool name')
    }
    if (typeof idle.minutes !== 'number' || !Number.isFinite(idle.minutes) || idle.minutes < 0) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.idle.minutes must be a non-negative number')
    }
  }
  // 数值条件的形状现在就能定死：指标名是开放集合（引擎不认识它们），
  // 但「每个指标要给出至少一个已知比较符、边界是有限数」这几条与具体指标无关。
  if (when.numbers !== undefined) {
    const numbers = when.numbers
    if (typeof numbers !== 'object' || numbers === null || Array.isArray(numbers)) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.numbers must be an object like { metric: { gte: 60 } }')
    }
    const metrics = Object.keys(numbers)
    if (metrics.length === 0) {
      throw new Error('dsh-rule-engine: rule "' + id + '" when.numbers must name at least one metric')
    }
    for (const metric of metrics) {
      const comparisons = numbers[metric]
      if (typeof comparisons !== 'object' || comparisons === null || Array.isArray(comparisons)) {
        throw new Error('dsh-rule-engine: rule "' + id + '" when.numbers.' + metric + ' must be an object of comparisons')
      }
      const operators = Object.keys(comparisons)
      if (operators.length === 0) {
        throw new Error('dsh-rule-engine: rule "' + id + '" when.numbers.' + metric + ' must name at least one comparison')
      }
      for (const operator of operators) {
        if (!Object.hasOwn(NUMBER_COMPARISONS, operator)) {
          throw new Error('dsh-rule-engine: rule "' + id + '" when.numbers.' + metric
            + ' has unknown comparison "' + operator + '" (use gte / gt / lte / lt / eq)')
        }
        const bound = comparisons[operator]
        if (typeof bound !== 'number' || !Number.isFinite(bound)) {
          throw new Error('dsh-rule-engine: rule "' + id + '" when.numbers.' + metric + '.' + operator + ' must be a finite number')
        }
      }
    }
  }
}

/** 校验 budget。transform 规则必须给出 maxCacheLoss；notify 规则给了也要合法。 */
function checkBudget(raw, id, required) {
  if (raw === undefined || raw === null) {
    // required 为 false 时不会走到这里以外的情况：调用方只在 transform 上强制要求。
    return { maxCacheLoss: 0 }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('dsh-rule-engine: rule "' + id + '" budget must be an object like { maxCacheLoss }')
  }
  const maxCacheLoss = raw.maxCacheLoss
  if (maxCacheLoss === undefined) {
    if (required) {
      throw new Error('dsh-rule-engine: transform rule "' + id + '" needs budget.maxCacheLoss')
    }
    return { maxCacheLoss: 0 }
  }
  if (typeof maxCacheLoss !== 'number' || !Number.isFinite(maxCacheLoss) || maxCacheLoss < 0 || maxCacheLoss > 1) {
    throw new Error('dsh-rule-engine: rule "' + id + '" budget.maxCacheLoss must be a ratio between 0 and 1')
  }
  return { maxCacheLoss }
}

/**
 * 按优先级排序。
 *
 * 优先级 = 作用域优先级 + order，两部分都写在规则里 —— 照搬酒馆的
 * 「ORDER MATTERS: defines the regex script priority」，但去掉酒馆用来兜底的
 * 「列表内顺序」：规则可能来自静态配置，也可能来自别的插件，
 * 合并之后「谁先声明」这件事根本不存在，拿它当优先级是假的。
 *
 * 同 scope 同 order 的规则按 id 排，只为了让顺序确定；要控制先后就给不同的 order。
 *
 * @param {object[]} rules 规范化后的规则。
 * @returns {object[]} 新数组，不改动入参。
 */
export function sortRules(rules) {
  return [...rules].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope - b.scope
    if (a.order !== b.order) return a.order - b.order
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}
