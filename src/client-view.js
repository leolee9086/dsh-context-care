import React, { useEffect } from 'react'
import { CareStyles } from './care-styles.js'
import { careCopy } from './care-copy.js'

export const dictionaries = {
  zh: {
    ...careCopy.zh,
    fatigue: '疲劳度', wakefulness: '唤醒值', unknown: '未校准', low: '低', normal: '正常',
    elevated: '较高', high: '高', 'very-high': '很高',
    waiting: '等待首次状态', description: '最近一次请求准备时的负荷与保留信息量估算；不是记忆可靠性判断，也不是任务时限。',
    rewriteTitle: '请求改写', rewriteRemoved: '去掉', rewriteLines: '行重复内容',
    rewriteUnknown: '未记录', rewriteChars: '字符',
    noticeTitle: '上下文照料', noticeUnknown: '未知来源',
    noticeSubState: '状态', noticeSubRequest: '请求改写', noticeSubLoop: '循环清理',
    noticeSubWatch: '流式提醒', noticeSubRules: '规则',
    actionsTitle: '预算与维护记录', actionsLoading: '正在读取记录', actionsUnavailable: '记录暂不可用', actionsEmpty: '还没有维护动作',
    actionsAdmission: '最近主请求路由', actionsInput: '完整输入估算', actionsCapacity: '物理容量 / 政策容量',
    actionsLimits: '软阈值 / 硬限额 / 释放目标', actionsRetention: '近况留存 / 输出预留', actionsDispatch: '派发状态',
    actionsSent: '已派发', actionsNotSent: '尚未派发', actionsNoAdmission: '尚无请求预算记录',
    actionsBasis: '输入估算来源', actionsTextScale: '文本校准比例', actionsSample: '样本序号', actionsRawPrices: '原始文本含 schema / 独立视觉价格',
    actionsIdentity: '动作编号', actionsRule: '选择规则', actionsSources: '选区来源序号', actionsPrice: '维护前后输入估算',
    actionsSavings: '路由计价降幅 / 固定估算降幅', actionsReplacement: '替换范围', actionsCheckpoint: '检查点序号',
    actionsCoverage: '原始覆盖序号', actionsDepth: '加工深度', actionsCandidates: '候选范围与预测降幅', actionsError: '失败原因',
    actionsJournal: '记录状态', actionsPersisted: '动作记录已持久化', actionsRecovered: '已从会话恢复提交事实，动作记录不完整',
    actionsReason: '触发原因', reason_automatic: '输入压力达到维护条件', reason_requested: '主动调用 context_rest', reason_overflow: '请求预算拒绝或上下文溢出',
    actionsReasonUnknown: '当时的触发原因未记录', actionsSessionOnly: '来自会话压缩记录；未找到本插件动作审计，无法判断当时是否采集',
    actionsPartial: '已有部分动作审计；提交事实由会话核对', actionsMissingPrice: '当时的完整输入前后估算未记录',
    actionsShadowPrice: '被替换内容固定估算', actionsSummaryUsage: '摘要调用输入 / 输出用量', actionsSummaryRoute: '摘要路由', actionsAuditKeys: '审计记录键',
    actionsSourceCount: '个来源记录', action_checkpoint: '历史检查点',
    promptsTitle: '提示详情与溯源', promptsOpen: '在右侧栏查看所有上下文照料提示', promptsDetails: '详情与溯源',
    promptsExplanation: '正文来自当时保存的消息或请求决策。来源事件与请求派发分开列出；没有旧审计时不推测触发原因。',
    promptsEmpty: '尚无可读取的提示记录', promptsNotFound: '未找到所选来源事件', promptsSource: '发布来源', promptsTime: '记录时间', promptsIdentity: '记录编号',
    promptsTrigger: '触发依据', promptsSegment: '提示段落', promptsCalls: '关联请求', promptsSources: '来源事件', promptsExcerpt: '正文节选',
    promptsNotRecorded: '未记录或无法读取', promptsNoCalls: '没有关联请求审计；不据此判断是否已送达模型', promptsNoSources: '没有来源事件引用',
    promptsEvaluations: '持久规则评估记录', promptsSegmentsOnly: '旧记录只保存了提示段落；下面是段落文本，缺少原始包装正文。',
    promptsLegacyTrace: '此历史提示没有保存结构化触发依据；正文与发布来源仍可核对。',
    prompt_checkpoint: '插件检查点与续接提示', prompt_message: '会话提示', prompt_request: '请求专属提示', prompt_guidance: '系统照料说明', 'prompt_summary-instruction': '摘要生成指令',
    actionsPrevious: '较新记录', actionsNext: '更早记录',
    actionsBudget: '当前请求预算', actionsUsage: '输入占硬限额 ', actionsSoftLimit: '软阈值', actionsReleaseTarget: '释放目标',
    actionsTechnical: '计价与保留策略', actionsHistory: '维护记录', actionsRefresh: '刷新', actionsPage: '页',
    actionsOpen: '在右侧栏打开预算与维护记录', actionsOpenFailed: '无法打开记录',
    action_prune: '裁剪', action_summary: '摘要', 'action_deep-rest': '深度休息', action_selection: '选区规划',
    phase_started: '执行中', phase_planning: '规划', phase_prepared: '提交准备', phase_repaired: '输入已修复',
    phase_committed: '已提交', phase_completed: '已结算', phase_failed: '失败', 'phase_no-useful-range': '同一选区无收益', 'phase_commit-record-failed': '已提交，审计写入失败',
    outcome_partial: '已有部分持久进展', outcome_failed: '未完成', outcome_committed: '已缩小输入', outcome_noop: '输入未缩小',
    'rule_fresh-summary': '新内容摘要', 'rule_checkpoint-merge': '检查点合并', 'rule_basic-prefix': '压力前缀兜底',
  },
  en: {
    ...careCopy.en,
    fatigue: 'Fatigue', wakefulness: 'Wakefulness', unknown: 'Uncalibrated', low: 'Low', normal: 'Normal',
    elevated: 'Elevated', high: 'High', 'very-high': 'Very high',
    waiting: 'Awaiting first sample', description: 'Load and retained-information estimates at the latest request preparation; not a memory-quality diagnosis or a task deadline.',
    rewriteTitle: 'Request rewrite', rewriteRemoved: 'removed', rewriteLines: 'repeated lines',
    rewriteUnknown: 'not recorded', rewriteChars: 'characters',
    noticeTitle: 'Context care', noticeUnknown: 'unknown producer',
    noticeSubState: 'state', noticeSubRequest: 'request rewrite', noticeSubLoop: 'loop cleanup',
    noticeSubWatch: 'stream watch', noticeSubRules: 'rule',
    actionsTitle: 'Budget and maintenance', actionsLoading: 'Loading records', actionsUnavailable: 'Records unavailable', actionsEmpty: 'No maintenance actions yet',
    actionsAdmission: 'Latest conversation route', actionsInput: 'Complete input estimate', actionsCapacity: 'Physical / policy capacity',
    actionsLimits: 'Soft / hard / release target', actionsRetention: 'Retained tail / output reservation', actionsDispatch: 'Dispatch',
    actionsSent: 'Dispatched', actionsNotSent: 'Not dispatched', actionsNoAdmission: 'No admission record yet',
    actionsBasis: 'Input estimate basis', actionsTextScale: 'Text calibration scale', actionsSample: 'Sample sequence', actionsRawPrices: 'Raw text including schema / independent visual price',
    actionsIdentity: 'Action ID', actionsRule: 'Selection rule', actionsSources: 'Selected source sequences', actionsPrice: 'Input estimate before / after',
    actionsSavings: 'Route saving / fixed estimate saving', actionsReplacement: 'Replacement', actionsCheckpoint: 'Checkpoint sequence',
    actionsCoverage: 'Original leaf sequences', actionsDepth: 'Processing depth', actionsCandidates: 'Candidates and predicted saving', actionsError: 'Failure',
    actionsJournal: 'Record status', actionsPersisted: 'Action record persisted', actionsRecovered: 'Commit recovered from session; action audit incomplete',
    actionsReason: 'Trigger', reason_automatic: 'Input pressure meets maintenance conditions', reason_requested: 'Explicit context_rest call', reason_overflow: 'Request budget rejection or context overflow',
    actionsReasonUnknown: 'Trigger was not recorded', actionsSessionOnly: 'Session compaction record; no plugin action audit found, collection at that time is unknown',
    actionsPartial: 'Partial action audit; commit verified against session history', actionsMissingPrice: 'Complete input estimates before and after were not recorded',
    actionsShadowPrice: 'Fixed estimate of replaced material', actionsSummaryUsage: 'Summary call input / output usage', actionsSummaryRoute: 'Summary route', actionsAuditKeys: 'Audit record keys',
    actionsSourceCount: 'source records', action_checkpoint: 'History checkpoint',
    promptsTitle: 'Prompt details and sources', promptsOpen: 'View all context care prompts in the right sidebar', promptsDetails: 'Details and sources',
    promptsExplanation: 'Text comes from the saved message or request decision. Source events and request handoff are separate; missing historical triggers are not inferred.',
    promptsEmpty: 'No readable prompt records yet', promptsNotFound: 'Selected source event was not found', promptsSource: 'Producer', promptsTime: 'Recorded at', promptsIdentity: 'Record ID',
    promptsTrigger: 'Trigger evidence', promptsSegment: 'Prompt segment', promptsCalls: 'Related requests', promptsSources: 'Source events', promptsExcerpt: 'Text excerpt',
    promptsNotRecorded: 'Not recorded or unavailable', promptsNoCalls: 'No related request audit; this does not establish model delivery', promptsNoSources: 'No source event references',
    promptsEvaluations: 'Durable rule evaluations', promptsSegmentsOnly: 'This older record retains segments only; the text below lacks the original wrapper.',
    promptsLegacyTrace: 'This historical prompt has no structured trigger evidence; its text and producer remain available.',
    prompt_checkpoint: 'Plugin checkpoint and continuation prompt', prompt_message: 'Session prompt', prompt_request: 'Request-only prompt', prompt_guidance: 'System care guidance', 'prompt_summary-instruction': 'Summary generation instruction',
    actionsPrevious: 'Newer records', actionsNext: 'Older records',
    actionsBudget: 'Current request budget', actionsUsage: 'Input / hard limit ', actionsSoftLimit: 'Soft limit', actionsReleaseTarget: 'Release target',
    actionsTechnical: 'Pricing and retention', actionsHistory: 'Maintenance history', actionsRefresh: 'Refresh', actionsPage: 'Page',
    actionsOpen: 'Open budget and maintenance in the right sidebar', actionsOpenFailed: 'Unable to open records',
    action_prune: 'Prune', action_summary: 'Summary', 'action_deep-rest': 'Deep rest', action_selection: 'Selection',
    phase_started: 'Running', phase_planning: 'Planning', phase_prepared: 'Prepared', phase_repaired: 'Input repaired',
    phase_committed: 'Committed', phase_completed: 'Settled', phase_failed: 'Failed', 'phase_no-useful-range': 'Unchanged range has no gain', 'phase_commit-record-failed': 'Committed; audit failed',
    outcome_partial: 'Partial durable progress', outcome_failed: 'Incomplete', outcome_committed: 'Input reduced', outcome_noop: 'Input unchanged',
    'rule_fresh-summary': 'Fresh material', 'rule_checkpoint-merge': 'Checkpoint merge', 'rule_basic-prefix': 'Pressure prefix fallback',
  },
}

export function tone(value, kind) {
  if (!Number.isFinite(value)) return 'var(--dsw-alias-label-secondary)'
  const band = value < 30 ? 0 : value < 60 ? 1 : value < 85 ? 2 : 3
  // High wakefulness means more retained information, so it is not a danger color.
  const palette = kind === 'wakefulness'
    ? ['var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-business-primary)', 'var(--dsw-alias-state-success-secondary)', 'var(--dsw-alias-state-success-primary)']
    : ['var(--dsw-alias-state-success-primary)', 'var(--dsw-alias-state-business-primary)', 'var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-error-primary)']
  return palette[band]
}

function indicator(label, value, level, kind, t) {
  const text = value === null || value === undefined ? `${label}: ${t('unknown')}` : `${label}: ${value}% (${t(level)})`
  return React.createElement('span', { style: { color: tone(value, kind) } }, text)
}

/** Pure display receives the framework-owned projection hook. */
export function ContextCareStatus({ useProjection, useCareActions, useRewriteHealth, watchActions, sessionId, t }) {
  const state = useProjection('contextCareNumeric')
  const actions = useCareActions(table => table.get(`${sessionId}:0`))
  const health = useRewriteHealth(value => value)
  useEffect(() => watchActions(sessionId, 0), [sessionId, watchActions])
  const error = actions?.status === 'error' ? actions.error : health?.status === 'error' ? health.error : undefined
  return React.createElement('div', {
    'data-context-care': '', role: 'status', title: t('description'),
  },
  React.createElement(CareStyles),
  indicator(t('fatigue'), state?.fatigueValue, state?.fatigue ?? 'unknown', 'fatigue', t),
  indicator(t('wakefulness'), state?.wakefulnessValue, state?.wakefulness ?? 'unknown', 'wakefulness', t),
  error ? React.createElement('span', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, `${t('actionsUnavailable')}: ${error}`)
    : !state ? React.createElement('span', null, t('waiting')) : null)
}
