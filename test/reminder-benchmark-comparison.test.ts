import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { compareReminderBenchmarks } from '../scripts/compare-reminder-benchmarks.ts'

// These fixtures exercise the saved-report reader only. They are not worker,
// storage or Harness evidence and never provide fake execute/save/context services.
type Outcome = { key: string; match: { ok: boolean; status: string } }
  | { key: string; error: { name: string; message: string } }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fixtureKey = 'test/fixtures/reminder-benchmark.ts'

function route(ms: number, outcomes: Outcome[] = [{ key: 'r0', match: { ok: true, status: 'matched' } }], complete = true) {
  const digest = hash(outcomes)
  return { latency: { n: 1, p50Ms: ms, p95Ms: ms }, rawMs: [ms], complete, dispatched: [1], inputJsonBytes: [100],
    semanticDigests: [digest], rawOutcomeDigests: [digest], transportErrors: complete ? 0 : 1, protocolErrors: [] as string[],
    first: { outcomes: structuredClone(outcomes) } }
}

function fixture(version: 1 | 2, sequentialMs = 4, batchMs = 2) {
  const origin = { head: 'synthetic-report-reader-fixture', dirty: false, hashes: { [fixtureKey]: hash('judge fixture') } }
  const phase = () => ({ sequential: route(sequentialMs), batch: route(batchMs),
    equivalence: [{ equivalent: true }], rawEquivalence: [{ equivalent: true }] })
  return { format: `reminder-worker-benchmark/v${version}`, startedAt: '2026-10-20T00:00:00.000Z', finishedAt: '2026-10-20T00:00:01.000Z',
    validBaseline: true, sourceStable: true, failure: null, environment: { node: 'fixture-engine' },
    poolOptions: { timeoutMs: 5000 }, countLimits: { maxTextChars: 32768 }, maxBytes: 4194304,
    settings: { samples: 1, cold: 1, warmup: 0, ruleCounts: [1], eventChars: [512] },
    before: structuredClone(origin), after: structuredClone(origin), probe: { verified: true },
    results: ['conditions', 'judges', 'mixed'].map(kind => ({ id: `${kind}-1-512`, kind, ruleCount: 1, contextChars: 512,
      workloadHash: hash(kind), cold: phase(), warm: phase(), fixtureIssues: [] as string[], stable: true,
      semanticsEquivalent: true, rawEnvelopesEquivalent: true })) }
}
type Fixture = ReturnType<typeof fixture>
function firstCase(report: Fixture) {
  const result = report.results[0]
  assert.ok(result !== undefined)
  return result
}
function firstComparison(before: Fixture, after: Fixture) {
  const result = compareReminderBenchmarks(before, after).results[0]
  assert.ok(result !== undefined)
  return result
}

test('saved benchmark comparison separates same-route regression from a faster route switch', () => {
  const result = firstComparison(fixture(1, 4, 2), fixture(2, 6, 3))
  for (const phase of ['cold', 'warm'] as const) {
    assert.equal(result[phase].batch.beforeOverAfter?.p50, 2 / 3)
    assert.equal(result[phase].beforeSequentialToAfterBatch.beforeOverAfter?.p50, 4 / 3)
    assert.equal(result[phase].afterSequentialOverBatch?.p50, 2)
    assert.equal(result[phase].beforeSequentialToAfterBatch.rawResultsEqual, true)
  }
})

const invalidReports: { label: string; change: (report: Fixture) => void; message: RegExp }[] = [
  { label: 'environment change', change: report => { report.environment.node = 'different-engine' }, message: /environment changed/ },
  { label: 'sampling change', change: report => { report.settings.warmup = 1 }, message: /settings changed/ },
  { label: 'worker budget change', change: report => { report.poolOptions.timeoutMs = 1000 }, message: /poolOptions changed/ },
  { label: 'incomplete matrix', change: report => { report.results.pop() }, message: /incomplete or duplicate matrix/ },
  { label: 'duplicate case', change: report => { report.results[1] = structuredClone(firstCase(report)) }, message: /incomplete or duplicate matrix/ },
  { label: 'workload change', change: report => { firstCase(report).workloadHash = hash('different workload') }, message: /workload changed/ },
  { label: 'source change during measurement', change: report => { report.after.hashes[fixtureKey] = hash('changed file') }, message: /source.artifacts changed/ },
  { label: 'fixture change between measurements', change: report => {
    report.before.hashes[fixtureKey] = hash('different fixture')
    report.after.hashes[fixtureKey] = hash('different fixture')
  }, message: /judge fixture changed/ },
  { label: 'extra latency sample', change: report => { firstCase(report).warm.batch.rawMs.push(1) }, message: /missing samples/ },
  { label: 'invented percentile', change: report => { firstCase(report).warm.batch.latency.p50Ms = 1 }, message: /strictly equal/ },
  { label: 'raw receipt digest mismatch', change: report => { firstCase(report).warm.batch.rawOutcomeDigests[0] = hash('different receipt') }, message: /first raw result.hash disagree/ },
  { label: 'fixture expectation failure', change: report => { firstCase(report).fixtureIssues.push('r0: wrong match') }, message: /fixture mismatch/ },
]
for (const invalid of invalidReports) {
  test(`saved benchmark comparison rejects ${invalid.label}`, () => {
    const after = fixture(2)
    invalid.change(after)
    assert.throws(() => compareReminderBenchmarks(fixture(1), after), invalid.message)
  })
}

test('saved benchmark comparison does not count old batch rejection latency as a speedup', () => {
  const before = fixture(1); const after = fixture(2)
  const previous = firstCase(before)
  previous.semanticsEquivalent = false
  previous.rawEnvelopesEquivalent = false
  for (const phase of ['cold', 'warm'] as const) {
    previous[phase].batch = route(0.01, [], false)
    previous[phase].equivalence = [{ equivalent: false }]
    previous[phase].rawEquivalence = [{ equivalent: false }]
  }
  const result = firstComparison(before, after)
  assert.equal(result.warm.batch.beforeComplete, false)
  assert.equal(result.warm.batch.beforeOverAfter, null)
  assert.equal(result.warm.beforeSequentialToAfterBatch.beforeOverAfter?.p50, 2)
})

test('saved benchmark comparison preserves error names even when messages agree', () => {
  const before = fixture(1); const after = fixture(2)
  const original: Outcome[] = [{ key: 'r0', error: { name: 'Error', message: 'judge failure' } }]
  const wrapped: Outcome[] = [{ key: 'r0', error: { name: 'MatcherFailure', message: 'judge failure' } }]
  for (const phase of ['cold', 'warm'] as const) {
    firstCase(before)[phase].sequential = route(4, original)
    firstCase(before)[phase].batch = route(2, original)
    firstCase(after)[phase].sequential = route(6, wrapped)
    firstCase(after)[phase].batch = route(3, original)
    firstCase(after)[phase].rawEquivalence = [{ equivalent: false }]
  }
  firstCase(after).rawEnvelopesEquivalent = false
  const result = firstComparison(before, after)
  assert.equal(result.warm.sequential.rawResultsEqual, false)
  assert.equal(result.warm.sequential.beforeOverAfter, null)
  assert.equal(result.warm.beforeSequentialToAfterBatch.rawResultsEqual, true)
  assert.equal(result.warm.beforeSequentialToAfterBatch.beforeOverAfter?.p50, 4 / 3)
})

test('saved benchmark comparison validates unknown input before reading report fields', () => {
  const invalid: unknown = { results: 'not a measured matrix' }
  assert.throws(() => compareReminderBenchmarks(invalid, fixture(2)))
})
