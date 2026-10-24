import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ReminderService, ReminderSource, CustomEventDescriptor } from '../lib/reminder-runtime/runtime.js'
import { NativeObservation, NativeSessionObservation, NativeBeforeObservation, NativeAliasObservation } from './fixtures/reminder-native-context.ts'

interface NativeSeed {
  header: SessionHeader
  events: SessionEvent[]
  inheritedEventCount: SessionLogOffset
}
interface Harness {
  capture(t: TestContext, handBefore?: boolean, cancelAfterBefore?: boolean, collapseBefore?: boolean,
    abortAt?: 'before' | 'after', after?: { source: ReminderSource; handoffRules: string[];
      detector: { ref: string; revision: number; module: string } }): Promise<NativeSeed>
  captureAlias(t: TestContext, descriptor: CustomEventDescriptor, source: ReminderSource,
    detector: { ref: string; revision: number; module: string; exportName: string }, late?: boolean): Promise<NativeSeed>
  open(t: TestContext, seed: NativeSeed, cachedSeen?: string[], cachedCandidates?: unknown[]): Promise<{
    runtime: ReminderService; liveCount(): number; storedSeen(): Promise<string[]>; storedCandidates(): Promise<unknown[]>; sideWriteCount(): number
  }>
}

/** A new real Host reads only the prior Host's native JSONL Session. */
export function registerNativeTriggerCases(harness: Harness) {
  test('native cancellation result alone cannot prove whether a pre-execute match completed', async t => {
    // capture verifies actual hook entry, zero body executions and zero native inbox
    // handoffs. Only the after-hook run has a live, completed pending reminder.
    const before = await harness.capture(t, true, false, false, 'before')
    const after = await harness.capture(t, true, false, false, 'after')
    function terminal(seed: NativeSeed) {
      const result = seed.events.find(event => event.type === 'tool/result'
        && String(event.data.message.toolCallId) === 'native-prefix-call')
      assert.ok(result && result.type === 'tool/result')
      assert.equal(result.data.error?.code, 'ABORTED_BEFORE_DISPATCH')
      return { error: result.data.error, content: result.data.message.content }
    }
    assert.deepEqual(terminal(after), terminal(before), 'the real native outcome does not record which side of pre-execute was cancelled')
  })
  test('a custom event alias replays the bound native Session event without side state', async t => {
    const descriptor: CustomEventDescriptor = { name: 'care/native-tool-result', nativeEvent: 'tool/result' }
    const root = await mkdtemp(join(tmpdir(), 'care-native-alias-worker-'))
    const tracePath = join(root, 'actual-alias-judge.jsonl')
    t.after(() => rm(root, { recursive: true, force: true }))
    const detector = { ref: 'native-alias', revision: 1, module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href,
      exportName: 'judgeAlias' }
    const source: ReminderSource = { sourceId: 'native-alias', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'alias', on: 'session.event', when: { eventType: descriptor.name },
      text: 'CUSTOM_NATIVE_RESULT', judge: { ref: detector.ref, revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] }
    const seed = await harness.capture(t)
    const cold = await harness.open(t, seed)
    const dispose = cold.runtime.registerCustomEvents([descriptor])
    t.after(dispose)
    cold.runtime.registerDetector(detector)
    cold.runtime.registerSource(source)
    const input = { sessionId: String(seed.header.id), visible: [] }
    const native = seed.events.find(event => event.type === 'tool/result')
    const call = seed.events.find(event => event.type === 'tool/call')
    assert.ok(native && call)
    await assert.rejects(cold.runtime.publishCustomEvent({ sessionId: input.sessionId, name: descriptor.name }), /需要原生/)
    await assert.rejects(cold.runtime.publishCustomEvent({ sessionId: input.sessionId, name: descriptor.name,
      native: { type: 'session-event', seq: call.seq } }), /与原生事件不匹配/)
    await assert.rejects(cold.runtime.publishCustomEvent({ sessionId: input.sessionId, name: descriptor.name,
      native: { type: 'session-event', seq: seed.events.length } }), /session-event-not-found/)
    await cold.runtime.publishCustomEvent({ sessionId: input.sessionId, name: descriptor.name,
      native: { type: 'session-event', seq: native.seq }, eventId: 'FORGED_ALIAS_ID', at: 0, facts: { forged: true } })
    const messages = await cold.runtime.collect(input)
    assert.deepEqual(messages.map(message => message.content[0].text), ['CUSTOM_NATIVE_RESULT'])
    const trace = messages[0].source.contextCareTrace
    assert.equal(trace.native?.type, 'session-event')
    assert.equal(typeof trace.native?.seq, 'number')
    assert.equal(trace.callId, `care/native-tool-result#${trace.native?.seq}`)
    const observations = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeAliasObservation.parse(JSON.parse(line)))
    assert.equal(observations.length, 1, 'public publish and cold discovery share the canonical alias identity')
    assert.equal(observations[0].event.name, descriptor.name)
    assert.equal(observations[0].event.origin, 'tool')
    assert.deepEqual(observations[0].event.arguments, native.data)
    assert.equal(observations[0].event.clock.at, native.time)
    assert.equal(observations[0].event.callId, trace.callId)
    const empty = await harness.open(t, seed)
    empty.runtime.registerCustomEvents([descriptor]); empty.runtime.registerDetector(detector); empty.runtime.registerSource(source)
    const rebuilt = await empty.runtime.collect(input)
    assert.deepEqual(rebuilt.map(message => message.content[0].text), ['CUSTOM_NATIVE_RESULT'])
    assert.equal((await readFile(tracePath, 'utf8')).trim().split('\n').length, 2, 'empty-cache replay invokes its actual Worker from the same native input')
    assert.equal(empty.sideWriteCount(), 0)
    assert.equal(cold.sideWriteCount(), 0, 'the native alias is reconstructible and needs no candidate write')
    assert.equal(cold.liveCount(), 0)
    assert.deepEqual(await cold.runtime.collect(input), [], 'the in-memory recovery cache still deduplicates the same native fact')
    dispose()
    t.after(cold.runtime.registerCustomEvents([{ ...descriptor, nativeEvent: 'tool/call' }]))
    assert.deepEqual(await cold.runtime.filterMessages(input.sessionId, [], messages), [], 'rebinding invalidates a reserved body even with the same source token')
    const rebound = await cold.runtime.collect(input)
    assert.equal(rebound.length, 1)
    assert.equal(rebound[0].source.contextCareTrace.native?.seq, call.seq)
    const changed = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeAliasObservation.parse(JSON.parse(line)))
    assert.equal(changed.length, 3)
    assert.deepEqual(changed[2].event.arguments, call.data)
    assert.equal(cold.sideWriteCount(), 0)
  })
  for (const late of [false, true]) test(`a ${late ? 'late-registered' : 'live'} custom event alias handoff prevents a second Worker judge after native replay`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'care-native-alias-handoff-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'live-alias-worker.jsonl')
    const descriptor: CustomEventDescriptor = { name: 'care/native-human-input', nativeEvent: 'user/message' }
    const detector = { ref: 'native-alias-handoff', revision: 1,
      module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href, exportName: 'judgeAlias' }
    const source: ReminderSource = { sourceId: 'native-alias-handoff', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'alias', on: 'session.event', when: { eventType: descriptor.name,
        condition: { kind: 'compare', field: 'event.arguments.source.kind', op: 'eq', value: 'user' } },
      text: 'NATIVE_ALIAS_HUMAN', judge: { ref: detector.ref, revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] }
    const seed = await harness.captureAlias(t, descriptor, source, detector, late)
    const native = seed.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.ok(native)
    const observations = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeAliasObservation.parse(JSON.parse(line)))
    assert.equal(observations.length, 1)
    assert.equal(observations[0].event.name, descriptor.name)
    assert.equal(observations[0].event.origin, 'human')
    assert.deepEqual(observations[0].event.arguments, native.data)
    assert.equal(observations[0].event.clock.at, native.time)
    const cold = await harness.open(t, seed)
    cold.runtime.registerCustomEvents([descriptor]); cold.runtime.registerDetector(detector); cold.runtime.registerSource(source)
    const input = { sessionId: String(seed.header.id), visible: [] }
    assert.deepEqual(await cold.runtime.collect(input), [])
    assert.deepEqual(await cold.runtime.collect(input), [])
    assert.equal((await readFile(tracePath, 'utf8')).trim().split('\n').length, 1, 'native handoff prevents every duplicate independent judge')
    assert.equal(cold.sideWriteCount(), 0)
    assert.equal(cold.liveCount(), 0)
  })
  test('legacy seen cache cannot suppress an unhanded native tool trigger in a new Host', async t => {
    const seed = await harness.capture(t), callId = 'native-prefix-call'
    const cold = await harness.open(t, seed, [JSON.stringify(['tool.succeeded', callId])])
    const root = await mkdtemp(join(tmpdir(), 'care-native-seen-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'actual-judge.jsonl')
    cold.runtime.registerDetector({ ref: 'native-after', revision: 1,
      module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href })
    cold.runtime.registerSource({ sourceId: 'native-seen', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'after', on: 'tool.succeeded', when: { tool: 'native_prefix_probe' },
      text: 'AFTER {{event.arguments.file_path}}', judge: { ref: 'native-after', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] })
    const input = { sessionId: String(seed.header.id), visible: [] }
    const messages = await cold.runtime.collect(input)
    assert.deepEqual(messages.map(message => message.content[0].text), ['AFTER original.ts'])
    await cold.runtime.collect(input)
    const observations = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeObservation.parse(JSON.parse(line)))
    assert.equal(observations.length, 1, 'same-process repeat collection still shares its ephemeral seen cache')
    assert.ok(observations[0].threadId > 0)
    assert.deepEqual(await cold.storedSeen(), [JSON.stringify(['tool.succeeded', callId])], 'the untouched legacy file has no authority over native reconstruction')
    assert.equal(cold.sideWriteCount(), 0, 'native reconstruction needs no clearing or candidate write')
    assert.equal(cold.liveCount(), 0)
  })
  test('an obsolete reserved candidate cannot override a native tool replay or require a clearing write', async t => {
    const seed = await harness.capture(t), first = await harness.open(t, seed)
    const root = await mkdtemp(join(tmpdir(), 'care-native-candidate-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'native-cache-authority.jsonl')
    const source = { sourceId: 'native-cache-authority', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'actual', on: 'tool.succeeded', when: { tool: 'native_prefix_probe' },
      text: 'NATIVE {{event.arguments.file_path}}', judge: { ref: 'native-cache', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] }
    function configure(runtime: ReminderService) {
      runtime.registerDetector({ ref: 'native-cache', revision: 1,
        module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href })
      runtime.registerSource(source)
    }
    configure(first.runtime)
    const input = { sessionId: String(seed.header.id), visible: [] }
    assert.deepEqual((await first.runtime.collect(input)).map(message => message.content[0].text), ['NATIVE original.ts'])
    const original = first.runtime.snapshot(input.sessionId).candidates[0]
    assert.ok(original?.native, 'the original candidate came from an actual Worker and native trigger')
    const obsolete = structuredClone(original)
    delete obsolete.native
    obsolete.text = 'STALE SIDE BODY'
    obsolete.rendered = true
    obsolete.status = 'reserved'
    obsolete.messageId = 'uncommitted-side-reservation'
    // Only the disposable legacy cache is corrupted. The actual Session log
    // has no receipt for this reservation and remains byte-for-byte unchanged.
    const cold = await harness.open(t, seed, [], [obsolete])
    configure(cold.runtime)
    const restored = await cold.runtime.collect(input)
    assert.deepEqual(restored.map(message => message.content[0].text), ['NATIVE original.ts'])
    assert.equal(cold.runtime.snapshot(input.sessionId).candidates.some(candidate => candidate.id === obsolete.id), false)
    assert.deepEqual(await cold.storedCandidates(), [obsolete], 'reconstruction does not need to clear the obsolete file')
    assert.equal(cold.sideWriteCount(), 0)
    const observed = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeObservation.parse(JSON.parse(line)))
    assert.equal(observed.length, 2, 'each fresh Host evaluates the unhanded native fact in a real Worker')
    assert.ok(observed.every(value => value.threadId > 0 && value.event.arguments.file_path === 'original.ts'))
    assert.equal(cold.liveCount(), 0)
  })
  for (const partial of [false, true]) test(`native tool ${partial ? 'partial' : 'complete'} handoff suppresses only committed rules and exclusive choices`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'care-native-rule-handoff-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'actual-rule-judges.jsonl')
    const detector = { ref: 'native-handoff', revision: 1,
      module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href }
    const source: ReminderSource = { sourceId: 'native-rule-handoff', plugin: 'test', revision: 1,
      rules: ['first', 'second', 'choice', 'suppressed'].map((id, index) => ({
        format: 'reminder/v4', id, on: 'tool.succeeded', priority: 10 - index,
        ...(index >= 2 ? { exclusiveGroup: 'native-choice' } : {}),
        when: { tool: 'native_prefix_probe' }, text: `${id} {{event.arguments.file_path}}`,
        judge: { ref: detector.ref, revision: 1, params: { tracePath } },
        effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
      })) }
    const seed = await harness.capture(t, false, false, false, undefined, {
      source, detector, handoffRules: partial ? ['first', 'choice'] : ['first', 'second', 'choice'],
    })
    const live = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeObservation.parse(JSON.parse(line)))
    assert.equal(live.length, 3, 'only the three live winners actually invoke their Worker judges')
    const cold = await harness.open(t, seed)
    cold.runtime.registerDetector(detector)
    cold.runtime.registerSource(source)
    const input = { sessionId: String(seed.header.id), visible: [] }
    const messages = await cold.runtime.collect(input)
    assert.deepEqual(messages.map(message => message.content[0].text), partial ? ['second original.ts'] : [])
    const observed = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeObservation.parse(JSON.parse(line)))
    assert.equal(observed.length, live.length + (partial ? 1 : 0), 'native receipts avoid a second judge for handed rules and their suppressed exclusive alternative')
    assert.deepEqual(await cold.runtime.collect(input), [])
    assert.equal((await readFile(tracePath, 'utf8')).trim().split('\n').length, observed.length)
    assert.ok(observed.every(value => value.threadId > 0))
    assert.equal(cold.sideWriteCount(), 0)
    assert.equal(cold.liveCount(), 0)
  })
  test('native PTC presentation collapse leaves no pre-execution hook or reminder', async t => {
    const seed = await harness.capture(t, false, false, true)
    const terminal = seed.events.find(event => event.type === 'tool/result'
      && String(event.data.message.toolCallId) === 'native-prefix-call')
    assert.ok(terminal && terminal.type === 'tool/result')
    assert.equal(terminal.data.error?.code, 'UNKNOWN_TOOL')
    assert.match(terminal.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
      /only `run_code` is callable directly/)
    const call = seed.events.find(event => event.type === 'tool/call' && event.data.name === 'native_prefix_probe')
    assert.ok(call && call.type === 'tool/call')
    const cold = await harness.open(t, seed), sessionId = String(seed.header.id)
    cold.runtime.registerSource({ sourceId: 'native-collapse', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'before', on: 'tool.before-execute', when: { tool: 'native_prefix_probe' }, text: 'UNREACHED BEFORE',
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }, { format: 'reminder/v4', id: 'failure', on: 'tool.failed', when: { tool: 'native_prefix_probe', error: { code: 'UNKNOWN_TOOL' } },
      text: 'FAILED {{event.arguments.file_path}}', effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] })
    const messages = await cold.runtime.collect({ sessionId, visible: [] })
    assert.deepEqual(messages.map(message => message.content[0].text), ['FAILED original.ts'])
    await assert.rejects(cold.runtime.submit({ type: 'tool.before-execute', sessionId, callId: 'forged', rootCallId: 'forged',
      name: 'native_prefix_probe', arguments: {}, native: { type: 'tool-call', seq: call.seq }, clock: { at: 0 } }),
    /reminder-native-tool-call-not-dispatched/)
    assert.equal(cold.liveCount(), 0)
  })
  test('native cancelled tool preserves its completed before-execution handoff across restart', async t => {
    const seed = await harness.capture(t, true, true), cold = await harness.open(t, seed)
    const result = seed.events.find(event => event.type === 'tool/result'
      && String(event.data.message.toolCallId) === 'native-prefix-call')
    assert.ok(result && result.type === 'tool/result')
    assert.equal(result.data.error?.code, 'ABORTED_BEFORE_DISPATCH')
    assert.ok(seed.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder'))
    const root = await mkdtemp(join(tmpdir(), 'care-native-cancelled-before-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'unexpected-judge.jsonl')
    cold.runtime.registerDetector({ ref: 'native-before', revision: 1,
      module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href, exportName: 'judgeBefore' })
    cold.runtime.registerSource({ sourceId: 'native-phases', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'before', on: 'tool.before-execute', when: { tool: 'native_prefix_probe' },
      text: 'BEFORE {{event.arguments.file_path}}', judge: { ref: 'native-before', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] })
    assert.deepEqual(await cold.runtime.collect({ sessionId: String(seed.header.id), visible: [] }), [])
    await assert.rejects(readFile(tracePath, 'utf8'), /ENOENT/, 'native receipt prevents a second judge')
    assert.equal(cold.liveCount(), 0)
  })
  test('native before-execution handoff suppresses its own judge and preserves the later outcome after restart', async t => {
    const seed = await harness.capture(t, true), cold = await harness.open(t, seed), runtime = cold.runtime
    assert.ok(seed.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder'), 'the first real Host committed the before-execution reminder')
    const root = await mkdtemp(join(tmpdir(), 'care-native-before-handoff-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'cold-worker.jsonl'), module = new URL('./fixtures/reminder-native-context.ts', import.meta.url).href
    runtime.registerDetector({ ref: 'native-before', revision: 1, module, exportName: 'judgeBefore' })
    runtime.registerDetector({ ref: 'native-after', revision: 1, module })
    runtime.registerSource({ sourceId: 'native-phases', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'before', on: 'tool.before-execute', when: { tool: 'native_prefix_probe' },
      text: 'BEFORE {{event.arguments.file_path}}', judge: { ref: 'native-before', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }, { format: 'reminder/v4', id: 'after', on: 'tool.succeeded', when: { tool: 'native_prefix_probe' },
      text: 'AFTER {{event.arguments.file_path}}', judge: { ref: 'native-after', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] })
    const messages = await runtime.collect({ sessionId: String(seed.header.id), visible: [] })
    assert.deepEqual(messages.map(message => message.content[0].text), ['AFTER original.ts'])
    const observations = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeObservation.parse(JSON.parse(line)))
    assert.equal(observations.length, 1, 'native before handoff skips only its own phase and never calls its judge again')
    assert.ok(observations[0].threadId > 0)
    assert.equal(observations[0].event.callId, 'native-prefix-call')
    assert.equal(cold.liveCount(), 0)
  })
  for (const deny of [false, true]) test(`native before-execution ${deny ? 'denial reminder' : 'reminder'} replays without suppressing its tool outcome`, async t => {
    const seed = await harness.capture(t), cold = await harness.open(t, seed), runtime = cold.runtime
    const call = seed.events.find(event => event.type === 'tool/call' && String(event.data.callId) === 'native-prefix-call')
    assert.ok(call && call.type === 'tool/call')
    const root = await mkdtemp(join(tmpdir(), 'care-native-before-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'phases.jsonl'), module = new URL('./fixtures/reminder-native-context.ts', import.meta.url).href
    runtime.registerDetector({ ref: 'native-before', revision: 1, module, exportName: 'judgeBefore' })
    runtime.registerDetector({ ref: 'native-after', revision: 1, module })
    runtime.registerSource({ sourceId: 'native-phases', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'before', on: 'tool.before-execute', when: { tool: 'native_prefix_probe' },
      text: 'BEFORE {{event.arguments.file_path}}', judge: { ref: 'native-before', revision: 1, params: { tracePath } },
      effect: deny ? { kind: 'deny-tool', dangerous: true, reason: 'Historical policy must not execute again',
        deliver: { model: { once: 'surface' } } } : { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }, { format: 'reminder/v4', id: 'after', on: 'tool.succeeded', when: { tool: 'native_prefix_probe' },
      text: 'AFTER {{event.arguments.file_path}}', judge: { ref: 'native-after', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] })
    const messages = await runtime.collect({ sessionId: String(seed.header.id), visible: [] })
    assert.deepEqual(messages.map(message => message.content[0].text).sort(), ['AFTER original.ts', 'BEFORE original.ts'])
    await runtime.submit({ type: 'tool.before-execute', sessionId: String(seed.header.id), callId: 'forged', rootCallId: 'forged',
      name: 'wrong', arguments: { file_path: 'forged.ts' }, clock: { at: 0 }, native: { type: 'tool-call', seq: call.seq } })
    const observations = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as unknown)
    assert.equal(observations.length, 2, 'one judge per trigger phase, even though both share the real call id')
    const before = NativeBeforeObservation.parse(observations[0]), after = NativeObservation.parse(observations[1])
    assert.ok(before.threadId > 0 && after.threadId > 0)
    assert.equal(before.event.clock.at, call.time)
    assert.equal(before.event.native.seq, call.seq)
    assert.equal(before.event.callId, after.event.callId)
    assert.equal(cold.liveCount(), 0, 'recovery never starts a tool body or creates an Agent execution token')
  })
  test('native Session event cold discovery restores its actual payload identity time and source', async t => {
    const seed = await harness.capture(t), cold = await harness.open(t, seed), runtime = cold.runtime
    const terminal = seed.events.find(event => event.type === 'tool/result'
      && String(event.data.message.toolCallId) === 'native-prefix-call')
    assert.ok(terminal && terminal.type === 'tool/result')
    const root = await mkdtemp(join(tmpdir(), 'care-native-session-event-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'native-session-worker.jsonl')
    runtime.registerDetector({ ref: 'native-session-event', revision: 1,
      module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href, exportName: 'judgeSessionEvent' })
    runtime.registerSource({ sourceId: 'native-session-rule', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'actual-event', on: 'session.event', when: { eventType: 'tool/result' },
      text: 'SESSION {{event.arguments.message.toolCallId}}',
      judge: { ref: 'native-session-event', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] })
    const messages = await runtime.collect({ sessionId: String(seed.header.id), visible: [] })
    assert.equal(messages.length, 1, JSON.stringify(runtime.snapshot(String(seed.header.id))))
    assert.deepEqual(messages[0].content, [{ type: 'text', text: 'SESSION native-prefix-call' }])
    assert.deepEqual(messages[0].source.contextCareTrace.native, { type: 'session-event', seq: terminal.seq })
    assert.equal(cold.sideWriteCount(), 0, 'native Session-event detection and reservation have no candidate JSON write')
    assert.deepEqual(await cold.storedCandidates(), [])
    await runtime.submit({ type: 'session.event', sessionId: String(seed.header.id), callId: 'forged', rootCallId: 'forged',
      name: 'user/message', arguments: { forged: true }, origin: 'human', clock: { at: 0 },
      native: { type: 'session-event', seq: terminal.seq } })
    const observations = (await readFile(tracePath, 'utf8')).trim().split('\n')
      .map(line => NativeSessionObservation.parse(JSON.parse(line)))
    assert.equal(observations.length, 1, 'the canonical event id suppresses a second judge after forged resubmission')
    const [observation] = observations
    assert.ok(observation.threadId > 0)
    assert.equal(observation.event.callId, `tool/result#${terminal.seq}`)
    assert.equal(observation.event.rootCallId, observation.event.callId)
    assert.deepEqual(observation.event.arguments, terminal.data)
    assert.equal(observation.event.clock.at, terminal.time)
    assert.equal(observation.event.native.seq, terminal.seq)
    assert.equal(cold.liveCount(), 0, 'native event discovery and evaluation never activate the dormant Agent')
    await assert.rejects(runtime.submit({ sessionId: String(seed.header.id), callId: 'invalid', rootCallId: 'invalid',
      native: { type: 'session-event', seq: seed.events.length } }), /native-session-event-not-found/)
  })
  for (const automatic of [false, true]) test(`native tool trigger cold replay ${automatic ? 'automatically discovers' : 'explicitly restores'} historical inputs from a dormant JSONL Session`, async t => {
    const seed = await harness.capture(t), cold = await harness.open(t, seed)
    const terminal = seed.events.find(event => event.type === 'tool/result'
      && String(event.data.message.toolCallId) === 'native-prefix-call')
    assert.ok(terminal && terminal.type === 'tool/result')
    const root = await mkdtemp(join(tmpdir(), 'care-native-trigger-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const tracePath = join(root, 'worker-observation.jsonl'), runtime = cold.runtime
    runtime.registerDetector({ ref: 'native-context', revision: 1,
      module: new URL('./fixtures/reminder-native-context.ts', import.meta.url).href })
    runtime.registerSource({ sourceId: 'native-prefix-rule', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'historical', on: 'tool.succeeded', when: { tool: 'native_prefix_probe' },
      text: 'CANONICAL {{event.arguments.file_path}}', judge: { ref: 'native-context', revision: 1, params: { tracePath } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] })
    assert.equal(cold.liveCount(), 0)
    const copied = { type: 'tool.failed', sessionId: String(seed.header.id), callId: 'forged-call',
      rootCallId: 'forged-root', name: 'wrong-tool', arguments: { file_path: 'forged.ts' },
      clock: { at: 0 }, context: { messages: [], truncated: false },
      native: { type: 'tool-result', seq: terminal.seq } }
    if (!automatic) await runtime.submit(copied)
    const collect = () => runtime.collect({ sessionId: String(seed.header.id), visible: [] })
    const messages = automatic ? (await Promise.all([collect(), collect()])).flat() : await collect()
    assert.equal(messages.length, 1, JSON.stringify(runtime.snapshot(String(seed.header.id))))
    assert.equal(messages[0].content[0].text, 'CANONICAL original.ts')
    assert.deepEqual(messages[0].source.contextCareTrace.native, { type: 'tool-result', seq: terminal.seq })
    assert.equal(cold.sideWriteCount(), 0, 'native tool reconstruction and reservation bypass the candidate JSON writer')
    assert.deepEqual(await cold.storedCandidates(), [])
    await runtime.submit({ ...copied, callId: 'another-forged-call' })
    const observations = (await readFile(tracePath, 'utf8')).trim().split('\n')
      .map(line => { const value: unknown = JSON.parse(line); return NativeObservation.parse(value) })
    assert.equal(observations.length, 1, 'canonical call identity prevents a second judge invocation')
    const [observation] = observations
    assert.ok(observation.threadId > 0, 'the production matcher evaluated a real Worker')
    assert.equal(observation.event.callId, 'native-prefix-call')
    assert.equal(observation.event.rootCallId, 'native-prefix-call')
    assert.equal(observation.event.name, 'native_prefix_probe')
    assert.deepEqual(observation.event.arguments, { file_path: 'original.ts' })
    assert.equal(observation.event.clock.at, terminal.time)
    const context = observation.event.context.messages.map(message => message.text).join('\n')
    assert.match(context, /EARLY_CONTEXT/)
    assert.doesNotMatch(context, /LATE_CONTEXT|CURRENT_RESULT/)
    assert.equal(cold.liveCount(), 0, 'query and native prefix preparation never activate an Agent')
    await assert.rejects(runtime.submit({ ...copied, native: { type: 'tool-result', seq: seed.events.length } }), /result-not-found/)
  })
}
