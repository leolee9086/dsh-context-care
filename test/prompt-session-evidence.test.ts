import test from 'node:test'
import assert from 'node:assert/strict'
import { contextCarePrompts } from '../src/prompt-view-data.js'
import { createTransformLog } from '../src/transform-log.js'
import { nativeSession } from './fixtures/native-session.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const evaluation = { evaluationId: 'evaluation-1', ruleId: 'notice', outcome: 'applied',
  facts: { fatigue: 80 }, rule: { id: 'notice', action: { kind: 'notify', say: 'Take a break.' } } }
// Retained legacy notices have their own producer-owned source, distinct from current reminder handoffs.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-context-care:rules:notice': {
      kind: 'plugin:dsh-context-care:rules:notice'
      contextCareTrace: { trigger: 'notice-rule'; evaluationId: string; evaluation: typeof evaluation }
    }
  }
}
const notice = createUserMessage({ content: [{ type: 'text', text: 'Take a break.' }],
  source: { kind: 'plugin:dsh-context-care:rules:notice', contextCareTrace: {
    trigger: 'notice-rule', evaluationId: evaluation.evaluationId, evaluation,
  } },
})

test('prompt evidence is rebuilt from the committed message without a request side record', t => {
  const { sessions, logs } = nativeSession(t), session = sessions.create()
  const committed = session.append('user/message', notice, { surfaceOp: 'append' })
  const log = logs.live(session); t.after(() => log[Symbol.dispose]())
  const [prompt] = contextCarePrompts([], undefined, log)
  assert.equal(prompt.text, 'Take a break.')
  assert.deepEqual(prompt.evaluations, [{ ...evaluation, key: `event:${committed.seq}:evaluation`, at: committed.time, eventSeq: committed.seq }])
  // Conflicting discarded cache data cannot override the original logged evaluation.
  const stale = [{ kind: 'maintenance', key: 'stale-cache', at: 101, data: {
    ...evaluation, action: 'rule-evaluation', facts: { fatigue: -1 },
  } }]
  assert.deepEqual(contextCarePrompts(stale, undefined, log), [prompt])
})

test('rule diagnostics need only a logger, never a Session table or request journal', () => {
  const lines: string[] = []
  const log = createTransformLog({ ctx: { logger: { info(line: string) { lines.push(line) } } } })
  log.record({ sessionId: 's', layer: 'notice', ruleId: 'notice', outcome: 'applied', evaluationId: 'evaluation-1' })
  assert.deepEqual(lines, ['context-care rule: layer=notice ruleId=notice outcome=applied'])
})
