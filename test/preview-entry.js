import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ActionDetails } from '../src/action-view.js'
import { PromptDetails } from '../src/prompt-view.js'
import { CareStyles } from '../src/care-styles.js'
import { dictionaries, ContextCareStatus } from '../src/client-view.js'
import { NoticeNodeView } from '../src/notice-view.js'
import { RewriteNodeView } from '../src/rewrite-view.js'

// Public synthetic facts exercise the production components; no session history is exported.
const h = React.createElement
const t = key => dictionaries.zh[key] ?? key
const at = Date.parse('2026-10-08T14:00:00+08:00')
const action = { id: 'synthetic-action', at, action: 'summary', phase: 'committed', outcome: 'committed', reason: 'automatic', rule: 'fresh-summary',
  beforeInput: 153300, afterInput: 57348, checkpointSeq: 33120, shadowedSeqs: Array.from({ length: 228 }, (_, i) => 30000 + i),
  replacements: [{ oldStartSeq: 30000, oldEndSeq: 30227, newSeq: 33120 }],
  coverage: { depth: 3, leafSeqs: Array.from({ length: 4000 }, (_, i) => 25000 + i) }, journalPersisted: true,
  commits: [{ route: { provider: '示例提供方', model: 'summary-model' }, usage: { inputTokens: 42400, outputTokens: 3200 }, shadowedTokenCount: 129800 }], routeSaving: 95952, heuristicSaving: 103500 }
const prompt = { id: 'synthetic-prompt', seq: 33106, at, kind: 'request', producer: 'dsh-context-care:scoped-prompts',
  text: '<context-care>\n最近的回复中出现了完成表述。请依据实际结果确认工作是否完成，并说明尚未验证或尚未完成的部分。\n\n来源：先前回复中记录的完成声明。\n</context-care>',
  segments: [{ ruleId: 'completion-observation', version: 1, trigger: 'completion', metrics: { repeats: 3, observationCount: 6, matched: true } }],
  calls: [{ dispatched: true, phase: 'completed', route: { provider: '示例提供方', model: 'main-model' } }],
  sources: [{ seq: 33099, type: 'assistant/message', excerpt: '已完成这轮修改，验证结果见记录。这里是合成消息，用来检验来源节选和导航反馈。' }] }
const admission = { dispatched: true, route: { provider: '示例提供方', model: 'main-model' },
  budget: { inputTokens: 153300, hardInput: 180000, softInput: 144000, releaseTarget: 108000, physicalCapacity: 200000, policyCapacity: 180000, retainTail: 12000, completionTokens: 8000 }, pricing: { kind: 'route-calibrated', textScale: 1.1, sampleSeq: 33080 } }
function Preview() {
  const [mode, setMode] = useState(new URLSearchParams(location.search).get('view') || 'actions')
  const [located, setLocated] = useState(null)
  const revealSource = async seq => { setLocated(seq); throw Object.assign(new Error('Preview has no live chat'), { code: 'jumpMissing' }) }
  return h(React.Fragment, null, h('aside', { className: 'preview-banner' }, '合成数据 · 真实生产组件预览', h('nav', null,
    h('button', { onClick: () => setMode('actions') }, '维护记录'), h('button', { onClick: () => setMode('prompts') }, '提示记录'), h('button', { onClick: () => setMode('cards') }, '会话卡片'),
    h('button', { onClick: () => document.body.toggleAttribute('data-ds-dark-theme') }, '切换深浅主题'))),
    h('section', { 'data-care-panel': '', className: 'preview-panel' }, h(CareStyles),
      h('header', null, h('h3', null, t(mode === 'actions' ? 'actionsTitle' : 'promptsTitle'))),
      h('main', null, mode === 'actions' ? h(ActionDetails, { value: { status: 'ready', actions: [action], admission }, t, revealSource })
        : mode === 'prompts' ? h(PromptDetails, { value: { status: 'ready', prompts: [prompt] }, t, revealSource })
        : h(React.Fragment, null,
          h(ContextCareStatus, { sessionId: 'preview', t, useProjection: () => ({ fatigueValue: 61.2, wakefulnessValue: 32.8, fatigue: 'high', wakefulness: 'normal' }),
            useCareActions: selector => selector(new Map()), useRewriteHealth: selector => selector(new Map([['preview', { status: 'ready' }]])), watchActions: () => () => {}, watchRewrites: () => () => {} }),
          h(NoticeNodeView, { sessionId: 'preview', t, openPrompts: () => setMode('prompts'), node: { data: { seq: 33100, producer: 'dsh-context-care:state', summary: '', values: [{ kind: 'fatigue', value: 61.2 }, { kind: 'wakefulness', value: 32.8 }], body: '上下文负载在上升。到自然的工作边界时，保存当前目标、已验证结果和找回路径，然后继续任务。' } } }),
          h(RewriteNodeView, { sessionId: 'preview', t, watchRewrites: () => () => {}, node: { data: { hashes: ['example'] } }, useRewriteRecords: selector => selector(new Map([['preview:example', { pattern: 'line-repeat', charsBefore: 1220, charsAfter: 840, removedLines: 12, removed: '同一段落重复出现……', added: '保留一次原段落。' }]])) }))),
      h('footer', null, h('span', null, '第 1 / 1 页'), located == null ? null : h('span', { role: 'status' }, `预览请求定位 #${located}`))))
}
createRoot(document.getElementById('root')).render(h(Preview))
