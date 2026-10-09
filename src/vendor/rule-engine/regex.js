/**
 * 正则的编译、替换与宏替换。
 *
 * 搬运自 SillyTavern 的正则扩展（参考项目\SillyTavern\public\scripts\extensions\regex\engine.js，
 * AGPL-3.0）。与本库的差异都写在对应函数的注释里：
 *
 *   1. 不 import 酒馆的全局脚本 —— 宏替换改成由调用方注入的函数；
 *   2. 替换回调里不做变量复用（酒馆那处会把 $1 的值漏给后面取不到的 $<name>）；
 *   3. **不做降级回退**。酒馆在好几处会把「说不清楚」的输入悄悄当成另一种意思 ——
 *      flag 非法就把整个输入当 pattern、正则编译不出来就当没命中、字符串不是字符串就返回空串。
 *      这里一律判为失败：写坏的东西应该立刻暴露，而不是静默地变成别的行为。
 */

/** findRegex 里的宏怎么替换，照搬酒馆的 substitute_find_regex。 */
export const SUBSTITUTE_FIND_REGEX = {
  /** 不替换，findRegex 原样编译。 */
  NONE: 0,
  /** 先替换宏，再编译。 */
  RAW: 1,
  /** 先替换宏、再对宏的值做正则转义，再编译。 */
  ESCAPED: 2,
}

/** 正则编译缓存的默认容量，照搬酒馆的 1000 条。 */
export const DEFAULT_REGEX_CACHE_SIZE = 1000

/** JS 认得的 flag。酒馆用的是 [gmixXsuUAJ]，里面 x X A J 并不是标准 flag，这里不跟。 */
const VALID_FLAGS = /^(?!.*?(.).*?\1)[dgimsuvy]+$/

/**
 * 默认的宏替换：什么都不做。
 * 注入 macros 时，签名是 (text, transform?) —— transform 存在时应当用它处理每个宏的值
 * （对应酒馆的 substituteParamsExtended 的第三个参数）。
 */
export const identityMacros = text => text

/**
 * 跑一次宏替换，并保证拿回来的是字符串。
 * 宏替换的结果直接进正则或进文本，返回别的东西一律是调用方的 bug，不能往下传。
 */
function applyMacros(macros, text, transform) {
  const out = transform === undefined ? macros(text) : macros(text, transform)
  if (typeof out !== 'string') {
    throw new TypeError('dsh-rule-engine: macros must return a string, got ' + typeof out)
  }
  return out
}

/**
 * 是不是 `/.../flags` 这种写法。
 * 用于 when.said / when.produced 这类「既可能是子串、也可能是正则」的字段。
 *
 * @param {string} pattern 待判断的写法。
 * @returns {boolean} 是不是正则字面量写法。
 */
export function isRegexLiteral(pattern) {
  return typeof pattern === 'string' && /^\/(.+)\/([a-z]*)$/is.test(pattern)
}

/**
 * 从字符串实例化正则。
 *
 * 支持 `/pattern/flags` 与裸 `pattern` 两种写法。
 * 规则里的正则必须是字符串而不是 RegExp 对象：规则要能跨边界传递、能序列化、能手写。
 *
 * 编译不出来时返回 null —— 本库内部的调用方一律选择抛错，不选择跳过。
 * 与酒馆的差异：flag 非法时酒馆会退回「把整个输入当 pattern」，
 * 于是 `/a/z` 会悄悄变成匹配 a/z 的正则。意图不清，宁可失败。
 *
 * @param {string} input 正则字符串。
 * @returns {RegExp|null} 编译结果；非法时为 null。
 * @throws {TypeError} 输入不是字符串时抛出。
 */
export function regexFromString(input) {
  if (typeof input !== 'string') {
    throw new TypeError('dsh-rule-engine: regexFromString expects a string, got ' + typeof input)
  }
  if (input.length === 0) return null
  try {
    const m = input.match(/(\/?)(.+)\1([a-z]*)/i)
    if (m === null) return null
    // flag 非法就是写错了，不猜它本来想干什么。
    if (m[3] && !VALID_FLAGS.test(m[3])) return null
    return new RegExp(m[2], m[3])
  } catch {
    return null
  }
}

/**
 * 转义宏值里的正则元字符（照搬酒馆的 sanitizeRegexMacro）。
 * 用在 substituteRegex = ESCAPED 时：宏的值是普通文本，不该被当成正则。
 *
 * @param {string} value 宏的值。
 * @returns {string} 转义后的值。
 * @throws {TypeError} 输入不是字符串时抛出。
 */
export function sanitizeRegexMacro(value) {
  if (typeof value !== 'string') {
    throw new TypeError('dsh-rule-engine: sanitizeRegexMacro expects a string, got ' + typeof value)
  }
  return value.replaceAll(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, function (s) {
    switch (s) {
      case '\n': return '\\n'
      case '\r': return '\\r'
      case '\t': return '\\t'
      case '\v': return '\\v'
      case '\f': return '\\f'
      case '\0': return '\\0'
      default: return '\\' + s
    }
  })
}

/** global/sticky 正则自带 lastIndex 状态，复用前必须归零，否则第二次匹配会从中间开始。 */
function resetLastIndex(regex) {
  if (regex.global || regex.sticky) regex.lastIndex = 0
}

/**
 * 带 LRU 淘汰的正则缓存（照搬酒馆的 RegexProvider）。
 *
 * 为什么必须有：规则跑在请求热路径上，正则不能每次都重新编译；
 * 而规则条数没有上限，缓存也不能无界。
 *
 * 编译失败返回 null 并且不写进缓存 —— 但调用方不该把 null 当成「没命中」，
 * 那等于把一条写坏的规则变成静默失效。本库内部一律抛错。
 */
export class RegexProvider {
  #cache = new Map()
  #maxSize

  /**
   * @param {number} maxSize 缓存容量。
   */
  constructor(maxSize = DEFAULT_REGEX_CACHE_SIZE) {
    this.#maxSize = maxSize
  }

  /**
   * 取一条编译好的正则。
   * @param {string} regexString 正则字符串。
   * @returns {RegExp|null} 编译结果；非法时为 null。
   * @throws {TypeError} 输入不是字符串时抛出。
   */
  get(regexString) {
    if (typeof regexString !== 'string') {
      throw new TypeError('dsh-rule-engine: RegexProvider.get expects a string, got ' + typeof regexString)
    }
    const cached = this.#cache.get(regexString)
    if (cached !== undefined) {
      // LRU：命中就挪到队尾（Map 保持插入顺序，队首就是最久没用的）。
      this.#cache.delete(regexString)
      this.#cache.set(regexString, cached)
      resetLastIndex(cached)
      return cached
    }
    const regex = regexFromString(regexString)
    if (regex === null) return null
    if (this.#cache.size >= this.#maxSize) {
      const oldest = this.#cache.keys().next().value
      this.#cache.delete(oldest)
    }
    this.#cache.set(regexString, regex)
    resetLastIndex(regex)
    return regex
  }

  /** 清空缓存。 */
  clear() {
    this.#cache.clear()
  }

  /** 当前缓存条数。 */
  get size() {
    return this.#cache.size
  }
}

/** 默认缓存实例。调用方可以传自己的 provider，用于隔离或调容量。 */
export const defaultRegexProvider = new RegexProvider()

/**
 * 从匹配结果里剔掉 trimStrings（照搬酒馆的 filterString）。
 *
 * 用途：先匹配一大块（比如整段思考），再去掉里面不要的串 ——
 * 这样一条规则就能表达「整段保留，但把其中某些行删掉」。
 *
 * @param {string} rawString 待过滤的文本。
 * @param {string[]|undefined} trimStrings 要删掉的串。
 * @param {object} [options]
 * @param {(text: string, transform?: Function) => string} [options.macros] 宏替换。
 * @returns {string} 过滤后的文本。
 * @throws {TypeError|Error} 输入形状不对、或者 trimStrings 里有空串时抛出。
 */
export function filterString(rawString, trimStrings, { macros = identityMacros } = {}) {
  if (typeof rawString !== 'string') {
    throw new TypeError('dsh-rule-engine: filterString expects a string, got ' + typeof rawString)
  }
  if (trimStrings === undefined || trimStrings === null) return rawString
  if (!Array.isArray(trimStrings)) {
    throw new TypeError('dsh-rule-engine: trimStrings must be an array of strings')
  }
  let finalString = rawString
  for (const trimString of trimStrings) {
    if (typeof trimString !== 'string') {
      throw new TypeError('dsh-rule-engine: trimStrings must be an array of strings')
    }
    // 空串会匹配每一个位置，写它的人多半是想写别的。
    if (trimString.length === 0) {
      throw new Error('dsh-rule-engine: trimStrings must not contain an empty string')
    }
    finalString = finalString.replaceAll(applyMacros(macros, trimString), '')
  }
  return finalString
}

/**
 * 按 substituteRegex 决定 findRegex 最终怎么编译。
 *
 * 判「命中没有」和「实际替换」必须走同一个函数 —— 否则 RAW / ESCAPED 模式下
 * 两边看到的正则不一样，会出现「判命中时说不命中、真要替换时又能替换」的分裂。
 *
 * @param {object} script 规则（取 findRegex 与 substituteRegex）。
 * @param {Function} macros 宏替换函数。
 * @returns {string} 待编译的正则字符串。
 * @throws {Error} substituteRegex 是没见过的值时抛出。
 */
export function resolveFindRegex(script, macros) {
  switch (Number(script.substituteRegex ?? SUBSTITUTE_FIND_REGEX.NONE)) {
    case SUBSTITUTE_FIND_REGEX.NONE:
      return script.findRegex
    case SUBSTITUTE_FIND_REGEX.RAW:
      return applyMacros(macros, script.findRegex)
    case SUBSTITUTE_FIND_REGEX.ESCAPED:
      // 第二个参数是「怎么处理每个宏的值」——只有 ESCAPED 模式才需要。
      return applyMacros(macros, script.findRegex, sanitizeRegexMacro)
    default:
      throw new Error('dsh-rule-engine: unknown substituteRegex ' + JSON.stringify(script.substituteRegex))
  }
}

/**
 * 对一段文本跑一条规则的正则替换（照搬酒馆的 runRegexScript）。
 *
 * 替换语法：
 *   - `$1`..`$n`：第 n 个捕获组
 *   - `$<name>`：具名捕获组
 *   - `{{match}}`：整段匹配（等价于 `$0`）
 *   - 取不到的占位符替换成空串
 * 替换结果整体再过一遍宏替换（酒馆的 substituteParams）。
 *
 * 与酒馆的差异：正则编译不出来时抛错，不当成「没命中」——
 * 一条写坏的规则静默失效，比它直接报错危险得多。
 *
 * @param {object} script 规则；用到的字段是 findRegex / replaceString / trimStrings / substituteRegex / disabled。
 * @param {string} rawString 待替换的文本。
 * @param {object} [options]
 * @param {(text: string, transform?: Function) => string} [options.macros] 宏替换。
 * @param {RegexProvider} [options.provider] 正则缓存。
 * @returns {string} 替换后的文本。
 * @throws {TypeError|Error} 输入形状不对、或正则编译不出来时抛出。
 */
export function runRegexScript(script, rawString, { macros = identityMacros, provider = defaultRegexProvider } = {}) {
  if (script === undefined || script === null || typeof script !== 'object') {
    throw new TypeError('dsh-rule-engine: runRegexScript expects a rule object')
  }
  if (script.disabled !== undefined && typeof script.disabled !== 'boolean') {
    throw new TypeError('dsh-rule-engine: disabled must be a boolean')
  }
  if (script.disabled === true) return rawString
  if (typeof rawString !== 'string') {
    throw new TypeError('dsh-rule-engine: runRegexScript expects a string, got ' + typeof rawString)
  }
  if (typeof script.findRegex !== 'string') {
    throw new TypeError('dsh-rule-engine: findRegex must be a string')
  }
  // replaceString 省略和空串是两回事：省略是「没说」，空串是「换成空」。
  if (typeof script.replaceString !== 'string') {
    throw new TypeError('dsh-rule-engine: replaceString must be a string (use "" to delete the match)')
  }
  const findRegex = provider.get(resolveFindRegex(script, macros))
  if (findRegex === null) {
    throw new Error('dsh-rule-engine: findRegex is not a valid regex: ' + JSON.stringify(script.findRegex))
  }

  return rawString.replace(findRegex, function (match, ...rest) {
    // 酒馆用 [...arguments] 取参：args[0] 是整段匹配，args[1..] 是捕获组，
    // 末尾多出来的是 offset / 整串 / 具名组对象。这里保持同样的索引方式。
    const args = [match, ...rest]
    const last = args[args.length - 1]
    const groups = (last !== null && typeof last === 'object') ? last : undefined
    const replaceString = script.replaceString.replace(/{{match}}/gi, '$0')
    const replaced = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
      const value = num !== undefined ? args[Number(num)] : groups?.[groupName]
      if (value === undefined || value === null) return ''
      // 捕获组的值先剔掉 trimStrings，再放进替换结果。
      return filterString(value, script.trimStrings, { macros })
    })
    // 宏替换放在最后：替换结果里出现的 {{user}} 这类宏也要能用。
    return applyMacros(macros, replaced)
  })
}
