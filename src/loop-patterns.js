// src/loop-patterns.js — 退化输出的形状表：判定只有这一份，两层各取所需。
//
// 消费者：
//   · loop-guard.js（agent 层）—— 按严重度决定要不要提醒模型先落盘、再压缩；
//   · loop-clean.js（请求层）—— 只对**严重**档做硬清理。
//
// **处置是按严重度分的**（2026-09-25 哥哥定的语义）：
//   · 轻微（mild）—— 提醒。让模型自己看见、自己改掉；这类内容多半还带着信息，清掉是损失。
//   · 严重（severe）—— 硬清理。它就是噪声，删掉/截断即可；**清了就不再提醒**，
//     否则模型被叫去找一段已经不存在的文本（房间里的大象）。
//
// 严重度**不是模式的静态属性，而是看这一轮重复占了多大比重**：同样是「同一行反复出现」，
// 40 行里 40 行都是它（占 93%）是卡带，73 行里 24 行是它（占 33%）只是稀疏轮转 ——
// 后者清掉会把中间那些正常内容一起切掉，所以只提醒。阈值见 SEVERE_REPEAT_RATIO /
// SEVERE_FILLER_RATIO；只有 line-repeat 与 filler-lines 这两种「重复/填充」型能被判成严重档
// （CLEANABLE_IDS），轮转型永远是轻微档。
//
// 但硬清理要有执行者：清理挂在那两个插件提供的 `requestRewrite` 服务上（见 index.js 的
// `ctx.inject(['requestRewrite'])`），fetch-router 没装或没启用时就没有执行者。
// **执行者不在，严重档也清不掉，那就必须提醒** —— 否则这一轮退化既没被清、也没人说。
// 所以"清还是报"是「命中形状 + 占比 + 执行者在不在」共同决定的。
//
// 以前两张表各自成表，后果是**能清的认不出、能认的不清**：弱循环（「好。/做。/输出。」
// 这种短行轮转）在请求层被 filler-lines 清掉了，agent 层却只认「同一行重复 ≥15 次」，
// 于是全程没有提醒。2026-09-25 在真机上量过：她的会话里 200 条助手回复，循环最凶的那几条
// （同一组短行占末尾七成）一条都没触发提醒 —— 单行次数到不了 15，占比也到不了 20%。
//
// 判定只吃一段文本，不碰会话、不碰请求：输入文本，输出命中信息或 undefined。
// 命中信息的形状统一带 `lines`（原文行）、`total`（窗口行数）、`ratio`（占比）、
// `severity`（处置档），外加各模式自己的字段；`describeHit` 负责把它写成给模型看的一句话。

/** 只看末尾这么多行 —— 循环总是拖在尾巴上。 */
const TAIL_LINES = 80
/**
 * 参与统计的最短行长。
 *
 * 曾经是 3，理由是「代码里的 `}`、空行天然会重复」。但实测的弱循环体恰好是**两个字**：
 * 「好。」「做。」「输出。」—— 门槛设成 3 等于把循环本体滤掉，只剩零星的三个字行。
 * 围栏行另有 FENCE_LINE 单管，单字行与空行仍然不进统计，所以这里放到 2。
 */
const MIN_LINE_LEN = 2
/** 代码围栏行不参与：写文档时围栏成对出现，天然重复。 */
const FENCE_LINE = /^(`{3,}|~{3,})[\w+-]*$/
/** 同一行在窗口里出现这么多次才算循环。 */
const REPEAT_THRESHOLD = 15
/** 同时还要占够窗口的比例，避免把「正常但啰嗦」的输出也判成循环。 */
const REPEAT_RATIO = 0.2
/**
 * 行重复占到窗口这么多，才算**严重档**（值得硬清理）。
 *
 * 实测：经典卡带是 40/43 = 93%，清掉纯赚；而 2026-09-25 那批真机样本是 21%~50%
 * （「好。」和「做。」混着刷），从第一次出现处截断会把中间那些正常内容一起切掉 ——
 * 那批全部只提醒。七成这条线就是"整条尾巴基本只剩这一行"的意思。
 */
const SEVERE_REPEAT_RATIO = 0.7

/** 超过这么长的行不可能是填充行 —— 长句总能承载信息。 */
const MAX_FILLER_LEN = 6
/** 填充行到这个数才算刷屏。 */
const MIN_FILLER_LINES = 5
/** 同时要占够窗口比例。 */
const MIN_FILLER_RATIO = 0.4
/** 填充行占到窗口这么多才算严重档（值得硬清理）。 */
const SEVERE_FILLER_RATIO = 0.5
/**
 * 填充词。**只收最高频的应答词与虚字** —— 表越长越容易误杀。
 * 判定不要求整行都是它，只要行足够短、又含其中一个，就算填充行。
 */
const FILLER_CHARS = new Set([...'做干搞走来了好嗯对是吧呢啊呀行成可以继续那就先再'])

/** 弱循环里参与计数的行必须短 —— 长句即使重复也是内容，不是卡带。 */
const CYCLE_MAX_LINE_LEN = 8
/** 样本太短不判：比例在十几行上没有意义。 */
const CYCLE_MIN_LINES = 24
/** 只看最高频的这几行。 */
const CYCLE_TOP = 3
/** 它们加起来要占窗口这么多，才算「整个尾巴被少数短句占满」。 */
const CYCLE_COVER_RATIO = 0.6

/** 行首单调的判定只认这么长的前缀 —— 「嗯，」「好的：」这种。 */
const PREFIX_MAX_LEN = 3
/** 行首重复到这个数才算退化。 */
const PREFIX_MIN_LINES = 10
/** 同时要占够窗口比例：一半的行都这么开头，就不是行文习惯而是卡带了。 */
const PREFIX_RATIO = 0.5
/** 前缀的切分点：中文/英文逗号、冒号、顿号。 */
const PREFIX_DELIMITER = /[，,：:、]/

/**
 * 标出每一行是不是在代码块里（含围栏行本身）。
 *
 * 代码块里什么都可能出现：短行、`}`、中文注释、示例文本 —— 那些都不该参与循环判定。
 * **误清代码比漏清一段退化输出严重得多**：前者毁任务材料，后者只是多留一点噪声。
 * 所以任何模式都得先过这一层，不是可选优化。
 *
 * @param {string[]} lines 原文的行。
 * @returns {boolean[]} 与 lines 等长；true 表示这行在代码块里。
 */
export function fenceMask(lines) {
  const mask = []
  let inside = false
  for (const line of lines) {
    if (FENCE_LINE.test(line.trim())) {
      mask.push(true)
      inside = !inside
      continue
    }
    mask.push(inside)
  }
  return mask
}

/**
 * 一次解析出所有模式都要的三个视图，避免每个模式各扫一遍行数组。
 *
 * @param {string} text 原文。
 * @returns {{ lines: string[], marks: boolean[], window: string[], windowStart: number }}
 *   `lines` 是原文行；`marks[i]` 表示该行参与统计；`window` 是末尾窗口内参与统计的
 *   行文本；`windowStart` 是窗口第一行在 `lines` 里的下标。
 */
function parse(text) {
  const lines = String(text).split('\n')
  const fences = fenceMask(lines)
  const marks = lines.map((line, index) => {
    if (fences[index]) return false
    const trimmed = line.trim()
    return trimmed.length >= MIN_LINE_LEN && !FENCE_LINE.test(trimmed)
  })
  const counted = []
  for (let index = 0; index < lines.length; index += 1) if (marks[index]) counted.push(index)
  if (counted.length === 0) return { lines, marks, window: [], windowStart: 0 }
  const windowStart = counted.length > TAIL_LINES ? counted[counted.length - TAIL_LINES] : counted[0]
  const window = []
  for (let index = windowStart; index < lines.length; index += 1) {
    if (marks[index]) window.push(lines[index].trim())
  }
  return { lines, marks, window, windowStart }
}

/** 最高频的一项（并列时取先出现的）。 */
function topEntry(tallies) {
  let best
  let count = 0
  for (const [key, seen] of tallies) {
    if (seen > count) {
      best = key
      count = seen
    }
  }
  return { key: best, count }
}

/**
 * 模式一：同一行反复出现。
 *
 * 实测样本（DeepSeek V4 Flash 失控时）：
 *
 *     （输出。）
 *     **做。**
 *     go.
 *     （输出。）
 *     **做。**
 *     go.
 *     …重复上百行
 *
 * 判据只看重复次数与占比，不看具体内容 —— 换一组词同样能认出来。
 */
function detectLineRepeat(parsed) {
  if (parsed.window.length === 0) return undefined
  const tallies = new Map()
  for (const line of parsed.window) tallies.set(line, (tallies.get(line) ?? 0) + 1)
  const { key: line, count } = topEntry(tallies)
  if (count < REPEAT_THRESHOLD || count / parsed.window.length < REPEAT_RATIO) return undefined
  const ratio = count / parsed.window.length
  return {
    pattern: 'line-repeat', line, count, total: parsed.window.length, ratio,
    severity: ratio >= SEVERE_REPEAT_RATIO ? 'severe' : 'mild', ...parsed,
  }
}

/**
 * 模式二：填充行成片。
 *
 * 实测样本（2026-09-23，同一次失控的后半段）：
 *
 *     做。
 *     嗯，简洁。
 *     做。
 *     嗯，先记忆 + 落盘，然后回复 ✓
 *     做。
 *     嗯，一次做完。
 *     做。
 *     好。
 *     做。
 *     （直接做。）
 *     做。
 *
 * 「做。」只出现 6 次，够不到 line-repeat 的门槛，但它和同类碎句加起来占了窗口六成 ——
 * 这一类要靠「行的性质」认，不是靠同一行重复。
 */
function detectFillerLines(parsed) {
  const marks = parsed.lines.map((line, index) => {
    if (!parsed.marks[index]) return false
    const trimmed = line.trim()
    if (trimmed.length > MAX_FILLER_LEN) return false
    return [...trimmed].some(char => FILLER_CHARS.has(char))
  })
  const filled = marks.filter(Boolean).length
  const total = parsed.lines.length
  if (filled < MIN_FILLER_LINES || filled / total < MIN_FILLER_RATIO) return undefined
  const ratio = filled / total
  return {
    pattern: 'filler-lines', count: filled, total, ratio,
    severity: ratio >= SEVERE_FILLER_RATIO ? 'severe' : 'mild', ...parsed, marks,
  }
}

/**
 * 模式三：弱循环 —— 末尾被少数几条很短的重复行占满。
 *
 * 实测样本（2026-09-25，她的会话 turn 19~20，隔着空行的三行轮转）：
 *
 *     好。
 *
 *     做。
 *
 *     输出。
 *
 *     好。
 *
 *     做。
 *
 *     （停止循环）
 *
 *     好。
 *     …持续几十行
 *
 * 这是**轮转**而不是单行刷屏：任何一行都到不了 15 次，占比也到不了 20%（实测最高 0.14），
 * 但「好。/做。/输出。」这三条短句加起来占了尾巴七成 —— 尾巴被少数短句占满，本身就是卡带。
 */
function detectLineCycle(parsed) {
  const window = parsed.window.filter(line => line.length <= CYCLE_MAX_LINE_LEN)
  if (parsed.window.length < CYCLE_MIN_LINES) return undefined
  const tallies = new Map()
  for (const line of window) tallies.set(line, (tallies.get(line) ?? 0) + 1)
  const top = [...tallies].sort((left, right) => right[1] - left[1]).slice(0, CYCLE_TOP)
  const covered = top.reduce((sum, [, seen]) => sum + seen, 0)
  const ratio = covered / parsed.window.length
  if (ratio < CYCLE_COVER_RATIO) return undefined
  return {
    pattern: 'line-cycle', cycle: top.map(([line]) => line), count: covered,
    total: parsed.window.length, ratio, severity: 'mild', ...parsed,
  }
}

/**
 * 模式四：行首单调 —— 几乎每一行都以同一个短前缀开头。
 *
 * 实测样本（哥哥 2026-09-25 报的第二种退化形状）：
 *
 *     嗯，先落盘。
 *     嗯，然后再压缩。
 *     嗯，这次先不改代码。
 *     嗯，……
 *
 * 每一行都还带着内容，所以**只提醒、不清理**（见 loop-clean.js 的说明）：
 * 删掉这些行等于丢信息，而提醒足以让模型改掉这个腔调。
 */
function detectPrefixMonotony(parsed) {
  if (parsed.window.length < PREFIX_MIN_LINES) return undefined
  const tallies = new Map()
  for (const line of parsed.window) {
    const match = PREFIX_DELIMITER.exec(line.slice(0, PREFIX_MAX_LEN + 1))
    if (match === null) continue
    const prefix = line.slice(0, match.index + 1)
    if (prefix.length > PREFIX_MAX_LEN) continue
    tallies.set(prefix, (tallies.get(prefix) ?? 0) + 1)
  }
  const { key: prefix, count } = topEntry(tallies)
  if (prefix === undefined || count < PREFIX_MIN_LINES) return undefined
  const ratio = count / parsed.window.length
  if (ratio < PREFIX_RATIO) return undefined
  return { pattern: 'prefix-monotony', prefix, count, total: parsed.window.length, ratio, severity: 'mild', ...parsed }
}

/**
 * 判定表，**顺序即优先级**：越确定、清理越安全的排前面。
 *
 * `cleanable` 表示这个模式**有能力**被判成严重档（因而可能被请求层硬清理）；
 * 具体这一轮算不算严重，由 detect 出来的 `hit.severity` 说了算 —— 同一种形状，
 * 重复占满尾巴时才清，稀疏轮转只提醒。
 *
 * 加一个模式就是加一项：写一个 detect(text) → hit|undefined，并声明 cleanable。
 * 样本比描述有用，注释里请抄真机样本。
 */
const DETECTORS = [
  { id: 'line-repeat', cleanable: true, detect: detectLineRepeat },
  { id: 'filler-lines', cleanable: true, detect: detectFillerLines },
  { id: 'line-cycle', cleanable: false, detect: detectLineCycle },
  { id: 'prefix-monotony', cleanable: false, detect: detectPrefixMonotony },
]

/** 所有模式 id，按判定顺序。 */
export const PATTERN_IDS = DETECTORS.map(entry => entry.id)

/**
 * 有资格被硬清理的模式（顺序即清理顺序）。
 *
 * 请求层的清理表必须与它逐字一致 —— `loop-clean.js` 在加载时就校对，
 * 免得两张表各自漂开（那正是弱循环"能清却从不提醒"的成因）。
 */
export const CLEANABLE_IDS = Object.freeze(DETECTORS.filter(entry => entry.cleanable).map(entry => entry.id))

/**
 * 跑一遍判定表，返回第一个命中的模式。
 *
 * @param {string} text 一段助手输出（思考块 + 正文块拼起来的）。
 * @param {string[]} [only] 只跑这些模式；省略表示全跑。
 * @returns {object|undefined} 命中信息（含 `severity`）；没命中返回 undefined。
 */
export function detectDegradation(text, only) {
  const parsed = parse(text)
  for (const entry of DETECTORS) {
    if (only !== undefined && !only.includes(entry.id)) continue
    const hit = entry.detect(parsed)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * 把命中信息写成给模型看的一句话（不含"该怎么办"的部分）。
 *
 * @param {object} hit 命中信息。
 * @returns {string} 例如「最近一条回复里「好。 → 做。 → 输出。」这组短句重复了 52 次」。
 */
export function describeHit(hit) {
  const percent = Math.round(hit.ratio * 100)
  const tail = `，占末尾 ${hit.total} 行的 ${percent}%`
  if (hit.pattern === 'line-repeat') {
    const line = hit.line.length > 40 ? `${hit.line.slice(0, 40)}…` : hit.line
    return `最近一条回复里「${line}」重复了 ${hit.count} 次${tail}`
  }
  if (hit.pattern === 'line-cycle') {
    return `最近一条回复里「${hit.cycle.join(' → ')}」这组短句来回重复了 ${hit.count} 次${tail}`
  }
  if (hit.pattern === 'filler-lines') {
    return `最近一条回复里有 ${hit.count} 行是「嗯/做/好」这类不承载信息的碎念${tail}`
  }
  if (hit.pattern === 'prefix-monotony') {
    return `最近一条回复里有 ${hit.count} 行都以「${hit.prefix}」开头${tail}`
  }
  return `最近一条回复的末尾有退化迹象${tail}`
}
