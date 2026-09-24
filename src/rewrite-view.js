import React from 'react'

/** 会话流中请求改写卡片的节点类型。 */
export const REWRITE_NODE = 'request-rewrite'

/** 与 Host 的内容指纹算法一致；指纹用于匹配，不代表无碰撞。 */
export function contentHash(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 节点只保存原始消息的指纹，记录到达前也保留渲染位置。
 * journal 是异步数据，不能在确定性节点组装阶段用它决定返回 null。
 */
function textBlocksOfView(message) {
  const blocks = []
  if (typeof message?.reasoning_content === 'string') {
    blocks.push({ type: 'reasoning', text: message.reasoning_content })
  }
  const content = message?.content
  if (typeof content === 'string') {
    blocks.push({ type: 'text', text: content })
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!['text', 'reasoning', 'thinking', 'input_text', 'output_text'].includes(block?.type)) continue
      const text = block.type === 'thinking' ? block.thinking : block.text
      if (typeof text === 'string') blocks.push({ type: block.type === 'thinking' ? 'reasoning' : block.type, text })
    }
  }
  if (message?.type === 'reasoning' && Array.isArray(message.summary)) {
    for (const block of message.summary) {
      if (block?.type === 'summary_text' && typeof block.text === 'string') {
        blocks.push({ type: 'reasoning', text: block.text })
      }
    }
  }
  return blocks
}

export function createRewriteDefinition() {
  return {
    kind: REWRITE_NODE,
    target: 'chat',
    match: event => event.type === 'assistant/message'
      ? { id: 'rewrite:' + event.seq, role: 'start' }
      : null,
    start: (_context, match) => ({ seq: match.event.seq }),
    update: context => context.state,
    buildViewNode(context) {
      const start = context.start
      if (start === undefined) return null
      const message = start.event.data?.message
      const blocks = textBlocksOfView(message)
      if (blocks.length === 0) return null
      const hashes = blocks.map(block => contentHash(block.text))
      // Wire formats may split one message into typed blocks while session events
      // expose the same text as one concatenated string.
      for (const type of ['text', 'reasoning']) {
        const same = blocks.filter(block => block.type === type)
        if (same.length > 1) hashes.push(contentHash(same.map(block => block.text).join('')))
      }
      return {
        key: context.key, kind: REWRITE_NODE, id: context.id, target: 'chat',
        anchorSeq: start.event.seq, location: start.location, visibility: 'visible',
        data: { seq: start.event.seq, hashes: [...new Set(hashes)] },
      }
    },
  }
}

/** 片段里的换行在卡片上会撑开行高，换成可见记号保持单行。 */
function oneLine(text) {
  return text.replace(/\n/g, '↵')
}

/**
 * 改动片段：去掉的用 −，换成的用 +。
 *
 * 只报字符数等于只说「有事发生」——这里回答的是「改了什么」。
 * 纯插入或纯删除时其中一端为空，就只画有内容的那一行。
 */
function snippetRows(hit) {
  const rows = []
  const removed = typeof hit.removed === 'string' ? hit.removed : ''
  const added = typeof hit.added === 'string' ? hit.added : ''
  if (removed.length > 0) {
    rows.push(React.createElement('div', {
      key: 'removed', style: { color: 'var(--dsw-alias-state-error-primary)' },
    }, '− ' + oneLine(removed)))
  }
  if (added.length > 0) {
    rows.push(React.createElement('div', {
      key: 'added', style: { color: 'var(--dsw-alias-state-success-primary)' },
    }, '+ ' + oneLine(added)))
  }
  return rows
}

/** 记录通过框架生成的 hook 到达，不要求重新折叠会话历史。 */
export function RewriteNodeView({ node, sessionId, useRewriteRecords, t }) {
  // 选择器是必需参数：不传就等价于让 uSES 调用 undefined，渲染器会被判崩溃而退役。
  const table = useRewriteRecords(value => value)
  const hits = (node?.data?.hashes ?? [])
    .map(hash => table.get(sessionId + ':' + hash))
    .filter(record => record !== undefined)
  if (hits.length === 0) return null
  return React.createElement('div', {
    className: 'dsh-context-care-rewrite',
    style: {
      borderLeft: '3px solid var(--dsw-alias-state-warn-primary)',
      padding: '6px 10px', margin: '6px 0',
      background: 'var(--dsw-alias-bg-secondary)',
    },
  },
  React.createElement('strong', null, t('rewriteTitle')),
  ...hits.map((hit, index) => React.createElement('div', { key: index },
    (hit.pattern ?? t('rewriteUnknown')) + ' · ' + hit.charsBefore + ' → ' + hit.charsAfter + ' ' + t('rewriteChars'),
    Number.isSafeInteger(hit.removedLines)
      ? ' · ' + t('rewriteRemoved') + ' ' + hit.removedLines + ' ' + t('rewriteLines') : '',
    ...snippetRows(hit),
  )))
}
