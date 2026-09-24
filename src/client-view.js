import React from 'react'

export const dictionaries = {
  zh: {
    fatigue: '疲劳度', wakefulness: '唤醒值', unknown: '未校准', low: '低', normal: '正常',
    elevated: '较高', high: '高', 'very-high': '很高',
    waiting: '等待首次状态', description: '最近一次请求准备时的负荷与保留信息量估算；不是记忆可靠性判断，也不是任务时限。',
    rewriteTitle: '请求改写', rewriteRemoved: '去掉', rewriteLines: '行重复内容',
    rewriteUnknown: '未记录', rewriteChars: '字符',
  },
  en: {
    fatigue: 'Fatigue', wakefulness: 'Wakefulness', unknown: 'Uncalibrated', low: 'Low', normal: 'Normal',
    elevated: 'Elevated', high: 'High', 'very-high': 'Very high',
    waiting: 'Awaiting first sample', description: 'Load and retained-information estimates at the latest request preparation; not a memory-quality diagnosis or a task deadline.',
    rewriteTitle: 'Request rewrite', rewriteRemoved: 'removed', rewriteLines: 'repeated lines',
    rewriteUnknown: 'not recorded', rewriteChars: 'characters',
  },
}

export function tone(value, kind) {
  if (!Number.isFinite(value)) return 'var(--dsw-alias-label-secondary)'
  const band = value < 30 ? 0 : value < 60 ? 1 : value < 85 ? 2 : 3
  // High wakefulness means more retained information, so it is not a danger color.
  const palette = kind === 'wakefulness'
    ? ['var(--dsw-alias-state-warn-primary)', '#3b82f6', '#14b8a6', 'var(--dsw-alias-state-success-primary)']
    : ['var(--dsw-alias-state-success-primary)', '#3b82f6', 'var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-error-primary)']
  return palette[band]
}

function indicator(label, value, level, kind, t) {
  const text = value === null || value === undefined ? `${label}: ${t('unknown')}` : `${label}: ${value}% (${t(level)})`
  return React.createElement('span', { style: { color: tone(value, kind), fontWeight: 600 } }, text)
}

/** Pure display receives the framework-owned projection hook. */
export function ContextCareStatus({ useProjection, t }) {
  const state = useProjection('contextCareNumeric')
  return React.createElement('div', {
    'data-context-care': '', role: 'status', title: t('description'),
    style: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', padding: '2px 4px' },
  },
  indicator(t('fatigue'), state?.fatigueValue, state?.fatigue ?? 'unknown', 'fatigue', t),
  indicator(t('wakefulness'), state?.wakefulnessValue, state?.wakefulness ?? 'unknown', 'wakefulness', t),
  !state ? React.createElement('span', null, t('waiting')) : null)
}
