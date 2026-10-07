import test from 'node:test'
import assert from 'node:assert/strict'
import { calibrationHeaderKey, journalCalibration } from '../src/input-calibration.js'

const header = { config: { provider: 'p', model: 'm', maxTokens: 100 }, tools: [] }
const fallback = { kind: 'usage-calibrated', textScale: 20, header, sampleSeq: 1 }
const sample = { kind: 'request', data: { callId: 'c1', purpose: 'conversation', dispatched: true, outcome: 'completed', eventType: 'assistant/message',
  eventSeq: 3, calibrationHeaderKey: calibrationHeaderKey(header), rawInput: { textTokens: 200, visualTokens: 300 },
  usage: { inputTokens: 1500, cacheReadTokens: 100 } } }

test('complete actual text, schemas and one-shot segments calibrate without scaling image visual prices', () => {
  const basis = journalCalibration([sample], header, fallback)
  assert.equal(basis.textScale, 6.5)
  assert.equal(basis.sampleSeq, 3)
  assert.equal(basis.source, 'actual-request-journal')
  assert.equal(basis.sampleCallId, 'c1')
  const large = structuredClone(sample)
  large.data.usage.inputTokens = 20200
  assert.equal(journalCalibration([large], header, fallback).textScale, 100)
})

test('failed, undispatched, auxiliary, smaller and different actual route samples are ineligible', () => {
  for (const change of [{ outcome: 'failed' }, { dispatched: false }, { purpose: 'compaction' },
    { usage: { inputTokens: 499 } }, { calibrationHeaderKey: 'another-route' }, { eventType: 'assistant/attempt' }]) {
    const invalid = { kind: 'request', data: { ...sample.data, ...change } }
    assert.equal(journalCalibration([invalid], header, fallback).textScale, 1)
  }
  assert.equal(journalCalibration([], header, fallback), fallback)
})
