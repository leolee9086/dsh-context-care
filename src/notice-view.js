import React from 'react'
import { tone } from './client-view.js'

/**
 * 会话流里的注入通知节点。
 *
 * 宿主把通知类消息归到 `context` 节点,而 `isVisibleChatNode` 有意排除普通 Context 行
 * (只保留含工具增删的那种),所以这类消息在 Chat 里从来不显示。它们却是直接发给模型的
 * 旁路内容(状态、规则命中、循环提醒,以及别的插件在通知通道注册的源),人需要逐条看到。
 * 这里用自己的节点类型承接下来,渲染成人能读的样子。
 */
export const NOTICE_NODE = 'context-care-notice'

/** 本插件发布者名;别的插件注册的通知源不带这个前缀。 */
const OWN = 'dsh-context-care'

/** 子来源到字典键;没登记的按原样显示。 */
const SUB_KEYS = {
  state: 'noticeSubState',
  request: 'noticeSubRequest',
  loop: 'noticeSubLoop',
  watch: 'noticeSubWatch',
  rules: 'noticeSubRules',
}

/**
 * 一次注入的发布者名。
 * V4 写 `kind: 'plugin:<名>'`,V3 写 `plugin` 字段,两种都要认。
 * @param source - 消息的 source。
 * @returns 发布者名,读不出时为空串。
 */
export function noticeProducer(source) {
  if (source === null || typeof source !== 'object') return ''
  if (typeof source.plugin === 'string' && source.plugin !== '') return source.plugin
  const kind = source.kind
  if (typeof kind !== 'string') return ''
  return kind.startsWith('plugin:') ? kind.slice('plugin:'.length) : kind
}

/**
 * 发布者名投影成给人看的一行。
 * 本插件的来源写成「上下文照料 · 状态」;别的插件保留自己的名字。
 * @param producer - noticeProducer 的结果。
 * @param t - 字典座位。
 * @returns 展示用的来源标签。
 */
export function noticeLabel(producer, t) {
  if (producer === '') return t('noticeUnknown')
  if (producer === OWN) return t('noticeTitle')
  if (!producer.startsWith(OWN + ':')) return producer
  const [head, ...rest] = producer.slice(OWN.length + 1).split(':')
  const key = SUB_KEYS[head]
  const label = key === undefined ? head : t(key)
  return rest.length === 0 ? t('noticeTitle') + ' · ' + label : t('noticeTitle') + ' · ' + label + ' · ' + rest.join(':')
}

/** 正文里的包装标签(整行只有一个标签)对人不表达任何东西,去掉。 */
export function noticeBody(text) {
  return text
    .split('\n')
    .filter(line => !/^\s*<\/?[a-zA-Z][\w-]*>\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 注入随带的数值样本;没有或不是有限数就不报,绝不编一个。 */
export function noticeValues(source) {
  const care = source?.contextCare
  if (care === null || typeof care !== 'object') return []
  const out = []
  if (Number.isFinite(care.fatigueValue)) out.push({ kind: 'fatigue', value: care.fatigueValue })
  if (Number.isFinite(care.wakefulnessValue)) out.push({ kind: 'wakefulness', value: care.wakefulnessValue })
  return out
}

/** 文本块的正文;其它块类型(图片等)不在这里展示。 */
export function noticeText(content) {
  return (Array.isArray(content) ? content : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/**
 * 一次注入的展示数据;形状说不清时返回 undefined,由调用方决定退让。
 * @param event - 会话事件。
 * @returns `{seq, time, producer, summary, values, body}`,或 undefined。
 */
export function noticeData(event) {
  if (event?.type !== 'user/message') return undefined
  const source = event.data?.source
  if (source === null || typeof source !== 'object' || source.form !== 'notice') return undefined
  const body = noticeBody(noticeText(event.data?.content))
  if (body === '') return undefined
  const values = noticeValues(source)
  return {
    seq: event.seq,
    time: event.time,
    producer: noticeProducer(source),
    // 有数值样本时摘要没有增量信息,不显示宿主那行的占位词。
    summary: values.length > 0 ? '' : (typeof source.summary === 'string' ? source.summary : ''),
    values,
    body,
  }
}

/**
 * 匹配全部通知形式的注入。
 *
 * 只认 `form === 'notice'`:具体来源(`state` / `request` / `loop` / `watch:<id>` /
 * `rules:<id>`,以及通知通道上别的插件注册的源)各不相同,按 form 收口才收得全。
 * @returns 会话节点定义。
 */
export function createNoticeDefinition() {
  return {
    kind: NOTICE_NODE,
    target: 'chat',
    match: event => noticeData(event) === undefined ? null : { id: 'notice:' + event.seq, role: 'start' },
    start: (_context, match) => ({ seq: match.event.seq }),
    update: context => context.state,
    buildViewNode(context) {
      const start = context.start
      if (start === undefined) return null
      const data = noticeData(start.event)
      if (data === undefined) return null
      return {
        key: context.key, kind: NOTICE_NODE, id: context.id, target: 'chat',
        anchorSeq: start.event.seq, location: start.location,
        visibility: 'visible', data,
      }
    },
  }
}

/** 数值样本:百分比取整,颜色沿用状态条的色带。 */
function valueRow(values, t) {
  return values.map((entry, index) => React.createElement('span', {
    key: entry.kind, style: { color: tone(entry.value, entry.kind), fontWeight: 600 },
  }, (index === 0 ? '' : ' · ') + t(entry.kind) + ' ' + Math.round(entry.value) + '%'))
}

/**
 * 渲染一次注入:来源与数值成一行,正文按普通正文排版。
 * @param props - 框架给的节点与字典座位。
 * @returns 一行/一张通知卡片。
 */
export function NoticeNodeView({ node, t }) {
  const data = node?.data
  if (data === undefined) return null
  return React.createElement('div', {
    'data-context-care-notice': '', 'data-context-care-seq': data.seq,
    style: {
      borderLeft: '2px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35))',
      background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,.06))',
      borderRadius: 'var(--dsw-radius-md, 6px)',
      padding: '8px 12px', margin: '8px 0',
    },
  },
  React.createElement('div', {
    style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: 6 },
  },
  React.createElement('span', {
    style: { fontSize: 'var(--dsh-content-font-size-secondary, 13px)', fontWeight: 600,
      color: 'var(--dsw-alias-label-secondary)' },
  }, noticeLabel(data.producer, t)),
  data.values.length > 0
    ? React.createElement('span', {
      style: { fontSize: 'var(--dsh-content-font-size-secondary, 13px)' },
    }, valueRow(data.values, t))
    : data.summary === ''
      ? null
      : React.createElement('span', {
        style: { fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-label-tertiary)' },
      }, data.summary)),
  React.createElement('div', {
    style: { fontSize: 'var(--dsh-content-font-size, 14px)', lineHeight: '22px',
      color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  }, data.body))
}
