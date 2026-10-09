/**
 * 把规则集作用在一段文本上。
 *
 * 纯函数：同样的输入必然得到同样的输出（正则缓存只是加速，不影响结果）。
 * 这一层不知道时间、不知道谁在消费 —— 冷却、surface 去重、消费者路由都在 engine.js。
 */

import { matchRule } from './match.js'
import { runRegexScript, defaultRegexProvider } from './regex.js'
import { cacheLossRatio } from './budget.js'

/**
 * @param {object} input
 * @param {object[]} input.rules 规范化并排好序的规则。
 * @param {object} input.surface 待处理的一段文本（见 README 的 surface 形状）。
 * @param {object} [input.ctx] 会话级上下文。
 * @param {string|null} [input.previous] 最近一次同接口请求的文本；用来算这次变换的缓存代价。
 * @param {(text: string, transform?: Function) => string} [input.macros] 宏替换。
 * @param {import('./regex.js').RegexProvider} [input.provider] 正则缓存。
 * @param {(rule: object, surface: object) => ({ok: boolean, outcome?: string, detail?: string}|undefined)} [input.gate]
 *        额外的准入判定。冷却、surface 去重这类有状态的判断由 engine 注入；
 *        返回 undefined 表示放行，返回对象必须带布尔 ok。
 * @returns {{text: string, hits: object[]}} 变换后的文本与命中记录。
 * @throws {TypeError|Error} 入参形状不对、或某条规则的正则编译不出来时抛出。
 */
export function applyRules({ rules, surface, ctx = {}, previous = null, macros, provider = defaultRegexProvider, gate }) {
  if (!Array.isArray(rules)) {
    throw new TypeError('dsh-rule-engine: applyRules expects rules to be an array')
  }
  if (typeof surface !== 'object' || surface === null) {
    throw new TypeError('dsh-rule-engine: applyRules expects a surface object')
  }
  if (typeof surface.text !== 'string') {
    throw new TypeError('dsh-rule-engine: surface.text must be a string (use "" when there is no text)')
  }
  if (gate !== undefined && typeof gate !== 'function') {
    throw new TypeError('dsh-rule-engine: gate must be a function')
  }
  const baseline = surface.text
  let text = baseline
  const hits = []
  for (const rule of rules) {
    const current = { ...surface, text }
    const verdict = matchRule(rule, current, ctx, { provider, macros })
    if (!verdict.ok) continue
    if (gate !== undefined) {
      const allowed = gate(rule, current)
      if (allowed !== undefined) {
        if (typeof allowed !== 'object' || allowed === null || typeof allowed.ok !== 'boolean') {
          throw new TypeError('dsh-rule-engine: gate must return undefined or { ok: boolean, outcome?, detail? }')
        }
        if (!allowed.ok) {
          hits.push({
            ruleId: rule.id,
            kind: rule.action.kind,
            placement: surface.placement,
            applied: false,
            outcome: allowed.outcome,
            detail: allowed.detail,
          })
          continue
        }
      }
    }
    if (rule.action.kind === 'transform') {
      const next = runRegexScript(rule.when, text, { macros, provider })
      // 代价按「这条规则自己造成的增量」算：前面几条已经改过的地方不该重复计入。
      const loss = cacheLossRatio(previous, baseline, next) - cacheLossRatio(previous, baseline, text)
      if (loss > rule.budget.maxCacheLoss) {
        hits.push({
          ruleId: rule.id,
          kind: 'transform',
          placement: surface.placement,
          applied: false,
          outcome: 'over-budget',
          detail: '这条规则要废掉 ' + (loss * 100).toFixed(2) + '% 的缓存，超过它自己的预算 ' + (rule.budget.maxCacheLoss * 100).toFixed(2) + '%',
          loss,
          action: rule.action,
        })
        continue
      }
      hits.push({
        ruleId: rule.id,
        kind: 'transform',
        placement: surface.placement,
        applied: true,
        changed: next !== text,
        loss,
        action: rule.action,
      })
      text = next
    } else {
      hits.push({
        ruleId: rule.id,
        kind: 'notify',
        placement: surface.placement,
        applied: true,
        changed: false,
        loss: 0,
        action: rule.action,
      })
    }
  }
  return { text, hits }
}
