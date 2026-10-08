import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contextCarePrompts, requestCareInstructions } from '../src/prompt-view-data.js'
import { PromptDetails } from '../src/prompt-view.js'
import { GUIDANCE } from '../src/policy.js'
import { dictionaries } from '../src/client-view.js'
import { createUserMessage } from '../src/message.js'
import { createActionRecords } from '../src/action-records.js'
const blocks = text => [{ type: 'text', text }]
const requestRecord = data => ({ kind: 'request', at: 100, data })

test('prompt catalog restores all insertion paths, exact bodies, selected sources and truthful delivery state', () => {
  const events = [{ seq: 1, time: 1, type: 'system/message', data: { message: { content: blocks(`Private prefix\n\n${GUIDANCE}\n\nPrivate suffix`) } } },
    { seq: 2, time: 2, type: 'assistant/message', data: { message: { content: blocks('A'.repeat(2200)) } } }]
  for (const [index, producer] of ['state', 'rules:r1', 'watch:identity', 'notice:memory', 'loop', 'request'].entries()) events.push({
    seq: 3 + index, time: 3 + index, type: 'user/message', data: createUserMessage({ content: blocks(`<context-care>\n${producer}\n</context-care>`),
      source: { kind: `plugin:dsh-context-care:${producer}`, form: 'notice', contextCareTrace: { trigger: producer, sourceSeqs: [2], optional: undefined } } }) })
  events.push({ seq: 10, time: 10, type: 'user/message', data: { source: { kind: 'plugin:other-plugin', form: 'notice' }, content: blocks('Foreign prompt') } },
    { seq: 11, time: 11, type: 'request/header', data: { contextCarePrompt: { callId: 'refused', message: { content: blocks('<scoped>exact request body</scoped>') },
      segments: [{ ruleId: 'output-pattern', text: 'Feedback', sourceSeqs: [2], metrics: { repeats: 3 } }, { ruleId: 'completion-observation', text: 'Observation', sourceSeqs: [2] }] } } },
    { seq: 12, time: 12, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: 'own' }, content: blocks('<continuation>our summary</continuation>') } },
    { seq: 13, time: 13, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: 'foreign' }, content: blocks('Foreign checkpoint') } })
  const records = [requestRecord({ callId: 'refused', logRevision: 11, phase: 'failed', dispatched: false, route: { provider: 'p', model: 'm' },
    sourceSeqs: [1, 3, 4, 5, 6, 7, 8, 10], requestSourceSeqs: [1, 3], careInstructions: [{ kind: 'guidance', text: GUIDANCE, sourceSeq: 1 },
      { kind: 'summary-instruction', text: 'Exact auxiliary instruction', sourceSeqs: [2, 4] }] }),
    { kind: 'maintenance', data: { action: 'summary', compactionId: 'own' } }]
  const session = { snapshotEvents: () => events }
  const prompts = contextCarePrompts(records, session)
  assert.equal(prompts.length, 10)
  assert.equal(prompts.filter(prompt => prompt.kind === 'guidance').length, 1)
  assert.equal(prompts.find(prompt => prompt.seq === 1).text, GUIDANCE)
  assert.equal(prompts.find(prompt => prompt.seq === 3).text, '<context-care>\nstate\n</context-care>')
  assert.equal(prompts.find(prompt => prompt.seq === 4).calls.length, 0, 'summary selection must not claim every retained message was sent')
  const prompt = prompts.find(prompt => prompt.seq === 11)
  assert.equal(prompt.text, '<scoped>exact request body</scoped>')
  assert.equal(prompt.calls[0].dispatched, false)
  assert.equal(prompt.sources.length, 1)
  assert.equal(prompt.sources[0].excerpt.length, 2000)
  assert.equal(prompt.sources[0].truncated, true)
  assert.deepEqual(prompts.find(prompt => prompt.kind === 'summary-instruction').sources.map(source => source.seq), [2, 4])
  assert.doesNotMatch(JSON.stringify(prompts), /Private prefix|Private suffix|Foreign prompt|Foreign checkpoint/)
  assert.deepEqual(contextCarePrompts(JSON.parse(JSON.stringify(records)), { snapshotEvents: () => JSON.parse(JSON.stringify(events)) }), prompts)
  for (const locale of ['zh', 'en']) {
    const markup = renderToStaticMarkup(React.createElement(PromptDetails, { value: { status: 'ready', prompts }, selectedSeq: 11,
      t: key => { assert.ok(dictionaries[locale][key], key); return dictionaries[locale][key] } }))
    assert.match(markup, /exact request body/)
    assert.match(markup, /refused/)
    assert.match(markup, /output-pattern|completion-observation/)
    assert.doesNotMatch(markup, /NaN|undefined/)
  }
})

test('rule evidence joins only a persisted stable evaluation identity and legacy segments remain explicit', () => {
  const prompt = { seq: 5, type: 'user/message', data: { content: blocks('notice'), source: {
    kind: 'plugin:dsh-context-care:rules:r', contextCareTrace: { evaluationId: 'wanted' } } } }
  const records = ['wanted', 'unrelated'].map(id => ({ key: id, kind: 'maintenance', at: 1,
    data: { action: 'rule-evaluation', ruleId: 'r', evaluationId: id, facts: { fatigue: 80 } } }))
  records.push(requestRecord({ callId: 'old', promptDecision: { segments: [{ ruleId: 'r', text: 'retained segment' }] } }))
  const prompts = contextCarePrompts(records, { snapshotEvents: () => [prompt] })
  assert.deepEqual(prompts.find(item => item.seq === 5).evaluations.map(item => item.key), ['wanted'])
  const legacy = prompts.find(item => item.id === 'request:old')
  assert.equal(legacy.bodyStatus, 'segments-only')
  assert.equal(legacy.text, 'retained segment')
  const rendered = renderToStaticMarkup(React.createElement(PromptDetails, { value: { status: 'ready', prompts }, t: key => dictionaries.en[key] }))
  assert.match(rendered, /Durable rule evaluations/)
  assert.match(rendered, /lacks the original wrapper/)
  const missingSelection = renderToStaticMarkup(React.createElement(PromptDetails, { value: { status: 'ready', prompts: [], selectedFound: false }, t: key => dictionaries.en[key] }))
  assert.match(missingSelection, /role="alert"/)
  assert.match(missingSelection, new RegExp(dictionaries.en.promptsNotFound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('identification never expands a system marker into unrelated instructions', () => {
  assert.deepEqual(requestCareInstructions({ system: '上下文照料（疲劳度 / 唤醒值）：\nPrivate text without known contribution', messages: [] }), [])
  const instructions = requestCareInstructions({ messages: [{ role: 'system', content: blocks(`prefix\n${GUIDANCE}\nsuffix`) },
    { role: 'user', content: blocks('directive'), source: { kind: 'plugin:dsh-context-care:summary-instruction', contextCareTrace: { sourceSeqs: [5] } } }] })
  assert.equal(instructions[0].text, GUIDANCE)
  assert.deepEqual(instructions[1], { kind: 'summary-instruction', text: 'directive', sourceSeqs: [5] })
})

test('journal-only request decision restores exact prompt without inventing a reconstructed wrapper', () => {
  const prompts = contextCarePrompts([requestRecord({ callId: 'cold', dispatched: false, promptDecision: { seq: 20,
    message: { content: blocks('<exact>retained text</exact>') }, segments: [{ ruleId: 'static', text: 'segment' }] } })])
  assert.equal(prompts[0].text, '<exact>retained text</exact>')
  assert.equal(prompts[0].calls[0].dispatched, false)
})

test('optional prompt evidence is a detached JSON snapshot before durable admission', () => {
  const evidence = { missing: undefined, nested: { value: 1 }, unavailable: null }
  const message = createUserMessage({ content: blocks('notice'), source: { kind: 'plugin:dsh-context-care:state', contextCareTrace: evidence } })
  evidence.nested.value = 99
  assert.equal(message.source.contextCareTrace.nested.value, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(message)), message)
})

test('prompt polling locates historical seq and releases pages independently of other sessions', async () => {
  const requests = []
  const records = createActionRecords({ endpoint: '/context-care/prompts', collection: 'prompts',
    fetcher: async (url, options) => { requests.push({ url, signal: options.signal }); return { ok: true, json: async () => ({ prompts: [], offset: 40, selectedFound: true }) } },
    setTimer: () => 1, clearTimer() {} })
  const stop = records.watch('one', 0, 42)
  const stopOther = records.watch('two', 0)
  for (let step = 0; step < 8; step++) await Promise.resolve()
  assert.match(requests[0].url, /prompts\?sessionId=one.*seq=42/)
  assert.equal(records.source.getSnapshot().get('one:0:42').offset, 40)
  stop()
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].signal.aborted, false)
  records.dispose()
  stopOther()
})
