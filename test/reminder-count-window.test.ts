import test from 'node:test'
import assert from 'node:assert/strict'
import { createOutputStream, type OutputEvent, type OutputFrame } from '../lib/reminder-runtime/output-stream.js'
import { compileReminderCondition, matchReminderCondition } from '../lib/reminder-runtime/conditions.js'
import type { TextCountResult } from '../lib/reminder-runtime/text-count.js'

let revision = 1
type Chunk = Extract<OutputFrame, { type: 'chunk' }>['chunk']
const at = (attemptId: string, chunk: Chunk) => ({ type: 'chunk' as const, attemptId, revision: ++revision, chunk })
const limits = { maxTextChars: 10000, maxCandidates: 1000, maxUnits: 1000, maxEvidence: 8 }

/** Drive one attempt with two text blocks and collect every published event. */
async function publish(maxStreamChars: number): Promise<OutputEvent[]> {
  const events: OutputEvent[] = []
  const stream = createOutputStream<string>({ sessionId: identity => identity,
    config: { maxStreamChars, maxStreamBlocks: 4, streamEveryChars: 2, streamFlushMs: 5 },
    submit: async event => { events.push(event) }, afterSubmit: () => {}, report: error => { throw error }, enabled: () => true })
  stream.observe('s', { type: 'start', attemptId: 'attempt-a', revision: 1, turn: 1, step: 1 })
  stream.observe('s', at('attempt-a', { type: 'block-start', index: 0, blockType: 'text' }))
  stream.observe('s', at('attempt-a', { type: 'text-delta', index: 0, text: '甲甲' }))
  stream.observe('s', at('attempt-a', { type: 'block-end', index: 0, block: { type: 'text', text: '' } }))
  stream.observe('s', at('attempt-a', { type: 'block-start', index: 1, blockType: 'text' }))
  stream.observe('s', at('attempt-a', { type: 'text-delta', index: 1, text: '乙乙' }))
  stream.observe('s', { type: 'end', attemptId: 'attempt-a', revision: ++revision })
  await stream.close()
  return events
}

test('输出流同时产出当前块与整段输出的样本', async () => {
  const events = await publish(100)
  assert.ok(events.length > 2)
  // The whole-output text grows across blocks while the block text stays local.
  assert.equal(events[0]!.output.full, '甲甲')
  assert.equal(events[0]!.output.text, '甲甲')
  const last = events.at(-1)!
  assert.equal(last.output.full, '甲甲\n乙乙')
  assert.equal(last.output.text, '乙乙')
  assert.deepEqual(last.textSamples.map(sample => [sample.field, sample.window, sample.phase]), [
    ['event.output.text', 'current-block', 'complete'],
    ['event.output.full', 'current-output', 'complete'],
  ])
  // One stable identity per block and per output, so a later prefix replaces the
  // earlier text in place instead of stacking samples.
  assert.equal(new Set(events.filter(event => event.output.index === 0)
    .map(event => event.textSamples[0]!.sampleId)).size, 1)
  assert.equal(new Set(events.map(event => event.textSamples[1]!.sampleId)).size, 1)
  assert.equal(events.every(event => event.textSamples[1]!.truncated === false), true)
})

test('整段输出被截断时样本标为截断，不会只算一截', async () => {
  const events = await publish(3)
  const last = events.at(-1)!
  // The tail is kept ('甲甲\n乙乙' capped to three characters), and the sample says so.
  assert.equal(last.output.full, '\n乙乙')
  assert.equal(last.textSamples[1]!.truncated, true)
})

const snapshot = { event: { output: { text: '乙乙', full: '甲甲\n乙乙' } },
  tool: { output: { text: '乙乙', full: '甲甲\n乙乙' } }, facts: {}, context: {} }
const sample = (field: string, window: 'current-block' | 'current-output', truncated = false) => ({
  field, sampleId: `output:attempt-a:${window}`, window, phase: 'complete' as const, truncated })
const samples = [sample('event.output.text', 'current-block'), sample('event.output.full', 'current-output')]
const counting = (field: string, window: 'current-block' | 'current-output', value: number) => ({
  kind: 'count', source: { kind: 'text', field, projection: 'raw', locale: 'zh-CN' },
  pattern: { kind: 'literal', text: '甲' }, metric: 'occurrences', window: { kind: window },
  compare: { op: 'eq', value }, limits })
const run = (input: unknown, evidence = samples) =>
  matchReminderCondition(compileReminderCondition(input), snapshot, evidence)

/** Read the reason of a measurement known to be unavailable. */
function unavailableReason(result: TextCountResult): string {
  return result.status === 'unavailable' ? result.reason : `expected unavailable, got ${result.status}`
}

test('current-output 跨块计数，current-block 只看本块', () => {
  // Two 甲 live in the whole output; only the second block is the current one.
  assert.equal(run(counting('event.output.full', 'current-output', 2)).status, 'matched')
  assert.equal(run(counting('event.output.text', 'current-block', 2)).status, 'unmatched')
  assert.equal(run(counting('event.output.text', 'current-block', 0)).status, 'matched')
  // A window with no matching sample stays unavailable rather than becoming zero.
  assert.equal(run(counting('event.output.full', 'current-output', 2), [samples[0]!]).status, 'unavailable')
})

test('截断的整段输出使计数不可用，而不是报一个偏小的数', () => {
  const truncated = [sample('event.output.text', 'current-block'),
    sample('event.output.full', 'current-output', true)]
  const result = run(counting('event.output.full', 'current-output', 1), truncated)
  assert.equal(result.status, 'unavailable')
  assert.equal(result.measurements.length, 1)
  assert.equal(unavailableReason(result.measurements[0]!.result), 'text-sample-truncated')
})
