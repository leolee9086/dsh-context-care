import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { BatchAnswer, BatchResult, MatchResult } from '../lib/reminder-runtime/state.js'
import { CountLimits } from '../lib/reminder-runtime/conditions.js'
import { workload, captureBenchmarkIdentity } from './benchmark-reminders.ts'

// Sampling changes execution overhead. This diagnoses worker CPU attribution;
// it is deliberately NOT a before/after latency benchmark or release speedup.
// pnpm exec node test/profile-reminders.ts .local/logs/profile-reminders-28 200
const settings = z.object({ directory: z.string().min(1), samples: z.coerce.number().int().min(1).max(10000).default(200) })
  .parse({ directory: process.argv[2], samples: process.argv[3] })
if (process.argv.length > 4) throw new Error('usage: profile-reminders.ts <new-output-directory> [samples]')
const directory = resolve(settings.directory)
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fixtureModule = new URL('./fixtures/profile-reminder-worker.ts', import.meta.url).href
const before = await captureBenchmarkIdentity()
const instrumentation: Record<string, string> = {}
for (const path of ['test/profile-reminders.ts', 'test/fixtures/profile-reminder-worker.ts']) {
  instrumentation[path] = hash(await readFile(new URL(`../${path}`, import.meta.url)))
}
await mkdir(directory, { recursive: true })
const value = workload('conditions', 64, 32768)
const common = { event: value.event, countLimits: CountLimits.parse(undefined), maxBytes: 4 * 1024 * 1024 }
const matcher = createBoundedMatcher({ timeoutMs: 5000, startupMs: 10000, maxIdle: 1, maxPending: 256, maxBytes: 32 * 1024 * 1024 })
type Route = 'batch' | 'sequential'
type Outcome = { key: string; match: z.infer<typeof MatchResult> }
const metadata = z.object({ threadId: z.number().int().positive(), path: z.string(), samples: z.number().optional() })

async function control(exportName: 'start' | 'stop', path: string) {
  return metadata.parse(await matcher.detect({ analysis: { analyzer: {
    ref: 'worker-profiler', revision: 1, module: fixtureModule, exportName,
  }, event: { ...value.event, arguments: { path } }, maxBytes: 8192 } }))
}
async function run(route: Route): Promise<Outcome[]> {
  if (route === 'batch') {
    const result = BatchResult.parse(await matcher.detect({ reminderBatch: { ...common, rules: value.batchRules } }))
    assert.equal(result.stopped, false)
    return result.items.map(raw => {
      const item = BatchAnswer.parse(raw)
      if ('error' in item) throw new Error(`profile rule ${item.key}: ${item.error.message}`)
      return { key: item.key, match: MatchResult.parse(item.match) }
    })
  }
  const results: Outcome[] = []
  for (const rule of value.batchRules) {
    const match = MatchResult.parse(await matcher.detect({ reminder: { ...common, condition: rule.condition } }))
    results.push({ key: rule.key, match })
  }
  return results
}

const Profile = z.object({ startTime: z.number(), endTime: z.number(),
  nodes: z.array(z.object({ id: z.number().int(), children: z.array(z.number().int()).optional(),
    callFrame: z.object({ functionName: z.string(), url: z.string(), lineNumber: z.number().int() }) })),
  samples: z.array(z.number().int()), timeDeltas: z.array(z.number().nonnegative()),
})
interface Aggregate { functionName: string; url: string; line: number; selfMicros: number; inclusiveMicros: number }
async function summarize(path: string) {
  const bytes = await readFile(path)
  const raw: unknown = JSON.parse(bytes.toString('utf8'))
  const profile = Profile.parse(raw)
  assert.equal(profile.samples.length, profile.timeDeltas.length)
  const nodes = new Map(profile.nodes.map(node => [node.id, node]))
  const parents = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id)
  const aggregates = new Map<string, Aggregate>()
  let totalMicros = 0
  for (const [index, sample] of profile.samples.entries()) {
    const micros = profile.timeDeltas[index]!
    totalMicros += micros
    const seenNodes = new Set<number>(), seenFunctions = new Set<string>()
    let id: number | undefined = sample
    while (id !== undefined) {
      assert.ok(!seenNodes.has(id), 'CPU profile call tree must not contain a cycle')
      seenNodes.add(id)
      const node = nodes.get(id)
      assert.ok(node, 'CPU sample must refer to a known node')
      const frame = node.callFrame
      const key = JSON.stringify([frame.functionName, frame.url, frame.lineNumber])
      const item = aggregates.get(key) ?? { functionName: frame.functionName || '(anonymous)', url: frame.url,
        line: frame.lineNumber + 1, selfMicros: 0, inclusiveMicros: 0 }
      if (id === sample) item.selfMicros += micros
      if (!seenFunctions.has(key)) item.inclusiveMicros += micros
      aggregates.set(key, item)
      seenFunctions.add(key)
      id = parents.get(id)
    }
  }
  const rows = [...aggregates.values()].map(item => ({ ...item,
    selfPercent: item.selfMicros * 100 / totalMicros, inclusivePercent: item.inclusiveMicros * 100 / totalMicros }))
  return { path, sha256: hash(bytes), samples: profile.samples.length, totalMicros,
    topSelf: [...rows].sort((a, b) => b.selfMicros - a.selfMicros).slice(0, 25),
    topInclusive: [...rows].sort((a, b) => b.inclusiveMicros - a.inclusiveMicros).slice(0, 35) }
}

const recordings: Array<{ route: Route; threadId: number; wallMs: number } & Awaited<ReturnType<typeof summarize>>> = []
try {
  await matcher.warmup()
  const expected = await run('batch')
  for (const route of ['batch', 'sequential'] as const) {
    for (let index = 0; index < 20; index++) assert.deepEqual(await run(route), expected)
    const path = join(directory, `${route}.cpuprofile`)
    const started = await control('start', path)
    let stopped: z.infer<typeof metadata>
    const began = performance.now()
    try {
      for (let index = 0; index < settings.samples; index++) assert.deepEqual(await run(route), expected)
    } finally { stopped = await control('stop', path) }
    assert.equal(stopped.threadId, started.threadId)
    assert.equal(matcher.getStats().workersStarted, 1, 'all measured work must use the profiled worker')
    const result = { route, threadId: started.threadId, wallMs: performance.now() - began, ...await summarize(path) }
    recordings.push(result)
    console.log(JSON.stringify({ route, threadId: result.threadId, samples: result.samples,
      topSelf: result.topSelf.slice(0, 8), topInclusive: result.topInclusive.slice(0, 12) }))
  }
} finally { await matcher.close() }
const after = await captureBenchmarkIdentity()
const sourceStable = isDeepStrictEqual(before.hashes, after.hashes)
await writeFile(join(directory, 'summary.json'), JSON.stringify({ format: 'reminder-worker-cpu-profile/v1',
  node: process.version, settings, workload: value.id,
  workloadHash: hash(JSON.stringify({ event: value.event, rules: value.rules, batchRules: value.batchRules })),
  sourceStable, before, after, instrumentation, recordings,
  limitation: 'Inspector sampling adds overhead; CPU attribution only, not latency or release acceptance.',
}, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
assert.equal(sourceStable, true, 'source and loaded artifacts must stay unchanged while profiling')
