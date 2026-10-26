import test from 'node:test'
import assert from 'node:assert/strict'
import { summaryRanges, summaryConfig, maintenancePassLimit, buildSummaryRequest, SUMMARY_INSTRUCTION } from '../src/summary-request.js'
import { resolveConfig } from '../src/policy.js'
import { nativeSession } from './fixtures/native-session.ts'
import { createMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
const user = (text, kind = 'user') => createMessage({ role: 'user', source: { kind }, content: [{ type: 'text', text }] })
const header = { config: { provider: 'main', model: 'large' }, tools: [{ name: 'a', description: 'a', parameters: { type: 'object' } }] }

test('ordinary compensation inherits exact-route region retries unless maxPasses is explicit', t => {
  const { sessions } = nativeSession(t), session = sessions.create(); session.append('request/header', { header, reason: 'initial' })
  const agent = { session }, service = { config: { compactionRetries: 1, modelPolicies: [{ provider: 'main', model: 'large', compactionRetries: 3 }] } }
  assert.equal(maintenancePassLimit(service, agent, undefined, 2), 4); assert.equal(maintenancePassLimit(service, agent, 2, 2), 2)
  assert.equal(maintenancePassLimit({ config: { compactionRetries: 0 } }, agent, undefined, 2), 1); assert.equal(maintenancePassLimit({}, agent, undefined, 2), 2)
})

test('summary candidates retain entire tool batches in native surface order with fresh minimum', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  session.append('turn/start', { turn: 1 }); session.append('step/start', { turn: 1, step: 1 })
  const first = session.append('user/message', user('Item first'), { surfaceOp: 'append' })
  const calls = [ToolCallId('one'), ToolCallId('two')]
  const assistant = session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 1, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: calls.map(id => ({ type: 'tool-call', id, name: 'inspect', arguments: '{}' })) }) }, { surfaceOp: 'append' })
  const results = calls.map(callId => {
    const called = session.append('tool/call', { turn: 1, step: 1, callId, name: 'inspect', arguments: '{}' })
    return session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [], isError: false }) },
      { surfaceOp: 'append', sourceEventSeqs: [called.seq] })
  })
  const last = session.append('user/message', user('Item last'), { surfaceOp: 'append' })
  const status = session.append('user/message', user('status', 'plugin:dsh-context-care:state'), { surfaceOp: 'append' })
  const measure = { nodes: session.surface.nodes.map(seq => ({ seq, tokens: 100 })) }
  logs.withLive(session, log => {
    const candidates = range => summaryRanges(session, range, measure, 100, 'dsh-context-care', log).map(item => session.surface.nodes.slice(item.from, item.to))
    assert.deepEqual(candidates({ start: first.seq, end: last.seq }), [[first.seq, assistant.seq, ...results.map(event => event.seq), last.seq], [first.seq, assistant.seq, ...results.map(event => event.seq)], [first.seq]])
    assert.deepEqual(summaryRanges(session, { start: status.seq, end: status.seq }, measure, 1, 'dsh-context-care', log), [])
    assert.throws(() => candidates({ start: first.seq, end: results[0].seq }), /inside a tool batch/)
    assert.throws(() => candidates({ start: results[0].seq, end: last.seq }), /inside a tool batch/)
  })
})

test('one summary builder includes only system head, selected prefix, tools and final directive', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  session.append('request/header', { header, reason: 'initial' })
  session.append('system/message', { message: createMessage({ role: 'system', source: { kind: 'system' }, content: [{ type: 'text', text: 'Base identity' }] }) }, { surfaceOp: 'append' })
  const selected = session.append('user/message', user('Item 1'), { surfaceOp: 'append' })
  session.append('user/message', user('Item 2'), { surfaceOp: 'append' })
  const signal = new AbortController().signal
  const request = buildSummaryRequest(session, [selected.seq], { provider: 'summary', model: 'small', maxTokens: 100 }, signal, logs)
  assert.deepEqual(request.messages.map(message => message.content[0].text), ['Base identity', 'Item 1', SUMMARY_INSTRUCTION])
  assert.equal(request.signal, signal); assert.equal(request.purpose, 'compaction'); assert.equal(request.tools.length, 1)
})

test('summary config inherits public exact-route policy and explicit plugin overrides', t => {
  const { sessions } = nativeSession(t), session = sessions.create(); session.append('request/header', { header, reason: 'initial' })
  const agent = { session, options: {} }, service = { config: { summarizationProvider: 'summary', summarizationModel: 'small', maxTokens: 1000, compactionRetries: 2,
    modelPolicies: [{ provider: 'main', model: 'large', maxTokens: 400, summarizationModel: 'smaller' }] } }
  assert.deepEqual(summaryConfig(service, agent), { provider: 'summary', model: 'smaller', maxTokens: 400, maxRetries: 2 })
  assert.deepEqual(summaryConfig(service, agent, { provider: 'dedicated', model: 'custom', maxTokens: 200, maxRetries: 0 }), { provider: 'dedicated', model: 'custom', maxTokens: 200, maxRetries: 0 })
  assert.equal(summaryConfig({ compactRegion() {} }, agent), undefined)
  assert.throws(() => resolveConfig({ summary: { maxRetries: -1 } }), /summary.maxRetries/); assert.throws(() => resolveConfig({ summary: { typo: 1 } }), /unknown summary/)
  assert.throws(() => summaryConfig({}, agent, {}), /positive maxTokens/)
})
