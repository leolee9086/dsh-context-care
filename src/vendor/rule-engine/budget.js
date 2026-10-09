/**
 * 前缀缓存的字节级估算，与预算驱动的收缩。
 *
 * 为什么是字节级：服务端的前缀缓存不认语义，只认字节 ——
 * 语义相同但字节不同就是真失效，不是误判。
 *
 * 为什么不建树、不做投影、不做字段策略：比较对象只有「最近一次同接口请求」这一份，
 * 因为缓存也只跟上一次比。chatseqtrie 那套 trie / sequencepolicy / fieldpolicy
 * 是为多会话多分支准备的，DSH 这边需要的能力只有一条：
 * 在最近一次同接口的请求上估算前缀缓存长度。
 *
 * 为什么预算是第一性的：规则给的是「最多损失多少缓存」，作用范围是算出来的。
 * 改哪里是钱的问题，不是审美问题 —— 没有缓存约束，变换库根本没必要存在。
 *
 * 这一层不依赖 DSH，也不依赖任何具体插件。
 */

/**
 * UTF-8 字节长度。
 * 用 Buffer 而不是 TextEncoder：这条路径每次请求都要走，Buffer.byteLength 不分配内存。
 *
 * @param {string} text 文本。
 * @returns {number} 字节数。
 * @throws {TypeError} 输入不是字符串时抛出。
 */
export function byteLength(text) {
  if (typeof text !== 'string') {
    throw new TypeError('dsh-rule-engine: byteLength expects a string, got ' + typeof text)
  }
  return Buffer.byteLength(text, 'utf8')
}

/** 是不是 UTF-16 高代理（切点落在它后面会把一个字符切成两半）。 */
function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff
}

/**
 * 两个字符串的公共前缀长度（字节）。
 *
 * 按 UTF-16 码元逐位比较再换算成字节 —— 公共前缀上的码元相同就意味着字节相同。
 * 切点落在代理对中间时退一格，免得把半个字符算进前缀（也会让调用方拿到非法字符串）。
 *
 * @param {string} a 左串。
 * @param {string} b 右串。
 * @returns {number} 公共前缀的字节数。
 * @throws {TypeError} 输入不是字符串时抛出。
 */
export function commonPrefixBytes(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new TypeError('dsh-rule-engine: commonPrefixBytes expects two strings')
  }
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++
  if (i > 0 && i < a.length && isHighSurrogate(a.charCodeAt(i - 1))) i--
  return byteLength(a.slice(0, i))
}

/**
 * 一次变换造成的缓存失效比例。
 *
 * 定义：因为这次变换而废掉的字节数 / 上一次请求的总字节数。
 * 废掉的部分 = 「不变换时能命中的前缀」减去「变换后能命中的前缀」。
 *
 * @param {string|null|undefined} previous 最近一次同接口请求的文本；没有就传 null。
 *        这不是兜底 —— 「没有上一次请求」和「上一次是空请求」是两件事，前者确实没有缓存可失效。
 * @param {string} baseline 本次请求未变换时的文本。
 * @param {string} candidate 变换后的文本。
 * @returns {number} 0..1 的失效比例；previous 为空时恒为 0。
 * @throws {TypeError} baseline / candidate 不是字符串时抛出。
 */
export function cacheLossRatio(previous, baseline, candidate) {
  if (typeof baseline !== 'string' || typeof candidate !== 'string') {
    throw new TypeError('dsh-rule-engine: cacheLossRatio expects baseline and candidate to be strings')
  }
  if (previous === null || previous === undefined) return 0
  if (typeof previous !== 'string') {
    throw new TypeError('dsh-rule-engine: previous must be a string or null')
  }
  const total = byteLength(previous)
  if (total === 0) return 0
  const before = commonPrefixBytes(previous, baseline)
  const after = commonPrefixBytes(previous, candidate)
  const lost = before - after
  return lost <= 0 ? 0 : lost / total
}

/** 按 index 把片段换成新内容，拼回一整串文本。 */
function compose(segments, replacements) {
  const byIndex = new Map(replacements.map(item => [item.index, item.text]))
  return segments.map((segment, index) => (byIndex.has(index) ? byIndex.get(index) : segment)).join('')
}

/** 校验 selectWithinBudget 的入参。 */
function checkPlanInput({ segments, replacements, maxCacheLoss }) {
  if (!Array.isArray(segments)) {
    throw new TypeError('dsh-rule-engine: segments must be an array of strings')
  }
  for (const segment of segments) {
    if (typeof segment !== 'string') {
      throw new TypeError('dsh-rule-engine: segments must be an array of strings')
    }
  }
  if (!Array.isArray(replacements)) {
    throw new TypeError('dsh-rule-engine: replacements must be an array')
  }
  const seen = new Set()
  for (const item of replacements) {
    if (typeof item !== 'object' || item === null) {
      throw new TypeError('dsh-rule-engine: each replacement must be an object like { index, text }')
    }
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= segments.length) {
      throw new Error('dsh-rule-engine: replacement index ' + JSON.stringify(item.index) + ' is out of range')
    }
    if (seen.has(item.index)) {
      throw new Error('dsh-rule-engine: replacement index ' + item.index + ' appears twice')
    }
    seen.add(item.index)
    if (typeof item.text !== 'string') {
      throw new TypeError('dsh-rule-engine: replacement text must be a string')
    }
    if (item.required !== undefined && typeof item.required !== 'boolean') {
      throw new TypeError('dsh-rule-engine: replacement required must be a boolean')
    }
  }
  if (typeof maxCacheLoss !== 'number' || !Number.isFinite(maxCacheLoss) || maxCacheLoss < 0 || maxCacheLoss > 1) {
    throw new TypeError('dsh-rule-engine: maxCacheLoss must be a ratio between 0 and 1')
  }
}

/**
 * 预算驱动的收缩：从尾部往前贪心，改一处算一次代价，累计到上限就停。
 *
 * 为什么从尾部往前：缓存是前缀，越靠后的改动废掉的东西越少，尾部优先是最优解。
 * 为什么贪心就够：改动点越靠前，失效范围越大，代价单调不减 ——
 * 所以「从尾部往前加，加到超预算为止」拿到的就是能改的最靠后的一批。
 *
 * @param {object} input
 * @param {string|null|undefined} input.previous 最近一次同接口请求的文本。
 * @param {string[]} input.segments 本次请求的文本片段（按顺序；拼接起来就是完整文本）。
 * @param {Array<{index: number, text: string, required?: boolean}>} input.replacements 想改的片段。
 *        required = true 表示「不做就不能发」（隐私清洗这类），无条件接受，不参与预算收缩。
 * @param {number} input.maxCacheLoss 允许的最大失效比例（0..1）。
 * @returns {{text: string, accepted: number[], rejected: number[], forced: number[], loss: number, exceedsBudget: boolean}}
 *          text 是最终文本；accepted/rejected/forced 是片段下标；
 *          exceedsBudget 表示「必须做的那些本身就已经超出预算」—— 调用方据此拒绝发送。
 * @throws {TypeError|Error} 入参形状不对时抛出。
 */
export function selectWithinBudget({ previous, segments, replacements, maxCacheLoss }) {
  checkPlanInput({ segments, replacements, maxCacheLoss })
  const baseline = segments.join('')
  const plan = [...replacements].sort((a, b) => a.index - b.index)
  const forced = plan.filter(item => item.required === true)
  const optional = plan.filter(item => item.required !== true)
  const accepted = [...forced]
  const rejected = []
  let text = compose(segments, accepted)
  let loss = cacheLossRatio(previous, baseline, text)
  for (let i = optional.length - 1; i >= 0; i--) {
    const trial = [...accepted, optional[i]]
    const candidate = compose(segments, trial)
    const trialLoss = cacheLossRatio(previous, baseline, candidate)
    if (trialLoss > maxCacheLoss) {
      // 更靠前的候选代价只会更大，到这里就可以停了。
      rejected.push(...optional.slice(0, i + 1).reverse())
      break
    }
    accepted.push(optional[i])
    text = candidate
    loss = trialLoss
  }
  const indexes = list => list.map(item => item.index).sort((a, b) => a - b)
  return {
    text,
    accepted: indexes(accepted),
    rejected: indexes(rejected),
    forced: indexes(forced),
    loss,
    exceedsBudget: loss > maxCacheLoss,
  }
}
