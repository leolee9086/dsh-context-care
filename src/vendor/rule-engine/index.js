/**
 * DSH 专用的规则引擎。
 *
 * 定位：只服务 DSH，不追求通用性。核心是纯函数 ——
 * 输入「规则集 + 事件/上下文」，输出「该做什么」，不依赖 DSH，也不依赖任何具体插件。
 * 消费者各自把结果接走：context_care 取 notify，fetch-router 取 transform。
 *
 * 分层：
 *   placement.js  作用位置与作用域常量
 *   regex.js      正则编译、替换、宏替换（搬运自酒馆正则扩展）
 *   rules.js      规则的校验与规范化（非法直接抛错）
 *   match.js      触发条件匹配（全部 AND）
 *   budget.js     前缀缓存的字节级估算与预算驱动的收缩
 *   apply.js      把规则作用在一段文本上（纯函数）
 *   engine.js     规则来源、消费者注册、冷却与去重、命中日志
 */

export { PLACEMENT, PLACEMENTS, SCOPE, SCOPES } from './placement.js'

export {
  RegexProvider,
  defaultRegexProvider,
  regexFromString,
  sanitizeRegexMacro,
  isRegexLiteral,
  resolveFindRegex,
  identityMacros,
  filterString,
  runRegexScript,
  SUBSTITUTE_FIND_REGEX,
  DEFAULT_REGEX_CACHE_SIZE,
} from './regex.js'

export {
  DEFAULT_RULE,
  ACTION_KINDS,
  globMatch,
  normalizeRule,
  normalizeRules,
  sortRules,
} from './rules.js'

export {
  matchRule,
  matchArgs,
  matchIdle,
  matchTool,
  matchText,
  matchDepth,
  targetMatches,
} from './match.js'

export {
  byteLength,
  commonPrefixBytes,
  cacheLossRatio,
  selectWithinBudget,
} from './budget.js'

export { applyRules } from './apply.js'

export { createEngine } from './engine.js'
export { V2_STAGES, V2_ACTIONS, readBinding, bindInputs, normalizeRuleV2, selectBlocksV2, matchConditionV2, detectRulesV2, validateDetectorEvidenceV2, applyBlockPatchesV2 } from './v2.js'
