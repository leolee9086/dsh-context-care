import test, { type TestContext } from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ReminderSource } from '../lib/reminder-runtime/runtime.js'
import { readTrace } from './fixtures/reminder-execution-real.ts'

interface Seed {
  id: SessionId; events: SessionEvent[]; inheritedEventCount?: SessionLogOffset
  meta?: { isSeeded?: boolean; parentSession?: SessionId }
}
interface Host {
  turn(human?: boolean, count?: number): Promise<void>
  trigger(id: string, marker: string): Promise<void>
  queueReminder(): Promise<void>
  seed(): Promise<Seed>
  notices(): Promise<string[]>
  hideNotice(): Promise<void>
  storedDerived(): Promise<{ windows: number; stickies: number }>
  activeStickies(): number
  setModelEnabled(enabled: boolean): Promise<void>
  snooze(): Promise<void>
  collectOnly(): Promise<number>
  reserveElsewhere(): Promise<() => Promise<void>>
  cancelQueued(): void
  humanTurn(): Promise<string>
  historyReadCount(): number
  stateWriteCount(): number
}
interface Harness {
  open(t: TestContext, source: ReminderSource, seed?: Seed, fork?: boolean,
    detector?: { ref: string; revision: number; module: string; exportName: string }): Promise<Host>
}
const stickySource = (clock: 'main-request' | 'human-turn'): ReminderSource => ({
  sourceId: 'replayed-sticky', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'sticky', event: { tool: 'replay_probe' } }, { template: 'FROZEN {{event.arguments.marker}}', delivery: { model: { once: 'none',
      sticky: { clock, lifetime: clock === 'main-request' ? 3 : 2, cooldown: clock === 'main-request' ? 2 : 0 }, shared: { reset: 'lifetime', lifetime: 'replay', limit: 2 } } } })],
})

/** The fixture owns actual Loader, Worker, Agent and Session implementations. */
export function registerDeliveryReplayCases(harness: Harness) {
  test('Session-only idle collection ignores historical triggers and avoids query reads and empty writes', async t => {
    const source: ReminderSource = { sourceId: 'idle-source', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'idle', event: { tool: 'replay_probe' } }, { template: 'IDLE_NOTICE' })] }
    const hot = await harness.open(t, source)
    await hot.turn()
    const cold = await harness.open(t, source, await hot.seed())
    const foreign = await harness.open(t, { ...stickySource('main-request'), scope: { sessionIds: ['unrelated-session'] } })
    const disabled = await harness.open(t, stickySource('main-request'))
    await disabled.setModelEnabled(false)
    const coldReads = cold.historyReadCount(), coldWrites = cold.stateWriteCount()
    assert.equal(await cold.collectOnly(), 0)
    assert.equal(cold.historyReadCount(), coldReads, 'the attached Session supplies native input facts without a duplicate query')
    assert.equal(cold.stateWriteCount(), coldWrites, 'empty discovery does not write side state')
    for (const host of [hot, cold, foreign, disabled]) {
      const reads = host.historyReadCount(), writes = host.stateWriteCount()
      for (let round = 0; round < 3; round++) assert.equal(await host.collectOnly(), 0)
      assert.equal(host.historyReadCount(), reads, 'observed, recovered, foreign and disabled Sessions need no repeated scan')
      assert.equal(host.stateWriteCount(), writes, 'do not persist unchanged empty runtime state')
    }
  })

  test('Session-only pending inbox handoff recovers a frozen candidate without reminder side files', async t => {
    const source = stickySource('human-turn'), hot = await harness.open(t, source)
    await hot.trigger('queued-hit', 'original-body')
    await hot.queueReminder()
    const seed = await hot.seed()
    assert.ok(seed.events.some(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'plugin:dsh-context-care:reminder')))
    assert.equal(seed.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder'), false)
    const cold = await harness.open(t, source, seed)
    await cold.turn()
    assert.deepEqual(await cold.notices(), ['FROZEN original-body'])
    await cold.turn()
    assert.deepEqual(await cold.notices(), ['FROZEN original-body', 'FROZEN original-body'])
    assert.equal(cold.stateWriteCount(), 0, 'the actual inbox handoff and its sticky continuation need no candidate copy')
    const resumed = await harness.open(t, source, await cold.seed())
    await resumed.turn(false)
    assert.deepEqual(await resumed.notices(), ['FROZEN original-body', 'FROZEN original-body'])
    assert.equal(resumed.stateWriteCount(), 0)
  })

  test('Session-only pending inbox handoff does not repeat a real Worker judge after restart', async t => {
    const root = await mkdtemp(join(tmpdir(), 'care-inbox-judge-')), tracePath = join(root, 'judge.jsonl')
    t.after(() => rm(root, { recursive: true, force: true }))
    const detector = { ref: 'inbox-replay-judge', revision: 1,
      module: new URL('./fixtures/reminder-execution-real.ts', import.meta.url).href, exportName: 'judge' }
    const base = stickySource('human-turn')
    const source: ReminderSource = { ...base, rules: base.rules.map(rule => ({ ...rule, judge: {
      ref: detector.ref, revision: 1, params: { label: 'one-match', tracePath, mode: 'quick', ok: true, value: 'frozen-result' },
    } })) }
    const hot = await harness.open(t, source, undefined, false, detector)
    await hot.trigger('judged-trigger', 'judged-body')
    await hot.queueReminder()
    assert.equal(readTrace(tracePath).filter(item => item.phase === 'start').length, 1)
    // No detector is installed on the new Host. Its actual inbox message already
    // contains the accepted match and must not ask a new Worker to decide again.
    const seed = await hot.seed(), cold = await harness.open(t, source, seed)
    await cold.turn()
    assert.deepEqual(await cold.notices(), ['FROZEN judged-body'])
    assert.equal(readTrace(tracePath).filter(item => item.phase === 'start').length, 1)
    const duplicate = await harness.open(t, source, seed, false, detector)
    await duplicate.trigger('judged-trigger', 'must-not-replace-original')
    const reads = duplicate.historyReadCount()
    await duplicate.trigger('judged-trigger', 'second-duplicate')
    assert.equal(duplicate.historyReadCount(), reads, 'unchanged native log reuses its trigger projection')
    assert.equal(duplicate.stateWriteCount(), 0, 'known native handoff skips admission side writes')
    assert.equal(readTrace(tracePath).filter(item => item.phase === 'start').length, 1)
    await duplicate.turn()
    assert.deepEqual(await duplicate.notices(), ['FROZEN judged-body'])
    await cold.hideNotice()
    const compacted = await harness.open(t, source, await cold.seed(), false, detector)
    await compacted.trigger('judged-trigger', 'hidden-surface-duplicate')
    assert.equal(compacted.stateWriteCount(), 0)
    assert.equal(readTrace(tracePath).filter(item => item.phase === 'start').length, 1,
      'a committed handoff remains a seen trigger after its message leaves the surface')
  })

  test('Session-only pending inbox handoff refuses an obsolete control generation after reenable', async t => {
    const source = stickySource('human-turn'), hot = await harness.open(t, source)
    await hot.trigger('old-control-hit', 'old-policy-body')
    await hot.queueReminder()
    const cold = await harness.open(t, source, await hot.seed())
    await cold.setModelEnabled(false)
    await cold.setModelEnabled(true)
    await cold.turn()
    assert.deepEqual(await cold.notices(), [], 'reenabling a rule does not revive an earlier inbox generation')
  })

  test('Session-only pending inbox handoff refuses a changed rule definition', async t => {
    const source = stickySource('human-turn'), hot = await harness.open(t, source)
    await hot.trigger('old-definition-hit', 'old-body')
    await hot.queueReminder()
    const changed = { ...source, revision: 2, rules: source.rules.map(rule => ({ ...rule, actions: rule.actions.map(action => ({ ...action, template: 'CHANGED {{event.arguments.marker}}' })) })) }
    const cold = await harness.open(t, changed, await hot.seed())
    await cold.turn()
    assert.deepEqual(await cold.notices(), [], 'a new registration must not authorize an old pending body')
  })

  test('Session-only interrupt clock shares cold reads and follows native human arrivals incrementally', async t => {
    const source: ReminderSource = { sourceId: 'clock-only', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'idle', event: { tool: 'replay_probe' } }, { template: 'IDLE_NOTICE' })] }
    const hot = await harness.open(t, source), before = hot.historyReadCount()
    assert.deepEqual(await Promise.all([hot.humanTurn(), hot.humanTurn()]), ['initial', 'initial'])
    assert.equal(hot.historyReadCount() - before, 0, 'concurrent readers reuse the attached native Session')
    await hot.turn()
    const reads = hot.historyReadCount(), first = await hot.humanTurn()
    assert.notEqual(first, 'initial')
    assert.equal(hot.historyReadCount(), reads, 'live commits already advanced the projection')
    for (let round = 0; round < 2; round++) {
      await hot.turn(false)
      const currentReads = hot.historyReadCount()
      assert.equal(await hot.humanTurn(), first, 'automatic continuation does not reset the interrupt budget')
      assert.equal(hot.historyReadCount(), currentReads)
    }
    const cold = await harness.open(t, source, await hot.seed()), coldReads = cold.historyReadCount()
    assert.deepEqual(await Promise.all([cold.humanTurn(), cold.humanTurn()]), [first, first])
    assert.equal(cold.historyReadCount() - coldReads, 0, 'a replayed but attached Session needs no duplicate query')
    await cold.turn()
    const nextReads = cold.historyReadCount()
    assert.notEqual(await cold.humanTurn(), first)
    assert.equal(cold.historyReadCount(), nextReads)
  })

  test('Session-only fork replay keeps parent context without inheriting local clocks or sticky activations', async t => {
    const source = stickySource('human-turn'), parent = await harness.open(t, source)
    await parent.trigger('parent-hit', 'parent-body'); await parent.turn()
    const child = await harness.open(t, source, await parent.seed(), true)
    assert.equal(await child.humanTurn(), 'initial', 'parent arrivals do not reset a child interrupt budget')
    await child.turn(false)
    assert.deepEqual(await child.notices(), ['FROZEN parent-body'])
    assert.equal(child.activeStickies(), 0, 'inherited reminders are context, not child activations')
    const cold = await harness.open(t, source, await child.seed())
    assert.equal(await cold.humanTurn(), 'initial', 'the inherited prefix survives another cold restore')
    await cold.trigger('child-hit', 'child-body'); await cold.turn()
    assert.notEqual(await cold.humanTurn(), 'initial')
    assert.deepEqual(await cold.notices(), ['FROZEN parent-body', 'FROZEN child-body'])
    await cold.turn()
    assert.deepEqual(await cold.notices(), ['FROZEN parent-body', 'FROZEN child-body', 'FROZEN child-body'])
  })

  test('Session-only sticky replay preserves frozen bodies lifetime cooldown and one shared charge', async t => {
    const source = stickySource('main-request'), hot = await harness.open(t, source)
    await hot.trigger('initial', 'initial-body'); await hot.turn()
    const cold = await harness.open(t, source, await hot.seed())
    assert.deepEqual(await cold.storedDerived(), { windows: 0, stickies: 0 })
    await hot.trigger('repeat', 'must-not-extend'); await cold.trigger('repeat', 'must-not-extend')
    for (const expected of [2, 3, 3, 3, 3]) {
      await hot.turn(); await cold.turn()
      assert.deepEqual(await cold.notices(), await hot.notices())
      assert.deepEqual(await cold.notices(), Array.from({ length: expected }, () => 'FROZEN initial-body'))
    }
    assert.equal(hot.activeStickies(), 0); assert.equal(cold.activeStickies(), 0)
    await hot.trigger('new-activation', 'new-body'); await cold.trigger('new-activation', 'new-body')
    await hot.turn(); await cold.turn()
    assert.deepEqual(await cold.notices(), ['FROZEN initial-body', 'FROZEN initial-body', 'FROZEN initial-body', 'FROZEN new-body'])
    assert.deepEqual(await cold.notices(), await hot.notices())
    assert.deepEqual(await hot.storedDerived(), { windows: 0, stickies: 0 })
    assert.deepEqual(await cold.storedDerived(), { windows: 0, stickies: 0 })
  })

  test('Session-only human-turn sticky replay ignores nonhuman continuation requests', async t => {
    const source = stickySource('human-turn'), hot = await harness.open(t, source)
    await hot.trigger('initial', 'human-clock'); await hot.turn()
    const hotWrites = hot.stateWriteCount()
    const cold = await harness.open(t, source, await hot.seed())
    for (let step = 0; step < 2; step++) {
      await hot.turn(false); await cold.turn(false)
      assert.deepEqual(await hot.notices(), ['FROZEN human-clock'])
      assert.deepEqual(await cold.notices(), await hot.notices())
    }
    await hot.turn(); await cold.turn()
    assert.deepEqual(await cold.notices(), ['FROZEN human-clock', 'FROZEN human-clock'])
    assert.deepEqual(await cold.notices(), await hot.notices())
    assert.equal(hot.stateWriteCount(), hotWrites, 'sticky ticks derive from native reminder messages')
    await hot.turn(); await cold.turn()
    assert.equal(hot.activeStickies(), 0); assert.equal(cold.activeStickies(), 0)
    assert.equal(cold.stateWriteCount(), 0, 'cold sticky recovery and cooldown do not write a side ledger')
  })

  test('Session-only human cooldown counts one tick for a batch of accepted messages', async t => {
    const source: ReminderSource = { sourceId: 'human-batch', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'batch', event: { tool: 'replay_probe' } }, { template: 'HUMAN_BATCH', delivery: { model: { once: 'none', sticky: { clock: 'human-turn', lifetime: 1, cooldown: 2 } } } })] }
    const hot = await harness.open(t, source)
    await hot.trigger('initial', 'batch'); await hot.turn()
    const cold = await harness.open(t, source, await hot.seed())
    await hot.turn(true, 2); await cold.turn(true, 2)
    assert.equal(hot.activeStickies(), 1); assert.equal(cold.activeStickies(), 1)
    await hot.turn(); await cold.turn()
    assert.equal(hot.activeStickies(), 1); assert.equal(cold.activeStickies(), 1)
    await hot.turn(); await cold.turn()
    assert.equal(hot.activeStickies(), 0); assert.equal(cold.activeStickies(), 0)
    assert.deepEqual(await cold.notices(), ['HUMAN_BATCH'])
    assert.deepEqual(await cold.notices(), await hot.notices())
  })

  test('Session-only queued sticky starts human cooldown after its delivery request', async t => {
    const source: ReminderSource = { sourceId: 'human-queued', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'queued', event: { tool: 'replay_probe' } }, { template: 'QUEUED_STICKY', delivery: { model: { once: 'none', sticky: { clock: 'human-turn', lifetime: 1, cooldown: 2 } } } })] }
    const hot = await harness.open(t, source)
    await hot.trigger('initial', 'queued'); await hot.queueReminder(); await hot.turn()
    const seed = await hot.seed()
    const firstReminder = seed.events.findIndex(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder')
    const firstHuman = seed.events.findIndex(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.ok(firstReminder >= 0 && firstHuman > firstReminder, 'exercise the real reminder-before-human commit order')
    assert.equal(seed.events.slice(firstReminder + 1, firstHuman).some(event =>
      event.type === 'step/start' || event.type === 'step/end'), false, 'both inputs commit in the same native request')
    const cold = await harness.open(t, source, seed)
    for (const active of [1, 1, 0]) {
      await hot.turn(); await cold.turn()
      assert.equal(hot.activeStickies(), active); assert.equal(cold.activeStickies(), active)
    }
    assert.deepEqual(await cold.notices(), ['QUEUED_STICKY'])
    assert.deepEqual(await cold.notices(), await hot.notices())
  })

  test('Session-only explicit native cancellation removes queued matches in hot and cold Hosts', async t => {
    const source: ReminderSource = { sourceId: 'cancel-queued', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { event: { tool: 'replay_probe' } }, { template: 'CANCELED_NOTICE', delivery: { model: { once: 'surface', shared: { reset: 'lifetime', lifetime: 'one', limit: 1 } } } })] }
    const hot = await harness.open(t, source)
    await hot.trigger('cancel-hit', 'canceled'); await hot.queueReminder()
    hot.cancelQueued()
    const seed = await hot.seed()
    assert.ok(seed.events.some(event => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled'))
    const cold = await harness.open(t, source, seed)
    await hot.turn(); await cold.turn()
    assert.deepEqual(await hot.notices(), []); assert.deepEqual(await cold.notices(), [])
    await hot.trigger('fresh-hit', 'fresh'); await cold.trigger('fresh-hit', 'fresh')
    await hot.turn(); await cold.turn()
    assert.deepEqual(await hot.notices(), ['CANCELED_NOTICE'])
    assert.deepEqual(await cold.notices(), await hot.notices())
  })

  test('Session-only quota-blocked frozen match survives claim without waking or rejudging', async t => {
    const root = await mkdtemp(join(tmpdir(), 'care-queued-quota-')), tracePath = join(root, 'judge.jsonl')
    t.after(() => rm(root, { recursive: true, force: true }))
    const detector = { ref: 'queued-quota', revision: 1,
      module: new URL('./fixtures/reminder-execution-real.ts', import.meta.url).href, exportName: 'judge' }
    const source: ReminderSource = { sourceId: 'queued-quota', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { event: { tool: 'replay_probe' }, judge: { ref: detector.ref, revision: 1, params: { label: 'queued-quota', tracePath, mode: 'quick', ok: true, value: 'frozen' } } },
      { template: 'QUEUED {{event.arguments.marker}}', delivery: { model: { once: 'surface', shared: { reset: 'lifetime', lifetime: 'one', limit: 1 } } } })] }
    const hot = await harness.open(t, source, undefined, false, detector)
    const release = await hot.reserveElsewhere()
    await hot.trigger('quota-loser', 'original-body'); await hot.queueReminder()
    await hot.turn()
    assert.deepEqual(await hot.notices(), [], 'a claimed queued input cannot bypass the competing reservation')
    const before = await hot.seed()
    assert.equal(before.events.filter(event => event.type === 'request/header').length, 1,
      'quota blocking cannot inject another automatic model request')
    assert.equal(before.events.some(event => event.type === 'agent/inbox/spliced' && event.data.removedCount
      && event.data.outcome !== 'canceled'), true, 'exercise a real native claim before cold recovery')
    await release()
    const cold = await harness.open(t, source, before)
    await cold.turn(); await hot.turn()
    assert.deepEqual(await cold.notices(), ['QUEUED original-body'])
    assert.deepEqual(await hot.notices(), await cold.notices())
    assert.equal(readTrace(tracePath).filter(entry => entry.phase === 'start').length, 2,
      'only the original two actual matches run a Worker judge')
    const handed = before.events.find(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'plugin:dsh-context-care:reminder'))
    assert.ok(handed && handed.type === 'agent/inbox/spliced')
    const queuedId = handed.data.inserted.find(message => message.source.kind === 'plugin:dsh-context-care:reminder')?.id
    const delivered = (await cold.seed()).events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder')
    assert.ok(delivered && delivered.type === 'user/message')
    assert.equal(delivered.data.id, queuedId, 'claim recovery retains its original native input identity')
    assert.equal(delivered.data.source.kind, 'plugin:dsh-context-care:reminder')
    if (delivered.data.source.kind === 'plugin:dsh-context-care:reminder') {
      assert.equal(delivered.data.source.reminder.handoff?.queued, undefined)
    }
    assert.equal(hot.stateWriteCount() + cold.stateWriteCount(), 0)
  })

  test('Session-only snooze replay suppresses an undelivered window from its real tool result', async t => {
    const localTime = (time: number) => {
      const date = new Date(time)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
    const at = Date.now()
    const source: ReminderSource = { sourceId: 'snoozed-window', plugin: 'test', revision: 1, rules: [eventRule('request.before', { id: 'window', event: { timeWindow: { start: localTime(at - 3600000), end: localTime(at + 3600000) } } }, { template: 'SNOOZED_NOTICE', delivery: { model: { once: 'window' } } })] }
    const hot = await harness.open(t, source)
    // Pause delivery while the actual Agent calls the tool, then enable the rule.
    // There must be no reminder message from which to infer this suppression.
    await hot.setModelEnabled(false); await hot.snooze(); await hot.setModelEnabled(true)
    assert.deepEqual(await hot.notices(), [])
    const seed = await hot.seed()
    const result = seed.events.find(event => event.type === 'tool/result')
    assert.ok(result && result.type === 'tool/result')
    assert.equal(result.data.message.isError, false)
    assert.match(JSON.stringify(result.data), /context-care\/snooze\/v1/)
    const cold = await harness.open(t, source, seed)
    for (let round = 0; round < 2; round++) {
      await hot.turn(); await cold.turn()
      assert.deepEqual(await hot.notices(), [])
      assert.deepEqual(await cold.notices(), [])
    }
    assert.deepEqual(await hot.storedDerived(), { windows: 0, stickies: 0 })
    assert.deepEqual(await cold.storedDerived(), { windows: 0, stickies: 0 })
  })

  test('Session-only window replay remains suppressed after the delivered message leaves the surface', async t => {
    const at = Date.now(), localTime = (time: number) => {
      const date = new Date(time)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
    const source: ReminderSource = { sourceId: 'replayed-window', plugin: 'test', revision: 1, rules: [eventRule('request.before', { id: 'window', event: { timeWindow: { start: localTime(at - 3600000), end: localTime(at + 3600000) } } }, { template: 'ONE_WINDOW_NOTICE', delivery: { model: { once: 'window' } } })] }
    const hot = await harness.open(t, source)
    await hot.turn(); assert.deepEqual(await hot.notices(), ['ONE_WINDOW_NOTICE'])
    await hot.hideNotice()
    const cold = await harness.open(t, source, await hot.seed())
    assert.deepEqual(await cold.storedDerived(), { windows: 0, stickies: 0 })
    await hot.turn(); await cold.turn()
    assert.deepEqual(await hot.notices(), ['ONE_WINDOW_NOTICE'])
    assert.deepEqual(await cold.notices(), await hot.notices())
    assert.deepEqual(await hot.storedDerived(), { windows: 0, stickies: 0 })
    assert.deepEqual(await cold.storedDerived(), { windows: 0, stickies: 0 })
  })
}
