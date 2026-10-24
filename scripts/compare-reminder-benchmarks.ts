import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'

// This reader only compares saved measurements. It does not run or replace a worker.
// v1 hashes raw API results; v2 additionally projects the original worker error.
// Cross-run comparisons deliberately use the preserved RAW results in both formats.
const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const Failure = z.object({ name: z.string(), message: z.string() })
const Outcome = z.union([
  z.object({ key: z.string(), match: z.json() }),
  z.object({ key: z.string(), error: Failure }),
])
const Latency = z.object({ n: z.number().int().positive(), p50Ms: z.number().positive(), p95Ms: z.number().positive() })
const Route = z.object({
  latency: Latency, rawMs: z.array(z.number().nonnegative()).nonempty(), complete: z.boolean(),
  dispatched: z.array(z.number().int().nonnegative()), inputJsonBytes: z.array(z.number().int().positive()),
  semanticDigests: z.array(Digest), rawOutcomeDigests: z.array(Digest).optional(),
  transportErrors: z.number().int().nonnegative(), protocolErrors: z.array(z.string()),
  first: z.object({ outcomes: z.array(Outcome) }),
})
const Pair = z.object({ equivalent: z.boolean() })
const Phase = z.object({ sequential: Route, batch: Route, equivalence: z.array(Pair), rawEquivalence: z.array(Pair).optional() })
const Case = z.object({
  id: z.string(), kind: z.enum(['conditions', 'judges', 'mixed']), ruleCount: z.number().int().positive(),
  contextChars: z.number().int().positive(), workloadHash: Digest, cold: Phase, warm: Phase,
  fixtureIssues: z.array(z.string()), stable: z.boolean(), semanticsEquivalent: z.boolean(), rawEnvelopesEquivalent: z.boolean().optional(),
})
const Provenance = z.object({ head: z.string(), dirty: z.boolean(), hashes: z.record(z.string(), Digest) })
const Report = z.object({
  format: z.enum(['reminder-worker-benchmark/v1', 'reminder-worker-benchmark/v2']),
  startedAt: z.string(), finishedAt: z.string(), validBaseline: z.literal(true), sourceStable: z.literal(true), failure: z.null(),
  environment: z.record(z.string(), z.json()), poolOptions: z.record(z.string(), z.json()),
  countLimits: z.record(z.string(), z.json()), maxBytes: z.number().int().positive(),
  settings: z.object({ samples: z.number().int().positive(), cold: z.number().int().positive(),
    warmup: z.number().int().nonnegative(), ruleCounts: z.array(z.number().int().positive()), eventChars: z.array(z.number().int().positive()) }),
  before: Provenance, after: Provenance, probe: z.object({ verified: z.literal(true) }), results: z.array(Case),
})
type ReportValue = z.infer<typeof Report>
type RouteValue = z.infer<typeof Route>
type CaseValue = z.infer<typeof Case>
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

function rawDigests(route: RouteValue, format: ReportValue['format']): string[] {
  if (format === 'reminder-worker-benchmark/v1') return route.semanticDigests
  assert.ok(route.rawOutcomeDigests !== undefined, 'v2 must retain raw outcome hashes')
  return route.rawOutcomeDigests
}

function validate(report: ReportValue): void {
  assert.deepEqual(report.before.hashes, report.after.hashes, 'source/artifacts changed during measurement')
  assert.equal(report.before.head, report.after.head, 'HEAD changed during measurement')
  const expectedIds = report.settings.eventChars.flatMap(chars => report.settings.ruleCounts.flatMap(count =>
    ['conditions', 'judges', 'mixed'].map(kind => `${kind}-${count}-${chars}`)))
  assert.deepEqual(report.results.map(result => result.id).sort(), expectedIds.sort(), 'incomplete or duplicate matrix')
  for (const item of report.results) {
    assert.equal(item.id, `${item.kind}-${item.ruleCount}-${item.contextChars}`)
    assert.deepEqual(item.fixtureIssues, [], `${item.id}: fixture mismatch`)
    assert.equal(item.stable, true, `${item.id}: unstable measured results`)
    for (const phase of ['cold', 'warm'] as const) {
      const expectedSamples = phase === 'cold' ? report.settings.cold : report.settings.samples
      assert.equal(item[phase].equivalence.length, expectedSamples)
      for (const route of [item[phase].sequential, item[phase].batch]) {
        assert.equal(route.latency.n, expectedSamples)
        for (const values of [route.rawMs, route.dispatched, route.inputJsonBytes, route.semanticDigests, rawDigests(route, report.format)]) {
          assert.equal(values.length, expectedSamples, `${item.id}: missing samples`)
        }
        const sorted = [...route.rawMs].sort((a, b) => a - b)
        assert.equal(route.latency.p50Ms, sorted[Math.ceil(expectedSamples * 0.5) - 1])
        assert.equal(route.latency.p95Ms, sorted[Math.ceil(expectedSamples * 0.95) - 1])
        const digests = rawDigests(route, report.format)
        assert.equal(new Set(digests).size, 1, `${item.id}: unstable raw outcomes`)
        assert.equal(digests[0], sha256(JSON.stringify(route.first.outcomes)), `${item.id}: first raw result/hash disagree`)
        if (route.complete) {
          assert.equal(route.transportErrors, 0)
          assert.deepEqual(route.protocolErrors, [])
          assert.equal(route.first.outcomes.length, item.ruleCount)
        }
      }
      if (report.format === 'reminder-worker-benchmark/v2') {
        assert.ok(item[phase].rawEquivalence !== undefined)
        assert.equal(item[phase].rawEquivalence.length, expectedSamples)
      }
    }
    if (report.format === 'reminder-worker-benchmark/v2') assert.notEqual(item.rawEnvelopesEquivalent, undefined)
  }
}

function crossRun(before: RouteValue, after: RouteValue, left: ReportValue, right: ReportValue) {
  const rawResultsEqual = isDeepStrictEqual(before.first.outcomes, after.first.outcomes)
    && isDeepStrictEqual(rawDigests(before, left.format), rawDigests(after, right.format))
  // A rejected old batch may be fast, but it did not evaluate the workload.
  const comparable = before.complete && after.complete && rawResultsEqual
  return { comparable, rawResultsEqual, beforeComplete: before.complete, afterComplete: after.complete,
    beforeMs: before.latency, afterMs: after.latency,
    beforeOverAfter: comparable ? { p50: before.latency.p50Ms / after.latency.p50Ms, p95: before.latency.p95Ms / after.latency.p95Ms } : null }
}

function onlyValue(values: number[]): number {
  assert.equal(new Set(values).size, 1, 'input bytes or dispatch counts varied across samples')
  const value = values[0]
  assert.ok(value !== undefined)
  return value
}

export function compareReminderBenchmarks(beforeRaw: unknown, afterRaw: unknown) {
  const before = Report.parse(beforeRaw); const after = Report.parse(afterRaw)
  validate(before); validate(after)
  for (const key of ['settings', 'environment', 'poolOptions', 'countLimits', 'maxBytes'] as const) {
    assert.deepEqual(before[key], after[key], `${key} changed between runs`)
  }
  const fixture = 'test/fixtures/reminder-benchmark.ts'
  const fixtureHash = before.before.hashes[fixture]
  assert.ok(fixtureHash !== undefined)
  assert.equal(after.before.hashes[fixture], fixtureHash, 'judge fixture changed')
  const byId = new Map(before.results.map(item => [item.id, item]))
  const compareCase = (current: CaseValue) => {
    const previous = byId.get(current.id)
    assert.ok(previous !== undefined)
    assert.equal(previous.workloadHash, current.workloadHash, `${current.id}: workload changed`)
    const comparePhase = (phase: 'cold' | 'warm') => ({
      sequential: crossRun(previous[phase].sequential, current[phase].sequential, before, after),
      batch: crossRun(previous[phase].batch, current[phase].batch, before, after),
      // This changes both revision and execution route; retain the same-route comparison above.
      beforeSequentialToAfterBatch: crossRun(previous[phase].sequential, current[phase].batch, before, after),
      afterSequentialOverBatch: current.semanticsEquivalent && current[phase].equivalence.every(pair => pair.equivalent)
        && current[phase].sequential.complete && current[phase].batch.complete
        ? { p50: current[phase].sequential.latency.p50Ms / current[phase].batch.latency.p50Ms,
          p95: current[phase].sequential.latency.p95Ms / current[phase].batch.latency.p95Ms } : null,
    })
    return { id: current.id, workloadHash: current.workloadHash,
      afterWorkerResultsEquivalent: current.semanticsEquivalent, afterRawEnvelopesEquivalent: current.rawEnvelopesEquivalent,
      cold: comparePhase('cold'), warm: comparePhase('warm'),
      inputJsonBytes: { beforeSequential: onlyValue(previous.warm.sequential.inputJsonBytes), beforeBatch: onlyValue(previous.warm.batch.inputJsonBytes),
        afterSequential: onlyValue(current.warm.sequential.inputJsonBytes), afterBatch: onlyValue(current.warm.batch.inputJsonBytes) },
      afterDispatches: { sequential: onlyValue(current.warm.sequential.dispatched), batch: onlyValue(current.warm.batch.dispatched) } }
  }
  return { format: 'reminder-benchmark-comparison/v1', checks: { completeMatrices: true, sameEnvironment: true,
    sameSettings: true, sameFixture: true, sameWorkloads: true, stableSourceAndArtifactsWithinEachRun: true },
    fixtureHash, environment: after.environment, settings: after.settings,
    runs: { before: { format: before.format, startedAt: before.startedAt, finishedAt: before.finishedAt, provenance: before.before },
      after: { format: after.format, startedAt: after.startedAt, finishedAt: after.finishedAt, provenance: after.before } },
    ratioMeaning: 'before/after or sequential/batch; >1 means the denominator is faster; null means not comparable; beforeSequentialToAfterBatch changes both revision and route',
    boundary: 'cross-run uses raw outcomes and digests; within v2 uses worker results and separately retains raw envelope differences; no runtime/persistence/release claim',
    results: after.results.map(compareCase) }
}

async function loadArtifact(path: string): Promise<{ raw: unknown; sha256: string }> {
  const text = await readFile(path, 'utf8')
  const raw: unknown = JSON.parse(text)
  return { raw, sha256: sha256(text) }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [beforePath, afterPath, mode] = process.argv.slice(2)
  assert.ok(beforePath !== undefined && afterPath !== undefined && process.argv.length <= 5
    && (mode === undefined || mode === '--summary'),
    'usage: pnpm exec node scripts/compare-reminder-benchmarks.ts <before.json> <after.json> [--summary]')
  const before = await loadArtifact(beforePath); const after = await loadArtifact(afterPath)
  const comparison = compareReminderBenchmarks(before.raw, after.raw)
  const artifactHashes = { before: before.sha256, after: after.sha256 }
  const output = mode === '--summary' ? { checks: comparison.checks, artifactHashes,
    columns: ['case', 'beforeSequentialP50Ms', 'afterSequentialP50Ms', 'beforeBatchP50Ms', 'afterBatchP50Ms',
      'sameBatchBeforeOverAfterP50', 'beforeSequentialOverAfterBatchP50', 'afterSequentialOverBatchP50',
      'crossRouteRawResultsEqual', 'sameSequentialRawResultsEqual', 'afterRawEnvelopesEquivalent'],
    rows: comparison.results.map(item => [item.id, item.warm.sequential.beforeMs.p50Ms, item.warm.sequential.afterMs.p50Ms,
      item.warm.batch.beforeMs.p50Ms, item.warm.batch.afterMs.p50Ms, item.warm.batch.beforeOverAfter?.p50 ?? null,
      item.warm.beforeSequentialToAfterBatch.beforeOverAfter?.p50 ?? null, item.warm.afterSequentialOverBatch?.p50 ?? null,
      item.warm.beforeSequentialToAfterBatch.rawResultsEqual, item.warm.sequential.rawResultsEqual, item.afterRawEnvelopesEquivalent ?? null])
  } : { ...comparison, artifactHashes }
  console.log(JSON.stringify(output, null, mode === '--summary' ? undefined : 2))
}
