/** 完成措辞提醒的呈现；候选、冷却、路由及交付额度由引擎决定。 */
export function completionNoticeText(candidate) {
  return `上一份输出使用了“${candidate.label}”等完成表述。它是输出措辞的观察结果。请依据实际请求、交付内容和验证记录核对完成范围；若仍有已授权工作，继续完成。`
}
