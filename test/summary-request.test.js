import test from 'node:test'
import assert from 'node:assert/strict'
import { summaryCandidates, summaryConfig, maintenancePassLimit, buildSummaryRequest, SUMMARY_INSTRUCTION } from '../src/summary-request.js'
import { resolveConfig } from '../src/policy.js'

function history(events) {
  return { surface: { nodes: events.map(event => event.seq) }, eventAt: seq => events.find(event => event.seq === seq),
    deriveEventMessage: event => event.data.message ?? event.data,
    requestHeader: () => ({ config: { provider: 'main', model: 'large' }, tools: [{ name: 'a', parameters: { type: 'object' } }] }),
    toolHistory: () => ({ tools: [], updates: [] }), id: 's' }
}
const user = (seq, kind = 'user') => ({ seq, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: `Item ${seq}` }], source: { kind } } })

test('ordinary compensation inherits exact-route region retries unless maxPasses is explicit', () => {
  const agent = { session: history([]) }
  const service = { config: { compactionRetries: 1, modelPolicies: [{ provider: 'main', model: 'large', compactionRetries: 3 }] } }
  assert.equal(maintenancePassLimit(service, agent, undefined, 2), 4)
  assert.equal(maintenancePassLimit(service, agent, 2, 2), 2)
  assert.equal(maintenancePassLimit({ config: { compactionRetries: 0 } }, agent, undefined, 2), 1)
  assert.equal(maintenancePassLimit({}, agent, undefined, 2), 2)
})

test('summary candidates retain entire tool batches in surface order with fresh minimum', () => {
  const events = [user(40), { seq: 2, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'tool-call' }, { type: 'tool-call' }] } } },
    { seq: 7, type: 'tool/result', data: { message: { role: 'tool', content: [] } } }, { seq: 9, type: 'tool/result', data: { message: { role: 'tool', content: [] } } },
    user(15), user(20, 'plugin:dsh-context-care:state')]
  const session = history(events)
  const measure = { nodes: events.map(event => ({ seq: event.seq, tokens: 100 })) }
  assert.deepEqual(summaryCandidates(session, { start: 40, end: 15 }, measure, 100, 'dsh-context-care'), [[40, 2, 7, 9, 15], [40, 2, 7, 9], [40]])
  assert.deepEqual(summaryCandidates(session, { start: 20, end: 20 }, measure, 1, 'dsh-context-care'), [])
  assert.throws(() => summaryCandidates(session, { start: 40, end: 7 }, measure, 100, 'dsh-context-care'), /inside a tool batch/)
  assert.throws(() => summaryCandidates(session, { start: 7, end: 15 }, measure, 100, 'dsh-context-care'), /inside a tool batch/)
})

test('one summary builder includes only system head, selected prefix, tools and final directive', () => {
  const session = history([{ seq: 0, type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'Base identity' }] } } }, user(1), user(2)])
  const signal = new AbortController().signal
  const request = buildSummaryRequest(session, [1], { provider: 'summary', model: 'small', maxTokens: 100 }, signal)
  assert.deepEqual(request.messages.map(message => message.content[0].text), ['Base identity', 'Item 1', SUMMARY_INSTRUCTION])
  assert.equal(request.signal, signal)
  assert.equal(request.purpose, 'compaction')
  assert.equal(request.tools.length, 1)
})

test('summary config inherits public exact-route policy and explicit plugin overrides', () => {
  const agent = { session: history([]), options: {} }
  const service = { config: { summarizationProvider: 'summary', summarizationModel: 'small', maxTokens: 1000, compactionRetries: 2,
    modelPolicies: [{ provider: 'main', model: 'large', maxTokens: 400, summarizationModel: 'smaller' }] } }
  assert.deepEqual(summaryConfig(service, agent), { provider: 'summary', model: 'smaller', maxTokens: 400, maxRetries: 2 })
  assert.deepEqual(summaryConfig(service, agent, { provider: 'dedicated', model: 'custom', maxTokens: 200, maxRetries: 0 }), { provider: 'dedicated', model: 'custom', maxTokens: 200, maxRetries: 0 })
  assert.equal(summaryConfig({ compactRegion() {} }, agent), undefined)
  assert.throws(() => resolveConfig({ summary: { maxRetries: -1 } }), /summary.maxRetries/)
  assert.throws(() => resolveConfig({ summary: { typo: 1 } }), /unknown summary/)
  assert.throws(() => summaryConfig({}, agent, {}), /positive maxTokens/)
})
