/** S-forge curves, separated from host lifecycle and model-facing text. */
export function resolveConfig(raw = {}) {
  const spec = {
    budgetRatio: 0.8,
    wakefulnessRatio: 1 / 3,
    fatigueExponent: 1.5,
    retainRatio: 0.16,
    minFreshTokens: 1024,
    // 交接笔记的字数区间。**宜细不宜粗**：下限存在的意义是把"随便写两句"堵掉——
    // 一份写到几百字的笔记，下一个自己不用再去翻日志就能接着干。
    minNoteChars: 1000,
    maxNoteChars: 10000,
    ...raw,
  }
  for (const key of Object.keys(raw)) {
    if (!['budgetRatio', 'wakefulnessRatio', 'fatigueExponent', 'retainRatio', 'minFreshTokens', 'minNoteChars', 'maxNoteChars'].includes(key)) {
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
  for (const key of ['minFreshTokens', 'minNoteChars', 'maxNoteChars']) {
    if (!Number.isSafeInteger(spec[key]) || spec[key] <= 0) throw new Error(`context-care: ${key} must be a positive integer`)
  }
  if (spec.minNoteChars >= spec.maxNoteChars) throw new Error('context-care: minNoteChars must be below maxNoteChars')
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

// ---------------------------------------------------------------- 模型面向的文本
//
// 一律用中文：哥哥 2026-09-19 的要求。这个插件注入的每一句都是给模型看的，
// 而这里的模型（DeepSeek 系列）和读日志的人（哥哥）都是中文母语的，
// 英文标签除了多一层翻译之外没有任何好处。

/** 等级显示名。unknown 也在这里 —— 漏一个就会让英文枚举值漏进提示里。 */
const FATIGUE_LABEL = { normal: '正常', elevated: '升高', high: '高', 'very-high': '非常高', unknown: '未知' }
const WAKEFULNESS_LABEL = { low: '低', normal: '正常', elevated: '升高', high: '高', unknown: '未知' }

/**
 * 分等级的下一步建议。
 *
 * 为什么必须分级（哥哥 2026-09-19 的诊断，我当时的行为就是证据）：
 * 旧版不管哪一级都输出同一句「继续任务，检查点会有帮助时用 context_rest」——
 * 那是**许可**，不是**推动**。实测里我在疲劳 39%、唤醒值 90% 的时候反复说
 * 「该落盘了」「要不要压缩」，然后继续往下查，始终没动手。
 * 强度必须跟着等级走，very-high 时明确指向深度休息（清空历史、只留交接）。
 *
 * very-high 最后那句是**重构**，不是加重语气：把「休息会丢信息」的恐惧，
 * 换成「带着疲劳继续做才是不可恢复的损失」。恐惧不拆掉，就没有人肯撒手。
 */
const ADVICE = {
  normal: ['照常推进任务。'],
  elevated: ['上下文负载在上升。到自然的工作边界时，把要紧的东西落盘，然后可以考虑 context_rest。'],
  high: [
    '这次会话靠前的部分正在变得不好回忆。继续之前：先把要紧的写下来，再压缩。',
    '摘要能留住线索；context_rest 更省。',
  ],
  'very-high': [
    '已经过了「继续做下去还划算」的那个点 —— 回忆不可靠，错误会叠加。',
    '不要再往上加工作了：现在就把要紧的东西落盘，然后做一次深度休息（清空历史，只留交接）。',
    '清空的是表层，不是记忆：细节还能从会话日志里用 session_blocks_* 找回来；但在这个状态下做出来的活儿找不回来。',
  ],
}

/**
 * 常驻系统提示段。
 *
 * 末两行是这次改动的关键：旧版收尾是「不要仅凭一个状态标签就赶工、停下或反复压缩」，
 * 本意是对的（标签是估计不是诊断），但它**不分等级**，所以在 very-high 时也在踩刹车 ——
 * 恰恰在最该撒手的时候给出了继续硬撑的理由。现在拆成两句：
 * 慌和乱压仍然要禁止，但等级给出的具体建议动作要照做。
 *
 * 2026-09-22 哥哥要求补一条：自己犹豫两次要不要压缩时就直接压。理由是犹豫本身就是消耗，
 * 而且它跟「被标签推着反复压缩」是相反的毛病，必须分开写 —— 否则两条规则看起来会互相打架。
 */
export const GUIDANCE = `上下文照料（疲劳度 / 唤醒值）：
这两个数字是负载与留存信息量的估计，不是记忆丢失、幻觉、能力受损的证据，也不是任务的截止时间。
不要从对话长度、或者「感觉快用完了」去推断还剩多少容量。
照常推进任务。唤醒值低只意味着留存下来的上下文少：缺事实时去查检查点或相关文件，不要编造细节，也不要用废话把对话撑长。
在合适的工作边界就可以调用 context_rest，不必等到疲劳度很高。交接笔记**宜细不宜粗**：写清当前目标、已验证的进度、未完成的工作和重要路径；不可复原的细节先落盘到文件。**发出请求不等于压缩已经完成** —— 等下一次状态报告，然后再接着干。
自动压缩仍然是容量的兜底。
状态标签是估计，不是命令：不要因为一个标签而慌、赶工或者反复压缩。
但标签的等级升高时会给出具体的建议动作（先落盘、再休息）—— 那部分要照做，不要拿「这只是估计」当作继续硬撑的理由。
如果已经在「要不要压缩」上打转两次，那就直接压：纠结的消耗比压一次更大。这跟「因为标签升高而反复压缩」是两件事 —— 前者是自己下不了决心，后者是被数字推着走。`

/** 有界、缓存稳定的状态文本：不给原始的剩余 token 倒计时。 */
export function renderState(state, outcome) {
  const lines = [
    '<context-care>',
    `疲劳：${FATIGUE_LABEL[state.fatigue] ?? state.fatigue}；唤醒值：${WAKEFULNESS_LABEL[state.wakefulness] ?? state.wakefulness}。`,
    '这是基于最近一次请求与当前留存历史的估计，不是任务的截止时间。',
  ]
  if (state.fatigue === 'unknown') lines.push('这次请求没有校准容量，不要猜。')
  if (outcome) lines.push(`休息结果：${outcome}。`)
  // 建议放在最后：它是这一整段里唯一要照做的东西，位置也该在最后。
  lines.push(...(ADVICE[state.fatigue] ?? ADVICE.normal), '</context-care>')
  return lines.join('\n')
}