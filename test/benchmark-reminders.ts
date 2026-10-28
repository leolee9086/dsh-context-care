import { createBoundedMatcher, MatcherFailure, compileEventActions as compileRule, CountLimits, BatchAnswer, BatchResult, RuleEventInput as Event, EventMatchResult as MatchResult, normalizeCondition } from '@leolee9086/dsh-rule-engine'
import type { BatchRuleInput, EventDetectorValue as DetectorValue, EventValue, EventWork as Work, EventAction as CompiledRule } from '@leolee9086/dsh-rule-engine'
import assert from 'node:assert/strict'
import { eventRule } from './event-rule.js'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'








// This program measures the shipped worker path. It never supplies an execute replacement.
// Run only after the Lead grants a CPU measurement window; do not run alongside CPU-loop tests.
// pnpm exec node test/benchmark-reminders.ts --output-before
// A short compatibility run: pnpm exec node test/benchmark-reminders.ts --smoke
const root = fileURLToPath(new URL('../', import.meta.url))
const fixtureUrl = new URL('./fixtures/reminder-benchmark.ts', import.meta.url).href
const limits = CountLimits.parse(undefined)
const maxBytes = 4 * 1024 * 1024
const workTimeoutMs = 5000
const poolOptions = { timeoutMs: workTimeoutMs, startupMs: 10000, maxBytes: 32 * 1024 * 1024, maxIdle: 1, maxPending: 256 }
type Pool = ReturnType<typeof createBoundedMatcher>
type Kind = 'conditions' | 'judges' | 'mixed'
type Route = 'sequential' | 'batch'
type Match = z.infer<typeof MatchResult>
type Json = z.infer<ReturnType<typeof z.json>>
type Failure = { name: string; message: string }
type Outcome = { key: string; match: Match } | { key: string; error: Failure }
interface FailureEnvelope { key: string; wrapper: Failure; cause: Failure; diagnostic: MatcherFailure['diagnostic'] }
type Comparison = 'raw' | 'worker'
interface Workload { id: string; kind: Kind; event: EventValue; rules: CompiledRule[]; batchRules: BatchRuleInput[]; compileMs: number }
interface Execution {
  ms: number; dispatched: number; inputJsonBytes: number; outcomes: Outcome[]
  workerOutcomes: Outcome[]; failureEnvelopes: FailureEnvelope[]
  streamed: Outcome[]; workerItemMs: number[]; workerElapsedMs: number | null
  stopped: boolean; transportError: Failure | null; protocolErrors: string[]
}
interface Options { samples: number; cold: number; warmup: number; ruleCounts: number[]; eventChars: number[];
  outputBefore: boolean; outputAfter: boolean; outputFile: string | undefined }

function options(): Options {
  const args = new Map<string, string>()
  for (const argument of process.argv.slice(2)) {
    const [key, value] = argument.split('=', 2)
    if (key === undefined || !['--smoke', '--samples', '--cold', '--warmup', '--rules', '--event-chars', '--output-before', '--output-after', '--output-file'].includes(key)) {
      throw new Error(`unknown benchmark argument: ${argument}`)
    }
    if (key === '--output-file' && !value?.trim()) throw new Error('--output-file requires a nonempty path')
    args.set(key, value ?? 'true')
  }
  const smoke = args.has('--smoke')
  const positive = (key: string, standard: number) => z.coerce.number().int().min(1).max(10000).parse(args.get(key) ?? standard)
  const list = (key: string, standard: number[]) => {
    const value = args.get(key)
    return value === undefined ? standard : value.split(',').map(item => z.coerce.number().int().min(1).max(65536).parse(item))
  }
  return { samples: positive('--samples', smoke ? 2 : 25), cold: positive('--cold', smoke ? 1 : 3),
    warmup: positive('--warmup', smoke ? 1 : 3), ruleCounts: list('--rules', smoke ? [8] : [1, 13, 64]),
    eventChars: list('--event-chars', smoke ? [512] : [512, 32768]), outputBefore: args.has('--output-before'), outputAfter: args.has('--output-after'),
    outputFile: args.get('--output-file') }
}

const errorOf = (error: unknown): Failure => error instanceof Error
  ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) }
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const hashJson = (value: unknown) => hash(JSON.stringify(value))
/** Keep the workload identity stable when the same local judge is replayed from an extracted source archive. */
function workloadDigest(value: Workload): string {
  const batchRules = value.batchRules.map(rule => rule.judge === undefined ? rule
    : { ...rule, judge: { ...rule.judge, module: 'fixture://reminder-benchmark' } })
  return hashJson({ event: value.event, rules: value.rules, batchRules })
}
const descriptor = (exportName = 'judge'): DetectorValue => ({ ref: 'benchmark-judge', revision: 1, module: fixtureUrl, exportName })

/** Exercise canonical event declarations; only inert context padding changes across sizes. */
export function workload(kind: Kind, count: number, eventChars: number): Workload {
  const id = `${kind}-${count}-${eventChars}`
  const event = Event.parse({ type: 'tool.before-execute', sessionId: 'benchmark-session', callId: id, rootCallId: id,
    name: 'pwsh', arguments: { command: 'Get-ChildItem ./fixture TARGET TARGET', body: '😀TARGET。普通。TARGET。' },
    clock: { at: 1792512000000 }, facts: { level: 3, disabled: false }, origin: 'tool',
    context: { messages: [{ role: 'user', text: 'context '.repeat(Math.ceil(eventChars / 8)).slice(0, eventChars), truncated: false }], truncated: false },
    textSamples: [{ field: 'tool.arguments.body', sampleId: 'body-complete', window: 'current-block', phase: 'complete', truncated: false }] })
  const countCondition = (field: string): Json => ({ kind: 'count', source: { kind: 'text', field, projection: 'raw', locale: 'zh-CN', metaPrefixes: [] },
    pattern: { kind: 'literal', text: 'TARGET' }, metric: 'occurrences', window: { kind: 'current-block' }, evaluate: 'complete',
    compare: { op: 'gte', value: 2 }, limits })
  const conditions: Json[] = [
    { kind: 'all', conditions: [{ kind: 'regex', field: 'tool.arguments.command', pattern: '(TARGET)', flags: 'u' },
      { kind: 'compare', field: 'facts.level', op: 'gte', value: 2 }] },
    { kind: 'compare', field: 'tool.arguments.command', op: 'contains', value: 'ABSENT' },
    countCondition('tool.arguments.body'),
    countCondition('tool.arguments.missing'),
    { kind: 'not', condition: { kind: 'compare', field: 'facts.disabled', op: 'eq', value: true } },
    { kind: 'any', conditions: [{ kind: 'compare', field: 'facts.level', op: 'gte', value: 2 }, countCondition('tool.arguments.body')] },
  ]
  const began = performance.now()
  const rules = Array.from({ length: count }, (_, index) => {
    const condition = conditions[index % conditions.length]
    assert.ok(condition !== undefined)
    const hasJudge = kind === 'judges' || (kind === 'mixed' && index % 2 === 0)
    return compileRule(eventRule('tool.before-execute', { id: `r${index}`, priority: count - index,
      ...(index % 3 === 0 ? { exclusiveGroup: `group-${Math.floor(index / 3)}` } : {}),
      event: { tool: 'pwsh', arguments: { command: { regex: 'Get-ChildItem' } } }, match: normalizeCondition(condition),
      ...(hasJudge ? { judge: { ref: 'benchmark-judge', revision: 1, params: {
        mode: index % 8 === 4 ? 'reject' : index % 8 === 6 ? 'throw' : 'accept', tag: `tag-${index}`,
        marker: 'TARGET', minimumLevel: 2, expectedCallId: id,
      } } } : {}),
    }, { template: `fixture rule ${index}`, ...(index % 4 === 0 ? { deny: { dangerous: true, reason: `fixture-denial-${index}` } } : {}) }), limits)
  }).flat()
  const compileMs = performance.now() - began
  const batchRules = rules.map((rule): BatchRuleInput => ({ key: rule.id, condition: rule.condition,
    ...(rule.judge === undefined ? {} : { judge: descriptor(), params: z.json().parse(rule.judge.params ?? null) }) }))
  return { id, kind, event, rules, batchRules, compileMs }
}

function inputs(value: Workload, route: Route): Work[] {
  const common = { event: value.event, maxBytes, countLimits: limits }
  return route === 'batch' ? [{ reminderBatch: { ...common, rules: value.batchRules } }]
    : value.batchRules.map(rule => ({ reminder: { ...common, condition: rule.condition,
      ...(rule.judge === undefined ? {} : { judge: rule.judge, params: rule.params ?? null }) } }))
}

function outcome(raw: unknown): { value: Outcome; ms: number } {
  const answer = BatchAnswer.parse(raw)
  return { value: 'error' in answer ? { key: answer.key, error: { name: answer.error.name, message: answer.error.message } }
    : { key: answer.key, match: MatchResult.parse(answer.match) }, ms: answer.ms }
}

/** Every sequential call really crosses the worker port. No multiplied RTT or mock executor. */
async function execute(pool: Pool, value: Workload, route: Route): Promise<Execution> {
  const requests = inputs(value, route)
  const inputJsonBytes = requests.reduce((sum, request) => sum + bytes(request), 0)
  let dispatched = 0
  const outcomes: Outcome[] = []; const streamed: Outcome[] = []; const workerItemMs: number[] = []
  const protocolErrors: string[] = []
  const failures: { key: string; error: unknown }[] = []
  let workerElapsedMs: number | null = null; let stopped = false; let transportError: Failure | null = null
  const onDispatch = () => { dispatched++ }
  const onItem = (raw: unknown) => {
    try { streamed.push(outcome(raw).value) }
    catch (error) { protocolErrors.push(errorOf(error).message) }
  }
  // JS declaration inference retains only the defaulted workTimeoutMs property.
  // A structurally typed variable preserves the real optional callbacks without an unsafe cast.
  const timing = { workTimeoutMs, onDispatch, onItem }
  const began = performance.now()
  if (route === 'sequential') {
    for (const [index, request] of requests.entries()) {
      const rule = value.batchRules[index]
      assert.ok(rule !== undefined)
      try {
        const raw: unknown = await pool.detect(request, undefined, timing)
        outcomes.push({ key: rule.key, match: MatchResult.parse(raw) })
      } catch (error: unknown) {
        outcomes.push({ key: rule.key, error: errorOf(error) })
        failures.push({ key: rule.key, error })
      }
    }
  } else {
    try {
      const request = requests[0]
      assert.ok(request !== undefined)
      const raw: unknown = await pool.detect(request, undefined, timing)
      const answer = BatchResult.parse(raw)
      stopped = answer.stopped; workerElapsedMs = answer.elapsedMs
      for (const rawItem of answer.items) {
        const parsed = outcome(rawItem)
        outcomes.push(parsed.value); workerItemMs.push(parsed.ms)
      }
    } catch (error) { transportError = errorOf(error) }
  }
  const ms = performance.now() - began
  if (route === 'batch' && transportError === null) {
    if (!isDeepStrictEqual(streamed, outcomes)) protocolErrors.push('streamed/final receipts differ')
    if (new Set(outcomes.map(item => item.key)).size !== outcomes.length) protocolErrors.push('duplicate batch key')
    if (!stopped && !isDeepStrictEqual(outcomes.map(item => item.key), value.batchRules.map(item => item.key))) protocolErrors.push('batch key order/count differ')
  }
  // The single-task API rejects with a scheduler envelope; batch items carry the
  // worker error directly. Retain both layers and compare the worker name/message.
  const failureEnvelopes = failures.flatMap(({ key, error }): FailureEnvelope[] =>
    error instanceof MatcherFailure && error.cause instanceof Error
      ? [{ key, wrapper: errorOf(error), cause: errorOf(error.cause), diagnostic: error.diagnostic }] : [])
  const workerOutcomes = outcomes.map((item): Outcome => {
    const envelope = failureEnvelopes.find(failure => failure.key === item.key)
    return 'error' in item && envelope !== undefined ? { key: item.key, error: envelope.cause } : item
  })
  return { ms, dispatched, inputJsonBytes, outcomes, workerOutcomes, failureEnvelopes, streamed, workerItemMs, workerElapsedMs, stopped, transportError, protocolErrors }
}

/** A few explicit fixture expectations prevent two equally wrong routes from looking equivalent. */
function fixtureExpectations(value: Workload, result: Execution): string[] {
  const issues: string[] = []
  for (const [index, rule] of value.rules.entries()) {
    const answer = result.workerOutcomes.find(item => item.key === rule.id)
    const conditionStatus = index % 6 === 1 ? 'unmatched' : index % 6 === 3 ? 'unavailable' : 'matched'
    const judged = rule.judge !== undefined && conditionStatus === 'matched'
    const throws = judged && index % 8 === 6
    if (answer === undefined) { issues.push(`${rule.id}: missing worker outcome`); continue }
    if (throws) {
      if (!('error' in answer) || answer.error.name !== 'Error' || answer.error.message !== `benchmark-judge-rejected:tag-${index}`) issues.push(`${rule.id}: missing judge exception`)
      continue
    }
    if ('error' in answer) { issues.push(`${rule.id}: unexpected error ${answer.error.message}`); continue }
    const expectedStatus = judged && index % 8 === 4 ? 'unmatched' : conditionStatus
    if (answer.match.status !== expectedStatus || answer.match.ok !== (expectedStatus === 'matched')) issues.push(`${rule.id}: wrong ok/status`)
    if (judged) {
      const facts = z.object({ tag: z.literal(`tag-${index}`), eventId: z.literal(value.id),
        contextChars: z.literal(value.event.context!.messages[0]!.text.length), digest: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(answer.match.facts)
      if (!facts.success) issues.push(`${rule.id}: judge params/event facts were not preserved`)
    } else if (answer.match.facts !== undefined) issues.push(`${rule.id}: judge ran for a condition without a match`)
    if (index % 6 === 2) {
      const measured = z.array(z.object({ sampleId: z.literal('body-complete'), result: z.object({ value: z.literal(2),
        evidence: z.array(z.object({ start: z.number(), end: z.number() })).length(2) }) })).length(1).safeParse(answer.match.measurements)
      if (!measured.success) issues.push(`${rule.id}: count evidence missing`)
    }
  }
  return issues
}

function equivalence(single: Execution, batch: Execution, ruleCount: number, comparison: Comparison) {
  const left = comparison === 'raw' ? single.outcomes : single.workerOutcomes
  const right = comparison === 'raw' ? batch.outcomes : batch.workerOutcomes
  const byKey = new Map(right.map(item => [item.key, item]))
  const compared = left.filter(item => byKey.has(item.key))
  const differing = compared.filter(item => !isDeepStrictEqual(item, byKey.get(item.key))).map(item => item.key)
  const missing = left.filter(item => !byKey.has(item.key)).map(item => item.key)
  const complete = left.length === ruleCount && right.length === ruleCount
    && new Set(left.map(item => item.key)).size === ruleCount && byKey.size === ruleCount
    && isDeepStrictEqual(left.map(item => item.key), right.map(item => item.key))
    && single.transportError === null && !single.stopped && single.protocolErrors.length === 0
    && batch.transportError === null && !batch.stopped && batch.protocolErrors.length === 0
  return { equivalent: complete && differing.length === 0 && missing.length === 0, compared: compared.length,
    differing, missing, batchRejected: batch.transportError !== null }
}

function statistics(samples: number[]) {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const quantile = (fraction: number) => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!
  const total = samples.reduce((sum, value) => sum + value, 0)
  const mean = total / samples.length
  return { n: samples.length, minMs: sorted[0]!, p50Ms: quantile(0.5), p95Ms: quantile(0.95), maxMs: sorted.at(-1)!, meanMs: mean,
    stddevMs: Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length), totalMs: total }
}

function routeSummary(samples: Execution[], ruleCount: number) {
  const latency = statistics(samples.map(sample => sample.ms))
  assert.ok(latency !== null)
  const complete = samples.every(sample => sample.transportError === null && !sample.stopped && sample.protocolErrors.length === 0 && sample.outcomes.length === ruleCount)
  return { latency, rawMs: samples.map(sample => sample.ms), complete,
    // Unavailable and per-rule errors are actual observations, but a rejected batch evaluated no rules.
    evaluatedRulesPerSecond: complete ? samples.length * ruleCount * 1000 / latency.totalMs : null,
    dispatched: samples.map(sample => sample.dispatched), inputJsonBytes: samples.map(sample => sample.inputJsonBytes),
    workerElapsedMs: samples.map(sample => sample.workerElapsedMs), workerItemMs: samples.map(sample => sample.workerItemMs),
    semanticDigests: samples.map(sample => hashJson(sample.workerOutcomes)),
    rawOutcomeDigests: samples.map(sample => hashJson(sample.outcomes)),
    transportErrors: samples.filter(sample => sample.transportError !== null).length,
    protocolErrors: samples.flatMap(sample => sample.protocolErrors), first: samples[0] }
}

async function cold(value: Workload, route: Route): Promise<Execution> {
  const pool = createBoundedMatcher(poolOptions)
  try { return await execute(pool, value, route) }
  finally { await pool.close() }
}

async function measure(value: Workload, settings: Options) {
  const coldSingle: Execution[] = []; const coldBatch: Execution[] = []
  for (let index = 0; index < settings.cold; index++) {
    // Alternate order to avoid giving one path all the first-run environmental effects.
    if (index % 2 === 0) { coldSingle.push(await cold(value, 'sequential')); coldBatch.push(await cold(value, 'batch')) }
    else { coldBatch.push(await cold(value, 'batch')); coldSingle.push(await cold(value, 'sequential')) }
  }
  const single: Execution[] = []; const batch: Execution[] = []
  const pool = createBoundedMatcher(poolOptions)
  let poolStats: ReturnType<Pool['getStats']>
  try {
    await pool.warmup()
    for (let index = 0; index < settings.warmup; index++) { await execute(pool, value, 'sequential'); await execute(pool, value, 'batch') }
    for (let index = 0; index < settings.samples; index++) {
      if (index % 2 === 0) { single.push(await execute(pool, value, 'sequential')); batch.push(await execute(pool, value, 'batch')) }
      else { batch.push(await execute(pool, value, 'batch')); single.push(await execute(pool, value, 'sequential')) }
    }
    poolStats = pool.getStats()
  } finally { await pool.close() }
  const compare = (left: Execution[], right: Execution[], comparison: Comparison) => left.map((sample, index) => {
    const other = right[index]
    assert.ok(other !== undefined)
    return equivalence(sample, other, value.rules.length, comparison)
  })
  const coldEquivalence = compare(coldSingle, coldBatch, 'worker'); const warmEquivalence = compare(single, batch, 'worker')
  const coldRaw = compare(coldSingle, coldBatch, 'raw'); const warmRaw = compare(single, batch, 'raw')
  const rawEnvelopesEquivalent = [...coldRaw, ...warmRaw].every(pair => pair.equivalent)
  const sequential = routeSummary(single, value.rules.length); const batched = routeSummary(batch, value.rules.length)
  const fixtureIssues = [...new Set([...coldSingle, ...single, ...coldBatch, ...batch]
    .filter(sample => sample.transportError === null).flatMap(sample => fixtureExpectations(value, sample)))]
  const semanticsEquivalent = [...coldEquivalence, ...warmEquivalence].every(pair => pair.equivalent) && fixtureIssues.length === 0
  const stable = new Set([...coldSingle, ...single].map(sample => hashJson(sample.outcomes))).size === 1
    && new Set([...coldBatch, ...batch].map(sample => hashJson(sample.outcomes))).size === 1
  return { id: value.id, kind: value.kind, ruleCount: value.rules.length, judgeCount: value.batchRules.filter(rule => rule.judge !== undefined).length,
    eventJsonBytes: bytes(value.event), contextChars: value.event.context?.messages[0]?.text.length,
    workloadHash: workloadDigest(value), compileMs: value.compileMs,
    cold: { sequential: routeSummary(coldSingle, value.rules.length), batch: routeSummary(coldBatch, value.rules.length), equivalence: coldEquivalence, rawEquivalence: coldRaw },
    warm: { sequential, batch: batched, equivalence: warmEquivalence, rawEquivalence: warmRaw }, poolStats, fixtureIssues, stable, semanticsEquivalent, rawEnvelopesEquivalent,
    speedup: semanticsEquivalent && stable ? { p50: sequential.latency.p50Ms / batched.latency.p50Ms, p95: sequential.latency.p95Ms / batched.latency.p95Ms } : null }
}

/** Hash both sources and actual worker-loaded artifacts; HEAD alone is insufficient in a dirty tree. */
async function provenance() {
  const files = ['src/match-worker.js',
    'src/reminder-runtime/runtime.ts', 'lib/reminder-runtime/runtime.js',
    'package.json', 'pnpm-lock.yaml', 'test/benchmark-reminders.ts', 'test/fixtures/reminder-benchmark.ts',
    'node_modules/zod/package.json']
  const hashes: Record<string, string> = {}
  for (const file of files) hashes[file] = hash(await readFile(new URL(file, new URL('../', import.meta.url))))
  // Hash the actually resolved engine, including the worker modules loaded by its
  // public entry. The explicit source-checkout hook and installed package agree.
  const engineRoot = new URL('.', import.meta.resolve('@leolee9086/dsh-rule-engine/package.json'))
  const engineFiles = ['package.json', ...['index', 'matcher-pool', 'matcher-progress', 'worker-error', 'rule-worker',
    'event-matcher', 'event-evaluation', 'event-rules', 'block-rules', 'snapshot-conditions', 'text-count', 'text-projection']
    .flatMap(name => [`lib/${name}.js`, `lib/${name}.d.ts`])]
  for (const file of engineFiles) hashes[`engine:${file}`] = hash(await readFile(new URL(file, engineRoot)))
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const status = git(['status', '--porcelain'])
  return { head: git(['rev-parse', 'HEAD']), dirty: status.length > 0, status, hashes }
}

async function verifyTsJudge() {
  const pool = createBoundedMatcher(poolOptions)
  try {
    const value = workload('conditions', 1, 32)
    const timing = { workTimeoutMs, onDispatch: () => {}, onItem: (_raw: unknown) => {} }
    const raw: unknown = await pool.detect({ reminder: { event: value.event, condition: value.rules[0]!.condition,
      countLimits: limits, maxBytes, judge: descriptor('probe'), params: null } }, undefined, timing)
    const parsed = z.object({ ok: z.literal(true), facts: z.object({ isMainThread: z.literal(false), threadId: z.number().int().positive(),
      execArgv: z.array(z.string()).length(0), node: z.string() }) }).parse(raw)
    return { verified: true as const, fixtureUrl, ...parsed.facts }
  } catch (error) { return { verified: false as const, fixtureUrl, error: errorOf(error) } }
  finally { await pool.close() }
}

/** Real receipts establish the accepted projection; altered copies must still fail comparison. */
async function verifyErrorComparison() {
  const pool = createBoundedMatcher(poolOptions)
  const value = workload('judges', 8, 512)
  try {
    const single = await execute(pool, value, 'sequential')
    const batch = await execute(pool, value, 'batch')
    assert.deepEqual(fixtureExpectations(value, single), [])
    assert.deepEqual(fixtureExpectations(value, batch), [])
    assert.equal(single.failureEnvelopes.length, 1)
    const envelope = single.failureEnvelopes[0]
    assert.ok(envelope !== undefined)
    assert.equal(envelope.key, 'r6')
    assert.equal(envelope.wrapper.name, 'MatcherFailure')
    assert.deepEqual(envelope.cause, { name: 'Error', message: 'benchmark-judge-rejected:tag-6' })
    assert.equal(envelope.diagnostic.phase, 'processing')
    assert.equal(equivalence(single, batch, 8, 'raw').equivalent, false)
    assert.equal(equivalence(single, batch, 8, 'worker').equivalent, true)
    const changedError = (change: Partial<Failure>): Execution => ({ ...batch,
      workerOutcomes: batch.workerOutcomes.map((item): Outcome => item.key === 'r6' && 'error' in item
        ? { key: item.key, error: { ...item.error, ...change } } : item) })
    assert.equal(equivalence(single, changedError({ name: 'TypeError' }), 8, 'worker').equivalent, false)
    assert.equal(equivalence(single, changedError({ message: 'different judge failure' }), 8, 'worker').equivalent, false)
    assert.equal(equivalence(single, { ...batch, workerOutcomes: batch.workerOutcomes.slice(1) }, 8, 'worker').equivalent, false)
    assert.equal(equivalence(single, { ...batch, workerOutcomes: [...batch.workerOutcomes].reverse() }, 8, 'worker').equivalent, false)
    const changedMatch: Execution = { ...batch, workerOutcomes: batch.workerOutcomes.map((item): Outcome =>
      item.key === 'r0' && 'match' in item ? { key: item.key, match: { ...item.match, ok: !item.match.ok } } : item) }
    assert.equal(equivalence(single, changedMatch, 8, 'worker').equivalent, false)
    assert.equal(equivalence(single, { ...batch, protocolErrors: ['streamed/final receipts differ'] }, 8, 'worker').equivalent, false)
    return { verified: true as const, rawEnvelopesEquivalent: false, workerResultsEquivalent: true,
      rejectsChangedErrorName: true, rejectsChangedErrorMessage: true, rejectsMissingResult: true,
      rejectsReorderedResults: true, rejectsChangedMatch: true, rejectsProtocolError: true }
  } finally { await pool.close() }
}

async function main() {
  const settings = options(); const startedAt = new Date().toISOString()
  if ([settings.outputBefore, settings.outputAfter, settings.outputFile !== undefined].filter(Boolean).length > 1) {
    throw new Error('choose exactly one output artifact')
  }
  const before = await provenance()
  const probe = await verifyTsJudge()
  const results: Awaited<ReturnType<typeof measure>>[] = []
  let failure: Failure | null = null
  let comparisonProbe: Awaited<ReturnType<typeof verifyErrorComparison>> | null = null
  try {
    if (!probe.verified) throw new Error('real worker cannot import the TS judge; matrix not run')
    if (!settings.outputBefore) comparisonProbe = await verifyErrorComparison()
    for (const eventChars of settings.eventChars) for (const ruleCount of settings.ruleCounts) {
      for (const kind of ['conditions', 'judges', 'mixed'] as const) {
        const result = await measure(workload(kind, ruleCount, eventChars), settings)
        results.push(result)
        const differing = [...new Set([...result.cold.rawEquivalence, ...result.warm.rawEquivalence].flatMap(pair => pair.differing))]
        console.log(JSON.stringify({ id: result.id, equivalent: result.semanticsEquivalent, rawEnvelopesEquivalent: result.rawEnvelopesEquivalent, speedup: result.speedup,
          sequentialP50Ms: result.warm.sequential.latency.p50Ms, batchP50Ms: result.warm.batch.latency.p50Ms,
          batchRejected: result.warm.batch.transportErrors, fixtureIssues: result.fixtureIssues,
          differences: differing.map(key => ({ key,
            sequential: result.warm.sequential.first?.outcomes.find(item => item.key === key),
            batch: result.warm.batch.first?.outcomes.find(item => item.key === key) })) }))
      }
    }
  } catch (error) { failure = errorOf(error) }
  const fixtureFailures = results.flatMap(result => result.fixtureIssues.map(issue => `${result.id}: ${issue}`))
  if (fixtureFailures.length > 0) failure = { name: 'BenchmarkFixtureFailure', message: fixtureFailures.join('\n') }
  // Unsupported baseline shapes remain evidence; every other run, including smoke,
  // fails unless all measured pairs are complete, equivalent, and stable.
  if (!settings.outputBefore && failure === null) {
    const invalid = results.filter(result => !result.semanticsEquivalent || !result.stable)
    if (invalid.length > 0) failure = { name: 'BenchmarkEquivalenceFailure',
      message: invalid.map(result => result.id).join(', ') }
  }
  const after = await provenance()
  const sourceStable = isDeepStrictEqual(before.hashes, after.hashes) && before.head === after.head
  if (!sourceStable) for (const result of results) result.speedup = null
  const report = { format: 'reminder-worker-benchmark/v2', startedAt, finishedAt: new Date().toISOString(), settings,
    validBaseline: sourceStable && failure === null,
    environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(),
      cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, availableParallelism: os.availableParallelism(), totalMemory: os.totalmem(),
      parentExecArgv: process.execArgv }, poolOptions, countLimits: limits, maxBytes, before, after, sourceStable, probe, comparisonProbe, failure,
    measurement: { latencyUnit: 'ms', percentile: 'nearest rank; cold sample count is intentionally small',
      timing: 'detect-to-completion includes real JSON sizing, worker cloning, schema validation and matching plus benchmark receipt parsing/collection; rule compile is separately measured',
      dispatchObservation: 'onDispatch callback invocations upon worker started receipts; not rule-count prediction or low-level MessagePort instrumentation; historical v1 callback timing differed',
      payloadBytes: 'sum of UTF-8 JSON input envelopes per actual call; excludes generated taskId and is not structured-clone wire bytes',
      warming: 'one worker shared by both alternating hot routes; cold pools are recreated and closed per sample',
      equivalence: 'full per-key worker match or original error name/message, excluding protocol ms; unwrap one verified MatcherFailure with an Error cause; preserve raw outcomes, wrappers and diagnostics separately; rawEquivalence keeps the v1 name/message comparison; streamed/final receipts must agree',
      runtimeBoundary: 'priority/exclusiveGroup/effect remain in compiled rule metadata; this matcher benchmark does not execute candidate selection, persistence or deny-tool authorization',
      unverified: ['runtime solo-first order', 'runtime duplicate in-flight solo after batch', 'worker queue time versus rule budget',
        'runtime priority/exclusivity/candidates/denial', 'CPU cancellation and worker exit'],
      speedupEligibility: 'only complete worker-result-equivalent stable pairs; raw API envelopes may differ explicitly; schema rejection latency never counts as improvement',
      noThresholdClaim: 'matcher measurement only; this does not establish end-to-end runtime or release acceptance' }, results }
  if (settings.outputBefore || settings.outputAfter || settings.outputFile !== undefined) {
    // Exclusive create also protects named experiments; a fresh result must
    // never overwrite the historical baseline or an earlier accepted report.
    const phase = settings.outputBefore ? 'before' : 'after'
    const destination = settings.outputFile === undefined
      ? new URL(`../.local/logs/benchmark-reminders-${phase}.json`, import.meta.url) : pathToFileURL(settings.outputFile)
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    console.log(`saved ${fileURLToPath(destination)}`)
  }
  console.log(JSON.stringify({ cases: results.length, sourceStable, tsJudgeVerified: probe.verified, comparisonProbe, failure,
    equivalent: results.filter(result => result.semanticsEquivalent).length,
    unsupportedOrDifferent: results.filter(result => !result.semanticsEquivalent).map(result => result.id) }))
  if (failure !== null || !sourceStable) process.exitCode = 1
}

export { provenance as captureBenchmarkIdentity }

// The profiler imports the exact workload without running a second benchmark.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) await main()
