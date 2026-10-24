import test from 'node:test'
import assert from 'node:assert/strict'
import { contextCarePrompts } from '../src/prompt-view-data.js'
import { createTransformLog } from '../src/transform-log.js'

const evaluation = { evaluationId: 'evaluation-1', ruleId: 'notice', outcome: 'applied',
  facts: { fatigue: 80 }, rule: { id: 'notice', action: { kind: 'notify', say: 'Take a break.' } } }
const event = { type: 'user/message', seq: 12, time: 100, data: {
  id: 'notice-message', role: 'user', content: [{ type: 'text', text: 'Take a break.' }],
  source: { kind: 'plugin:dsh-context-care:rules:notice', contextCareTrace: {
    trigger: 'notice-rule', evaluationId: evaluation.evaluationId, evaluation,
  } },
} }

test('prompt evidence is rebuilt from the committed message without a request side record', () => {
  const session = { snapshotEvents: () => [structuredClone(event)] }
  const [prompt] = contextCarePrompts([], session)
  assert.equal(prompt.text, 'Take a break.')
  assert.deepEqual(prompt.evaluations, [{ ...evaluation, key: 'event:12:evaluation', at: 100, eventSeq: 12 }])
  // Conflicting discarded cache data cannot override the original logged evaluation.
  const stale = [{ kind: 'maintenance', key: 'stale-cache', at: 101, data: {
    ...evaluation, action: 'rule-evaluation', facts: { fatigue: -1 },
  } }]
  assert.deepEqual(contextCarePrompts(stale, session), [prompt])
})

test('rule diagnostics need only a logger, never a Session table or request journal', () => {
  const lines: string[] = []
  const log = createTransformLog({ ctx: { logger: { info(line: string) { lines.push(line) } } } })
  log.record({ sessionId: 's', layer: 'notice', ruleId: 'notice', outcome: 'applied', evaluationId: 'evaluation-1' })
  assert.deepEqual(lines, ['context-care rule: layer=notice ruleId=notice outcome=applied'])
})
