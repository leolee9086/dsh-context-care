// Reproducible real-worker measurements; timings are observations, never test thresholds.
// Run with node --import ./test/shared-packages.js test/benchmark-detectors.js.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { normalizeRuleV2 } from '../src/vendor/rule-engine/index.js'
import { createBoundedMatcher } from '../src/bounded-matcher.js'
import { createDetectorRegistry } from '../src/detector-registry.js'

const declaration = match => normalizeRuleV2({ schemaVersion: 2, sourceId: 'benchmark', id: 'marker', revision: 1,
  on: ['output.delta'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match,
  actions: [{ id: 'notice', kind: 'notify', stage: 'output.delta', enabledDefault: true, template: 'hit' }] })
const rows = []
async function measure(kind, maxIdle, count, chunkChars) {
  const worker = createBoundedMatcher({ maxIdle }); const registry = createDetectorRegistry(worker)
  const rule = declaration(kind === 'builtin' ? { kind: 'detector', ref: 'context-care:marker', revision: 1, params: { token: 'END' } }
    : { kind: 'regex', pattern: 'END' })
  const options = { sessionId: 'benchmark', scope: 'benchmark/request/attempt', epoch: 'fixed' }
  const samples = []; let text = ''; let hits = 0
  try {
    for (let i = 0; i < count; i++) {
      text += i === count - 1 ? 'END' : 'x'.repeat(chunkChars)
      const input = { rules: [rule], stage: 'output.delta', snapshot: { session: { id: 'benchmark' } }, blocks: [{ id: 'block',
        sessionId: 'benchmark', requestId: 'request', attemptId: 'attempt', blockKey: 0, view: 'original', role: 'assistant', type: 'text', text }] }
      const start = performance.now()
      hits += (await registry.detect(input, undefined, options)).length
      samples.push(performance.now() - start)
    }
    assert.equal(hits, 1)
    const warm = samples.slice(1).sort((a, b) => a - b)
    rows.push({ kind, maxIdle, count, chunkChars, finalChars: text.length, hits,
      coldMs: samples[0], subsequentMedianMs: warm[Math.floor(warm.length / 2)], subsequentP95Ms: warm[Math.floor(warm.length * .95)],
      totalMs: samples.reduce((a, b) => a + b, 0) })
  } finally { await registry.close(); await worker.close() }
}
// maxIdle:0 provides the same matcher without retention as a controlled baseline.
for (const kind of ['native', 'builtin']) {
  await measure(kind, 0, 20, 1)
  await measure(kind, 2, 200, 1)
  await measure(kind, 2, 128, 256) // The last block remains below the default 32 Ki UTF-16 limit.
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, measuredAt: new Date().toISOString(), rows }, null, 2))
