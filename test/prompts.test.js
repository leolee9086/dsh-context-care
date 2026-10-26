import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contextCarePrompts, requestCareInstructions } from '../src/prompt-view-data.js'
import { PromptDetails } from '../src/prompt-view.js'
import { PromptRecord } from '../src/prompt-detail.js'
import { GUIDANCE } from '../src/policy.js'
import { dictionaries } from '../src/client-view.js'
import { createUserMessage } from '../src/message.js'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { createActionRecords } from '../src/action-records.js'
import { careStreamFixture, turn } from './fixtures/care-stream.js'
import { nativeSession } from './fixtures/native-session.ts'
const blocks = text => [{ type: 'text', text }]
const requestRecord = data => ({ kind: 'request', at: 100, data })

test('prompt catalog restores insertion paths, exact bodies, selected sources and truthful delivery state from committed events', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const system = session.append('system/message', { message: createMessage({ role: 'system', source: { kind: 'system' }, content: blocks(`Private prefix\n\n${GUIDANCE}\n\nPrivate suffix`) }) }, { surfaceOp: 'append' })
  const material = session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 1, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: blocks('A'.repeat(2200)) }) }, { surfaceOp: 'append' })
  const notices = ['state', 'rules:r1', 'watch:identity', 'notice:memory', 'loop', 'request'].map(producer => session.append('user/message',
    createUserMessage({ content: blocks(`<context-care>\n${producer}\n</context-care>`), source: { kind: `plugin:dsh-context-care:${producer}`, form: 'notice', contextCareTrace: { trigger: producer, sourceSeqs: [material.seq] } } }), { surfaceOp: 'append' }))
  const foreign = session.append('user/message', createUserMessage({ source: { kind: 'plugin:other-plugin', form: 'notice' }, content: blocks('Foreign prompt') }), { surfaceOp: 'append' })
  const header = session.append('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial',
    contextCarePrompt: { callId: 'refused', message: { content: blocks('<scoped>exact request body</scoped>') }, segments: [
      { ruleId: 'output-pattern', text: 'Feedback', sourceSeqs: [material.seq], metrics: { repeats: 3 } },
      { ruleId: 'completion-observation', text: 'Observation', sourceSeqs: [material.seq] }] } })
  session.append('user/message', createUserMessage({ source: { kind: 'compact-checkpoint', compactionId: 'own' }, content: blocks('<continuation>our summary</continuation>') }), { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({ source: { kind: 'compact-checkpoint', compactionId: 'foreign' }, content: blocks('Foreign checkpoint') }), { surfaceOp: 'append' })
  const records = [requestRecord({ callId: 'refused', logRevision: header.seq, phase: 'failed', dispatched: false, route: { provider: 'p', model: 'm' },
    sourceSeqs: [system.seq, ...notices.map(event => event.seq), foreign.seq], requestSourceSeqs: [system.seq, notices[0].seq],
    careInstructions: [{ kind: 'guidance', text: GUIDANCE, sourceSeq: system.seq }, { kind: 'summary-instruction', text: 'Exact auxiliary instruction', sourceSeqs: [material.seq, notices[1].seq] }] }),
    { kind: 'maintenance', data: { action: 'summary', compactionId: 'own' } }]
  const prompts = logs.withLive(session, log => contextCarePrompts(records, session, log))
  assert.equal(prompts.length, 10); assert.equal(prompts.filter(prompt => prompt.kind === 'guidance').length, 1)
  assert.equal(prompts.find(prompt => prompt.seq === system.seq).text, GUIDANCE)
  assert.equal(prompts.find(prompt => prompt.seq === notices[0].seq).text, '<context-care>\nstate\n</context-care>')
  assert.equal(prompts.find(prompt => prompt.seq === notices[1].seq).calls.length, 0, 'selection cannot claim every retained message was sent')
  const prompt = prompts.find(prompt => prompt.seq === header.seq)
  assert.equal(prompt.text, '<scoped>exact request body</scoped>'); assert.equal(prompt.calls[0].dispatched, false)
  assert.equal(prompt.sources.length, 1); assert.equal(prompt.sources[0].excerpt.length, 2000); assert.equal(prompt.sources[0].truncated, true)
  assert.deepEqual(prompts.find(prompt => prompt.kind === 'summary-instruction').sources.map(source => source.seq), [material.seq, notices[1].seq])
  assert.doesNotMatch(JSON.stringify(prompts), /Private prefix|Private suffix|Foreign prompt|Foreign checkpoint/)
  assert.deepEqual(logs.withLive(session, log => contextCarePrompts(JSON.parse(JSON.stringify(records)), session, log)), prompts)
  for (const locale of ['zh', 'en']) {
    const markup = renderToStaticMarkup(React.createElement(PromptDetails, { value: { status: 'ready', prompts }, selectedSeq: header.seq,
      t: key => { assert.ok(dictionaries[locale][key], key); return dictionaries[locale][key] } }))
    assert.match(markup, /exact request body/); assert.match(markup, locale === 'zh' ? /尚未派发/ : /Not dispatched/)
    assert.doesNotMatch(markup, /&quot;callId&quot;|&quot;dispatched&quot;/)
    assert.match(markup, locale === 'zh' ? /输出模式反馈|完成表述提醒/ : /Output pattern feedback|Completion wording reminder/)
    assert.doesNotMatch(markup, /NaN|undefined/)
  }
})

test('rule evidence joins only a persisted stable evaluation identity and legacy segments remain explicit', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const prompt = session.append('user/message', createUserMessage({ content: blocks('notice'), source: { kind: 'plugin:dsh-context-care:rules:r', contextCareTrace: { evaluationId: 'wanted' } } }), { surfaceOp: 'append' })
  const records = ['wanted', 'unrelated'].map(id => ({ key: id, kind: 'maintenance', at: 1, data: { action: 'rule-evaluation', ruleId: 'r', evaluationId: id, facts: { fatigue: 80 } } }))
  records.push(requestRecord({ callId: 'old', promptDecision: { segments: [{ ruleId: 'r', text: 'retained segment' }] } }))
  const prompts = logs.withLive(session, log => contextCarePrompts(records, session, log))
  assert.deepEqual(prompts.find(item => item.seq === prompt.seq).evaluations.map(item => item.key), ['wanted'])
  const legacy = prompts.find(item => item.id === 'request:old'); assert.equal(legacy.bodyStatus, 'segments-only'); assert.equal(legacy.text, 'retained segment')
  const rendered = prompts.map(prompt => renderToStaticMarkup(React.createElement(PromptRecord, { prompt, t: key => dictionaries.en[key] }))).join('')
  assert.match(rendered, /Durable rule evaluations/); assert.match(rendered, /lacks the original wrapper/)
  const missingSelection = renderToStaticMarkup(React.createElement(PromptDetails, { value: { status: 'ready', prompts: [], selectedFound: false }, t: key => dictionaries.en[key] }))
  assert.match(missingSelection, /role="alert"/); assert.ok(missingSelection.includes(dictionaries.en.promptsNotFound))
})

test('identification never expands a system marker into unrelated instructions', () => {
  assert.deepEqual(requestCareInstructions({ system: '上下文照料（疲劳度 / 唤醒值）：\nPrivate text without known contribution', messages: [] }), [])
  const instructions = requestCareInstructions({ messages: [{ role: 'system', content: blocks(`prefix\n${GUIDANCE}\nsuffix`) },
    { role: 'user', content: blocks('directive'), source: { kind: 'plugin:dsh-context-care:summary-instruction', contextCareTrace: { sourceSeqs: [5] } } }] })
  assert.equal(instructions[0].text, GUIDANCE); assert.deepEqual(instructions[1], { kind: 'summary-instruction', text: 'directive', sourceSeqs: [5] })
})

test('journal-only request decision restores exact prompt without inventing a reconstructed wrapper', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const prompts = logs.withLive(session, log => contextCarePrompts([requestRecord({ callId: 'cold', dispatched: false, promptDecision: { seq: 20,
    message: { content: blocks('<exact>retained text</exact>') }, segments: [{ ruleId: 'static', text: 'segment' }] } })], session, log))
  assert.equal(prompts[0].text, '<exact>retained text</exact>'); assert.equal(prompts[0].calls[0].dispatched, false)
})

test('optional prompt evidence is a detached JSON snapshot before durable admission', () => {
  const evidence = { missing: undefined, nested: { value: 1 }, unavailable: null }
  const message = createUserMessage({ content: blocks('notice'), source: { kind: 'plugin:dsh-context-care:state', contextCareTrace: evidence } })
  evidence.nested.value = 99; assert.equal(message.source.contextCareTrace.nested.value, 1); assert.deepEqual(JSON.parse(JSON.stringify(message)), message)
})

test('prompt subscriptions locate historical seq and release pages independently', async () => {
  const transport = careStreamFixture(), records = createActionRecords({ changes: transport.changes, collection: 'prompts' })
  const stop = records.watch('one', 0, 42), stopOther = records.watch('two', 0); await turn()
  assert.equal(transport.opened[0].subscriptions[0].seq, 42)
  transport.push({ sessionId: 'one', topic: 'prompts', seq: 42 }, { prompts: [], offset: 40, selectedFound: true }); await turn()
  assert.equal(records.source.getSnapshot().get('one:0:42').offset, 40)
  stop(); await turn(); assert.equal(transport.opened[0].signal.aborted, true)
  assert.deepEqual(transport.opened.at(-1).subscriptions.map(item => item.sessionId), ['two'])
  records.dispose(); stopOther(); transport.changes.dispose()
})
