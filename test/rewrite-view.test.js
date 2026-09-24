import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { REWRITE_NODE, RewriteNodeView, createRewriteDefinition, contentHash } from '../src/rewrite-view.js'

const probeText = '哥哥，我会在这条助手消息里放入现有规则的触发标记：`[[REWRITTEN]]`。等下一次请求携带这条消息后，再检查实际改写记录和卡片流水账。'

function contextFor(definition, event) {
  const match = definition.match(event)
  const location = { kind: 'session' }
  const start = { event, role: 'start', location }
  return {
    key: 'rewrite:' + event.seq,
    kind: REWRITE_NODE,
    id: match.id,
    start,
    state: definition.start({}, start),
  }
}

function messageEvent(content, seq = 18893) {
  return {
    type: 'assistant/message',
    seq,
    data: { message: { role: 'assistant', content } },
  }
}

function renderNode(node, records) {
  return RewriteNodeView({
    node,
    sessionId: 'session-a',
    // 严格按契约实现：selector 是必需参数。真实渲染器漏传它会被 uSES 判为崩溃并退役。
    useRewriteRecords: selector => {
      if (typeof selector !== 'function') throw new Error('useRewriteRecords 需要 selector')
      return selector(records)
    },
    t: key => '[' + key + ']',
  })
}

test('the recorded assistant probe produces the journal hash', () => {
  const definition = createRewriteDefinition()
  const event = messageEvent([{ type: 'text', text: probeText }])
  const node = definition.buildViewNode(contextFor(definition, event))

  // The visible session block hashes to 47a6acf6. The journal's 1ec81e19
  // record has the same length but has not been proven to belong to this text.
  assert.equal(contentHash(probeText), '47a6acf6')
  assert.deepEqual(node.data.hashes, ['47a6acf6'])
  assert.equal(node.anchorSeq, 18893)
})

test('buildViewNode keeps message hashes independent of asynchronous journal data', () => {
  const definition = createRewriteDefinition()
  const event = messageEvent([
    { type: 'reasoning', text: 'analysis block' },
    { type: 'text', text: 'visible text' },
  ], 42)
  const node = definition.buildViewNode(contextFor(definition, event))

  assert.equal(node.kind, REWRITE_NODE)
  assert.equal(node.target, 'chat')
  assert.equal(node.data.seq, 42)
  assert.deepEqual(node.data.hashes, [contentHash('analysis block'), contentHash('visible text')])
  assert.equal(definition.buildViewNode({ start: undefined }), null)
})

test('buildViewNode hashes concatenated same-type blocks for Chat Completions', () => {
  const definition = createRewriteDefinition()
  const node = definition.buildViewNode(contextFor(definition, messageEvent([
    { type: 'text', text: 'first ' },
    { type: 'text', text: 'second' },
  ], 43)))

  assert.deepEqual(node.data.hashes, [
    contentHash('first '),
    contentHash('second'),
    contentHash('first second'),
  ])
})

test('buildViewNode supports string content, thinking blocks and Responses summaries', () => {
  const definition = createRewriteDefinition()
  const text = 'string message content'
  const thinking = 'reasoning from thinking'
  const summary = 'Responses summary'
  const event = messageEvent([
    { type: 'thinking', thinking },
  ], 45)
  event.data.message.reasoning_content = summary
  const reasoningEvent = messageEvent([], 46)
  reasoningEvent.data.message.type = 'reasoning'
  reasoningEvent.data.message.summary = [{ type: 'summary_text', text: summary }]
  const node = definition.buildViewNode(contextFor(definition, event))
  const stringNode = definition.buildViewNode(contextFor(definition, messageEvent(text, 47)))
  const summaryNode = definition.buildViewNode(contextFor(definition, reasoningEvent))

  assert.deepEqual(node.data.hashes, [contentHash(summary), contentHash(thinking), contentHash(summary + thinking)])
  assert.deepEqual(stringNode.data.hashes, [contentHash(text)])
  assert.deepEqual(summaryNode.data.hashes, [contentHash(summary)])
})

test('RewriteNodeView renders a record only for the matching session and hash', () => {
  const definition = createRewriteDefinition()
  const hash = contentHash(probeText)
  const node = definition.buildViewNode(contextFor(definition, messageEvent([
    { type: 'text', text: probeText },
  ])))
  const record = {
    hash,
    pattern: 'probe-request-rewrite',
    charsBefore: 75,
    charsAfter: 71,
  }
  const hit = renderNode(node, new Map([['session-a:' + hash, record]]))

  assert.ok(React.isValidElement(hit))
  assert.equal(hit.type, 'div')
  assert.equal(hit.props.className, 'dsh-context-care-rewrite')
  assert.equal(hit.props.children[0].props.children, '[rewriteTitle]')
  assert.match(String(hit.props.children[1].props.children), /probe-request-rewrite · 75 → 71/)
  assert.equal(renderNode(node, new Map([['session-b:' + hash, record]])), null)
  assert.equal(renderNode(node, new Map()), null)
})

test('RewriteNodeView includes removed-line details when available', () => {
  const definition = createRewriteDefinition()
  const hash = contentHash('rewritten assistant text')
  const node = definition.buildViewNode(contextFor(definition, messageEvent([
    { type: 'reasoning', text: 'rewritten assistant text' },
  ], 44)))
  const view = renderNode(node, new Map([['session-a:' + hash, {
    hash,
    pattern: 'line-repeat',
    charsBefore: 300,
    charsAfter: 20,
    removedLines: 12,
  }]]))

  assert.match(String(view.props.children[1].props.children), /12 \[rewriteLines\]/)
})

test('match accepts assistant messages only', () => {
  const definition = createRewriteDefinition()
  assert.equal(definition.match({ type: 'user/message', seq: 1 }), null)
  assert.equal(definition.match({ type: 'tool/result', seq: 2 }), null)
  assert.deepEqual(definition.match({ type: 'assistant/message', seq: 7 }), {
    id: 'rewrite:7',
    role: 'start',
  })
})
