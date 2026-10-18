import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

type Block = { type: 'text' | 'reasoning'; text: string }
type Chunk = { type: 'block-start'; index: number; blockType: Block['type'] }
  | { type: 'text-delta' | 'reasoning-delta'; index: number; text: string }
  | { type: 'block-end'; index: number; block: Block }
  | { type: 'finish'; reason: { kind: 'stop' } }
interface Request { signal?: AbortSignal; messages: readonly object[] }
interface OutputRule {
  format: 'reminder/v4'; id: string; on: 'assistant.output'; text: string
  when: { blockTypes: Block['type'][]; pattern: { kind: 'literal'; text: string } }
  effect: { kind: 'remind'; deliver: { model: { once: 'surface'; interrupt?: 'abort-resume'; shared?: { reset: 'lifetime'; lifetime: string; limit: number } } } }
}
interface HostCase {
  register(rules: OutputRule[]): void
  turn(): Promise<void>
  settle(): Promise<void>
  pending(): number
  notices(): number
  claims(): number
}
interface Harness {
  create(t: TestContext, stream: (request: Request) => AsyncGenerator<Chunk>, maxInterrupts?: number): Promise<HostCase>
}
const rule = (interrupt = false): OutputRule => ({ format: 'reminder/v4', id: 'marker', on: 'assistant.output', text: 'OUTPUT_NOTICE',
  when: { blockTypes: ['reasoning'], pattern: { kind: 'literal', text: 'ARCHIVE' } },
  effect: { kind: 'remind', deliver: { model: { once: 'surface', ...(interrupt ? { interrupt: 'abort-resume' as const } : {}),
    shared: { reset: 'lifetime', lifetime: 'output-test', limit: 1 } } } } })
async function* complete(text: string): AsyncGenerator<Chunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** The caller supplies the existing real Loader fixture, never a substitute Host. */
export function registerReminderHostCases(harness: Harness): void {
  test('output reminder waits for a natural next request and preserves readable reasoning boundaries', { timeout: 30000 }, async t => {
    const requests: Request[] = []
    const host = await harness.create(t, async function* (request) {
      requests.push(request)
      if (requests.length > 1) { yield* complete('Done.'); return }
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: 'ARCH' }
      yield { type: 'reasoning-delta', index: 0, text: 'IVE' }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'ARCHIVE' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    host.register([rule()])
    await host.turn(); await host.settle()
    assert.equal(requests.length, 1, 'A normal hit cannot wake an idle Agent')
    assert.equal(host.notices(), 0)
    assert.equal(host.pending(), 1)
    assert.equal(host.claims(), 0, 'Detection does not consume a shared slot')
    await host.turn()
    assert.equal(requests.length, 2)
    assert.match(JSON.stringify(requests[1]?.messages), /OUTPUT_NOTICE/)
    assert.equal(host.notices(), 1)
    assert.equal(host.claims(), 1)
  })

  test('output reminder reserves before interrupt and resumes using the same durable notice', { timeout: 30000 }, async t => {
    const requests: Request[] = []
    let aborted = false
    const host = await harness.create(t, async function* (request) {
      requests.push(request)
      if (requests.length > 1) { yield* complete('Resumed.'); return }
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: 'ARCHIVE' }
      // Model transport remains in flight while the asynchronous worker and storage finish.
      // A bounded watchdog fails the test rather than leaving an unending adapter.
      await delay(10000, undefined, { signal: request.signal }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== 'AbortError') throw error
        aborted = true
      })
      assert.equal(aborted, true, 'The real turn signal must be cancelled')
    })
    host.register([rule(true)])
    await host.turn(); await host.settle()
    assert.equal(requests.length, 2)
    assert.equal(host.notices(), 1)
    assert.equal(host.claims(), 1)
    assert.match(JSON.stringify(requests[1]?.messages), /OUTPUT_NOTICE/)
  })

  test('output reminder with zero interrupt budget remains pending until the next natural request', { timeout: 30000 }, async t => {
    let requests = 0
    const host = await harness.create(t, async function* (request) {
      requests++
      if (requests > 1) { yield* complete('Done.'); return }
      yield { type: 'reasoning-delta', index: 0, text: 'ARCHIVE' }
      await delay(200, undefined, { signal: request.signal })
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'ARCHIVE' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }, 0)
    host.register([rule(true)])
    await host.turn(); await host.settle()
    assert.equal(requests, 1)
    assert.equal(host.pending(), 1)
    assert.equal(host.claims(), 0)
    await host.turn()
    assert.equal(host.notices(), 1)
  })
}
