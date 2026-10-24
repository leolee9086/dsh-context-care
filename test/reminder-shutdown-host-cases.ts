import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { createReminderRuntime, ReminderSource } from '../lib/reminder-runtime/runtime.js'
import { readTrace, waitForTrace } from './fixtures/reminder-execution-real.ts'

type Runtime = ReturnType<typeof createReminderRuntime>
type UnloadScope = 'plugin' | 'host'
interface OwnedHost {
  root: string
  sessionId: string
  runtime: Runtime
  pending(): number
  events(): SessionEvent[]
  sideWrites(): number
  candidateStoreOpened(): boolean
  unload(scope: UnloadScope): Promise<void>
  replay(source: ReminderSource): Promise<string[]>
}
interface Harness { open(t: TestContext): Promise<OwnedHost> }

/** Production teardown follows native inbox disposal and waits for its actual Workers. */
export function registerShutdownHostCases(harness: Harness): void {
  for (const scope of ['plugin', 'host'] as const) {
    const owner = scope === 'host' ? 'Host' : 'reminder plugin'
    test(`real ${owner} unload follows native inbox cancellation without candidate storage`, { timeout: 30000 }, async t => {
      const host = await harness.open(t), { runtime, sessionId } = host
      const tracePath = join(host.root, 'shutdown-worker.jsonl')
      const heartbeatPath = join(host.root, 'shutdown-heartbeat.txt')
      runtime.registerDetector({ ref: 'shutdown', revision: 1,
        module: new URL('./fixtures/reminder-execution-real.ts', import.meta.url).href })
      const source: ReminderSource = { sourceId: 'host-drain', plugin: 'test', revision: 1, rules: [
        { format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'HOST_DRAIN_NOTICE',
          when: { tool: 'read' }, judge: { ref: 'shutdown', revision: 1, params: { label: 'frozen', tracePath, mode: 'quick', ok: true, value: null } },
          effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } },
        { format: 'reminder/v4', id: 'unfinished', on: 'tool.succeeded', text: 'UNFINISHED_NOTICE',
          when: { tool: 'blocked' }, judge: { ref: 'shutdown', revision: 1, params: { label: 'unfinished', tracePath, mode: 'cpu', heartbeatPath, ok: true, value: null } },
          effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } },
      ] }
      runtime.registerSource(source)
      await runtime.submit({ type: 'tool.succeeded', sessionId, name: 'read', arguments: {}, callId: 'seed', rootCallId: 'seed' })
      assert.equal(host.pending(), 1, 'the completed Worker result is already owned by the native inbox')
      assert.equal(host.candidateStoreOpened(), false)
      assert.deepEqual(runtime.pendingPersistence(), [])
      const unfinished = runtime.submit({ type: 'tool.succeeded', sessionId, name: 'blocked', arguments: {}, callId: 'unfinished', rootCallId: 'unfinished' })
      await waitForTrace(tracePath, entry => entry.label === 'unfinished' && entry.phase === 'start')
      await host.unload(scope)
      await unfinished
      // The CPU judge does not cooperate with cancellation. Stable physical output
      // after real teardown demonstrates Worker termination, not a settled wrapper.
      const heartbeat = await readFile(heartbeatPath, 'utf8')
      await delay(40)
      assert.equal(await readFile(heartbeatPath, 'utf8'), heartbeat)
      assert.equal(readTrace(tracePath).filter(entry => entry.label === 'unfinished' && entry.phase === 'end').length, 0)
      const events = host.events()
      assert.equal(events.filter(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.source.kind === 'plugin:dsh-context-care:reminder')).length, 1)
      assert.equal(events.some(event => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled'), scope === 'host',
        'only the actual Agent disposal cancels its pending input; plugin disposal does not')
      assert.equal(host.sideWrites(), 0)
      assert.deepEqual(runtime.pendingPersistence(), [])
      assert.deepEqual(await host.replay(source), scope === 'host' ? [] : ['HOST_DRAIN_NOTICE'])
      assert.equal(readTrace(tracePath).filter(entry => entry.phase === 'start').length, 2,
        'empty-cache replay neither rejudges the frozen handoff nor resurrects the canceled Worker')
    })
  }
}
