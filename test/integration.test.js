import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
const pluginModule = path => import(process.env.DSH_TEST_PLUGIN_ROOT
  ? pathToFileURL(resolve(process.env.DSH_TEST_PLUGIN_ROOT, 'src', path)).href : new URL(`../src/${path}`, import.meta.url).href)
const [plugin, hostPlugin, completionPlugin, requestPlugin, displayPlugin] = await Promise.all(
  ['index.js', 'host.js', 'completion-host.js', 'request-host.js', 'display-host.js'].map(pluginModule))
import { completionStateKey, createCompletionObserver, createCompletionStateStore } from '../src/completion-observer.js'
import { producedBy } from '../src/producer-source.js'
import { captureInputPricing } from '../src/input-pricing.js'
import { journalCalibration, calibrationHeaderKey } from '../src/input-calibration.js'
import { createSummaryExecutor } from '../src/summary-executor.js'
import { createProposalExecutor } from '../src/summary-proposals.js'
import { buildSummaryRequest, frameSummary } from '../src/summary-request.js'
import { resolveConfig } from '../src/policy.js'
import { contextCarePrompts } from '../src/prompt-view-data.js'
import { contextCareActions } from '../src/action-view-data.js'
import { openRequestJournal } from '../src/request-journal.js'
import { ensureSessionLog } from '../lib/session-log.js'
import { createClientChanges } from '../lib/client-changes.js'
import { createActionRecords } from '../src/action-records.js'
import { createRewriteRecords } from '../src/rewrite-records.js'
import { detectorFixture } from './fixtures/detector.js'
import { registerReminderHostCases } from './reminder-host-cases.ts'
import { registerTimeoutHostCases } from './reminder-timeout-cases.ts'
import { registerRecoveryHostCases } from './reminder-recovery-cases.ts'
import { registerShutdownHostCases } from './reminder-shutdown-host-cases.ts'
import { registerDenialLifetimeHostCases } from './reminder-denial-lifetime-host-cases.ts'
import { registerSiyuanWindowHostCases } from './reminder-siyuan-window-host-cases.ts'
import { registerHistoryPerformanceCases } from './reminder-history-performance-host-cases.ts'
import { registerSessionLogCases } from './session-log-host-cases.ts'
import { registerDiagnosticPageCases } from './diagnostic-pages-host-cases.ts'
import { registerDiagnosticPerformanceCases } from './diagnostic-performance-host-cases.ts'
import { registerWorkbenchPerformanceCases } from './workbench-performance-host-cases.ts'
import { registerRewritePerformanceCases } from './rewrite-performance-host-cases.ts'
import { preV4State } from './fixtures/reminder-upgrade.ts'
import { registerScopeHostCases } from './reminder-scope-host-cases.ts'
import { registerDeliveryReplayCases } from './reminder-delivery-replay-cases.ts'
import { registerNativeTriggerCases } from './reminder-native-trigger-cases.ts'
import { createSessionDeliveries } from '../lib/reminder-runtime/session-deliveries.js'
import { replayNativeOutput } from '../lib/reminder-runtime/native-output-events.js'
import { NativeOutputObservation } from './fixtures/reminder-native-output.ts'
import { createOutputStream } from '../lib/reminder-runtime/output-stream.js'
import { registerCompletionReplayCases } from './completion-session-replay-cases.ts'
import { performance } from 'node:perf_hooks'
import { asBatch } from './batch-execute.ts'

// This explicitly selected test acts as an external Host. The plugin itself never
// locates or imports a Harness checkout, and the default test suite is standalone.
const runtimeRoot = process.env.DSH_TEST_RUNTIME_ROOT
if (!runtimeRoot && !process.env.DSH_TEST_CHECKOUT) throw new Error('test:integration requires an explicit DSH_TEST_CHECKOUT or DSH_TEST_RUNTIME_ROOT')
const checkout = resolve(runtimeRoot ?? process.env.DSH_TEST_CHECKOUT)
const source = !runtimeRoot && process.env.DSH_TEST_SOURCE === '1'
const runtimeRequire = runtimeRoot ? createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) : undefined
const load = async (path, packageName) => {
  // ASAR consumers resolve the declared public package name: folder leaves such
  // as client/connection are not that package's published name.
  const target = runtimeRequire ? runtimeRequire.resolve(packageName)
    : resolve(checkout, source ? path.replace('/lib/index.js', '/src/index.ts') : path)
  return import(pathToFileURL(target).href)
}
const { Context } = await load('vendor/cordis/lib/index.js', '@deepseek-ai/cordis')
const { LlmAdapter, createUserMessage, createMessage, createToolResultMessage, ToolCallId } = await load('packages/llm/llm/lib/index.js', '@deepseek-ai/dsh-llm')
const { Session, buildForkSeed } = await load('packages/core/session/lib/index.js', '@deepseek-ai/dsh-session')
const { default: Loader } = await load('vendor/loader/lib/index.js', '@deepseek-ai/cordis-plugin-loader')
const { default: Include } = await load('vendor/include/lib/index.js', '@deepseek-ai/cordis-plugin-include')
const paths = {
  llm: 'llm/llm', session: 'core/session', 'session-projection': 'session/session-projection',
  'system-prompt': 'core/system-prompt', tools: 'core/tools', agent: 'core/agent',
  'client-connection': 'client/connection', 'session-query-sqlite': 'session-query/session-query-sqlite',
  'session-persistence-jsonl': 'session/session-persistence-jsonl',
  'agent-loop': 'core/agent-loop', 'token-meter': 'llm/token-meter', 'compaction-basic': 'compaction/compaction-basic',
  storage: 'storage/storage', 'storage-json': 'storage/storage-json', 'storage-domain': 'storage/storage-domain', 'host-webserver': 'host/webserver', 'compaction-image-offload': 'compaction/compaction-image-offload',
}
const modules = new Map(await Promise.all(Object.entries(paths).map(async ([name, path]) => {
  const module = await load(`packages/${path}/lib/index.js`, `@deepseek-ai/dsh-${name}`)
  return [`@deepseek-ai/dsh-${name}`, module.default ?? module]
})))
modules.set('dsh-context-care', displayPlugin)
modules.set('dsh-context-care/runtime', hostPlugin)
modules.set('dsh-context-care/agent', plugin)
modules.set('dsh-context-care/completion', completionPlugin)
modules.set('dsh-context-care/requests', requestPlugin)
// Only the secret backend is external; admission and cookie verification use real Connection.
modules.set('@care-test/credentials', { name: 'care-test-credentials', apply(ctx) {
  const records = new Map()
  ctx.provide('credentials', { async modifyRecord(key, update) {
    const next = await update(records.get(key))
    if (next !== undefined) records.set(key, next)
    return records.get(key)
  } })
} })
const registeredRuleSource = { sourceId: 'test-memory', plugin: 'example-memory-plugin', registration: 'memory/rules', executor: 'dsh-context-care',
  rules: [{ id: 'remember', actions: [{ id: 'notify' }], definition: { id: 'remember', order: 10, placement: ['user'], when: { said: '/MEMORIZE/' },
    action: { kind: 'notify', by: 'context-care', say: 'Persist the verified memory before continuing.' }, cooldownMinutes: 0, oncePerSurface: false } }] }
modules.set('@care-test/rules', { name: 'care-test-rules', inject: ['contextCareControls'], apply(ctx) {
  ctx.effect(() => ctx.contextCareControls.register(registeredRuleSource))
} })
async function addFixtureRow(ctx, name) {
  await ctx.loader.create({ name })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.name === name)
  await entry.fiber.await()
  return entry
}
async function controlCookie(ctx) {
  await addFixtureRow(ctx, '@care-test/credentials')
  await addFixtureRow(ctx, '@deepseek-ai/dsh-client-connection')
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  let cookie
  ctx.connection.authorizeIndex({ method: 'GET', url: ctx.connection.authenticatedUrl(`${base}/`), headers: { host: new URL(base).host } }, {
    writeHead(status, headers) { assert.equal(status, 303); cookie = headers['set-cookie'].split(';')[0] }, end() {},
  })
  assert.ok(cookie)
  return { base, cookie }
}

class ScriptedAdapter extends LlmAdapter {
  constructor(deep = false) { super(); this.deep = deep }
  requests = []
  calls = 0
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
  async *stream(options) {
    // Real adapters fuse cancellation before opening a request. Exercise the
    // same native brand check so a structured-cloned signal cannot pass here.
    if (options.signal !== undefined) AbortSignal.any([options.signal, new AbortController().signal])
    this.requests.push(options)
    let block
    if (options.purpose === 'compaction') {
      block = { type: 'text', text: 'Verified earlier progress. Continue the pending task.' }
    } else {
      this.calls++
      if (this.calls === 1 || this.calls === 2) block = { type: 'text', text: `Answer ${this.calls}.` }
      // 交接笔记的默认下限是 1000 字（宜细不宜粗），这里凑够。
      else if (this.calls === 3) block = { type: 'tool-call', id: 'rest-one', name: 'context_rest', arguments: JSON.stringify({ note: 'Verify output and finish the requested task.'.padEnd(1200, '…'),
         ...(this.deep ? { deep: true, recovery: 'Read the durable session log; search for earlier verified work.'.padEnd(1200, '…') } : {}) }) }
      else block = { type: 'text', text: 'Continued after context care.' }
    }
    yield { type: 'block-start', index: 0, blockType: block.type }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
  }
}

async function boot(root, completion = true, config = {}, completionConfig = {}, requestConfig = {}) {
  const ctx = new Context()
  ctx.provide('contextCareTestRoot', root)
  ctx.provide('contextCareTestCompletion', completion)
  ctx.provide('contextCareTestConfig', config)
  ctx.provide('contextCareTestCompletionConfig', completionConfig)
  ctx.provide('contextCareTestRequestConfig', requestConfig)
  try {
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier) {
    if (!modules.has(specifier)) throw new Error(`Unknown fixture module ${specifier}`)
    return modules.get(specifier)
  } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(resolve(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) {
    if (!entry.disabled && entry.fiber !== undefined) await entry.fiber.await()
  }
  if (completion) assert.ok(ctx.get('contextCareCompletion'), 'Completion Host must activate')
  assert.ok(ctx.get('contextCareRequests'), 'Request Host must activate')
  assert.ok(ctx.tools.get('context_rest'), `Care must activate: ${JSON.stringify([...ctx.loader.entries()].map(entry => ({ name: entry.options.name, state: entry.fiber?.state, disabled: entry.disabled, config: entry.options.config })) )}`)
  assert.deepEqual([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled).map(entry => entry.options.name), [])
  return ctx
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

test('reminder capacity API saves global settings and restores them through real storage', async t => {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  const { base, cookie } = await controlCookie(ctx)
  ctx.sessions.create('capacity-test')
  const url = `${base}/context-care/rules?sessionId=capacity-test&scope=reminder-capacity`
  assert.equal((await fetch(url)).status, 401)
  const initial = await (await fetch(url, { headers: { cookie } })).json()
  assert.equal(initial.maxRules, 0)
  const patch = body => fetch(url, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const saved = await patch({ revision: initial.revision, maxRules: 1500 })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).maxRules, 1500)
  assert.equal(ctx.get('reminderRules').capacitySnapshot().maxRules, 1500)
  assert.equal((await patch({ revision: initial.revision, maxRules: 0 })).status, 409)
  assert.equal((await patch({ revision: initial.revision + 1, maxRules: -1 })).status, 400)
  await owned.close(ctx)
  const reopened = await owned.open()
  assert.equal(reopened.get('reminderRules').capacitySnapshot().maxRules, 1500)
  assert.equal(reopened.get('reminderRules').capacitySnapshot().revision, initial.revision + 1)
  await owned.close(reopened)
})

test('native handoff rejects a missing live Agent and accepts the same trigger after it opens', async t => {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open(), service = ctx.get('reminderRules')
  await ctx.loader.create({ name: '@deepseek-ai/dsh-session-persistence-jsonl',
    config: { root: resolve(owned.root, 'session-logs'), compression: 'none' } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl') await entry.fiber.await()
  const adapter = new CompletionAdapter([
    { blocks: [{ type: 'text', text: 'Materialized.' }] },
    { blocks: [{ type: 'text', text: 'Delivered.' }] },
  ])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const initial = await ctx.agents.create({ sessionId: 'handoff-needs-agent',
    agentOptions: { provider: 'care-test', model: 'care-test' } })
  await completionTurn(ctx, initial.agent)
  await initial.dispose()
  ctx.effect(() => service.registerSource({ sourceId: 'needs-agent', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', when: { tool: 'programmatic_probe' }, text: 'ACCEPTED_ON_RETRY',
    effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] }).dispose)
  const event = { sessionId: 'handoff-needs-agent', callId: 'retry-publication', rootCallId: 'retry-publication',
    name: 'programmatic_probe', arguments: {} }
  await assert.rejects(service.submit(event), /reminder-native-inbox-agent-unavailable/)
  const agent = (await ctx.agents.resume({ resumeSessionId: event.sessionId,
    agentOptions: { provider: 'care-test', model: 'care-test' } })).agent
  await service.submit(event)
  assert.equal(agent.inbox.nextStep.length, 1, 'retry is not suppressed by the failed acceptance')
  assert.equal(agent.inbox.nextStep[0].source.reminder.handoff.queued, true)
  await completionTurn(ctx, agent)
  const notices = agent.session.snapshotEvents().filter(item => item.type === 'user/message'
    && item.data.source.kind === 'plugin:dsh-context-care:reminder')
  assert.equal(notices.length, 1)
  assert.equal(notices[0].data.content[0].text, 'ACCEPTED_ON_RETRY')
  assert.equal(ctx.storageDomain.get('context_care_reminders'), undefined)
})

test('reminder service connects tool results to logged pre-step messages through real Loader', async t => {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open()
  const service = ctx.get('reminderRules')
  assert.ok(service)
  const { ensureReminderService } = await pluginModule('reminder-runtime/index.js')
  assert.equal(await ensureReminderService(ctx, {}, ctx.contextCareControls), service)
  ctx.effect(() => service.registerSource({ sourceId: 'integration-reminder', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'ts', on: 'tool.succeeded', text: '禁止使用 any',
    when: { tool: 'reminder_read', arguments: { file_path: { regex: '\\.ts$' } } }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] }).dispose)
  ctx.effect(() => ctx.tools.register({ name: 'reminder_read', description: 'Read fixture text',
    parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
    output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'export const value = 1' }] },
    async execute() { return { summary: 'export const value = 1' } } }))
  class ReminderAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) { this.requests.push(request); yield* super.stream(request) }
  }
  const adapter = new ReminderAdapter([
    { blocks: [{ type: 'tool-call', id: 'reminder-1', name: 'reminder_read', arguments: JSON.stringify({ file_path: 'x.ts' }) }] },
    { blocks: [{ type: 'tool-call', id: 'reminder-2', name: 'reminder_read', arguments: JSON.stringify({ file_path: 'y.ts' }) }] },
    { blocks: [{ type: 'text', text: 'Read both files.' }] },
  ])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('reminder-integration', { provider: 'care-test', model: 'care-test' })
  /** @type {Array<{ callId: string; cursor: number }>} */
  const submitted = []
  const submit = service.submit.bind(service)
  /** @type {typeof service.submit} */
  const observeSubmission = (input, signal) => {
    if (input !== null && typeof input === 'object' && 'type' in input && input.type === 'tool.succeeded'
      && 'callId' in input && typeof input.callId === 'string') {
      submitted.push({ callId: input.callId, cursor: agent.session.seq })
    }
    return submit(input, signal)
  }
  t.mock.method(service, 'submit', observeSubmission)
  await completionTurn(ctx, agent)
  const log = await ctx.get('sessionQuery').readSession(agent.session.id)
  assert.deepEqual(submitted.map(item => item.callId), ['reminder-1', 'reminder-2'], 'one submission per committed result')
  for (const item of submitted) {
    const result = log.events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === item.callId)
    assert.ok(result, 'the trigger has a canonical tool result')
    assert.ok(result.seq < item.cursor, 'native result commits before its reminder is submitted')
  }
  const notices = log.events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'plugin:dsh-context-care:reminder')
  assert.equal(notices.length, 1, JSON.stringify(service.snapshot(agent.id)))
  assert.equal(notices[0].data.content[0].text, '禁止使用 any')
  assert.match(JSON.stringify(adapter.requests.at(-1).messages), /禁止使用 any/)
  await owned.close(ctx)
  assert.equal(ctx.get('reminderRules'), undefined)
})

registerNativeTriggerCases({
  async capture(t, handBefore = false, cancelAfterBefore = false, collapseBefore = false, abortAt, after) {
    const owned = await fixture(t, false), ctx = await owned.open()
    let bodies = 0, beforeHooks = 0, releasePresentation, nativeAgent, cancellation = Promise.resolve()
    const candidateWrites = []
    if (after) {
      ctx.on('domain/changed', change => { if (change.domain === 'context_care_reminders') candidateWrites.push(change) })
      ctx.effect(() => ctx.get('reminderRules').registerDetector(after.detector))
      ctx.effect(() => ctx.get('reminderRules').registerSource(after.source).dispose)
      ctx.on('tools/result', exec => {
        if (exec.name === 'native_prefix_probe') cancellation = exec.agent.cancel({ kind: 'hook', reason: 'native pending outcome capture' })
      })
    }
    if (abortAt) {
      ctx.on('tools/pre-execute', (exec, next) => {
        if (exec.name === 'native_prefix_probe') beforeHooks++
        return next()
      })
      if (abortAt === 'before') ctx.on('session/event', (_session, event) => {
        if (event.type === 'tool/call' && event.data.name === 'native_prefix_probe') {
          assert.ok(nativeAgent)
          cancellation = nativeAgent.cancel({ kind: 'hook', reason: 'native before cancellation' })
        }
      })
    }
    if (collapseBefore) {
      // Change the actual registry presentation after the native call commits;
      // request assembly remains native and needs no PTC execution backend.
      ctx.on('session/event', (_session, event) => {
        if (event.type === 'tool/call' && event.data.name === 'native_prefix_probe') {
          assert.ok(nativeAgent)
          releasePresentation = nativeAgent.ctx.tools.presentAs('ptc')
        }
      })
      ctx.on('tools/result', (exec) => {
        if (exec.name === 'native_prefix_probe') { releasePresentation?.(); releasePresentation = undefined }
      })
      ctx.on('tools/pre-execute', (exec, next) => {
        if (exec.name === 'native_prefix_probe') beforeHooks++
        return next()
      })
      ctx.effect(() => () => releasePresentation?.())
    }
    ctx.effect(() => ctx.tools.register({ name: 'native_prefix_probe', description: 'Native prefix replay fixture',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      async execute() { bodies++; return 'CURRENT_RESULT' } }))
    if (handBefore) ctx.effect(() => ctx.get('reminderRules').registerSource({ sourceId: 'native-phases', plugin: 'test', revision: 1, rules: [{
      format: 'reminder/v4', id: 'before', on: 'tool.before-execute', when: { tool: 'native_prefix_probe' },
      text: 'BEFORE {{event.arguments.file_path}}', effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    }] }).dispose)
    if (cancelAfterBefore || abortAt === 'after') ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (exec.name !== 'native_prefix_probe') return decision
      // Cancellation of the registry body does not erase an earlier reminder match.
      // Concluding the turn still lets the real inbox commit the queued message.
      await ctx.get('reminderRules').settle(String(exec.agent.session.id))
      assert.equal(ctx.get('reminderRules').snapshot(String(exec.agent.session.id)).candidates.filter(item => item.ruleId === 'before' && item.status === 'pending' && item.queued === true).length, 1,
        'the actual before-execution match entered the native inbox before the cancellation decision')
      if (abortAt === 'after') cancellation = exec.agent.cancel({ kind: 'hook', reason: 'native before cancellation' })
      else exec.concludeTurn()
      return { kind: 'cancel' }
    })
    ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([
      { blocks: [{ type: 'tool-call', id: 'native-prefix-call', name: 'native_prefix_probe', arguments: '{"file_path":"original.ts"}' }] },
      { blocks: [{ type: 'text', text: 'LATE_CONTEXT assistant after the tool.' }] },
    ]))
    const agent = await ctx.agentLoop.create('native-prefix', { provider: 'care-test', model: 'care-test' })
    nativeAgent = agent
    await completionTurn(ctx, agent, 'EARLY_CONTEXT')
    await cancellation
    await ctx.get('reminderRules').settle(String(agent.id))
    if (after) {
      const runtime = ctx.get('reminderRules')
      assert.equal((await ctx.sessionQuery.readSession(agent.id)).events.some(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin:dsh-context-care:reminder'), false, 'the native outcome is pending before handoff')
      const messages = await runtime.collect({ sessionId: String(agent.session.id), visible: agent.session.deriveMessages() })
      assert.deepEqual(messages.map(message => message.source.contextCareTrace.ruleId), ['first', 'second', 'choice'])
      for (const message of messages) if (after.handoffRules.includes(message.source.contextCareTrace.ruleId)) {
        agent.session.append('user/message', message, { surfaceOp: 'append' })
      }
    }
    const initial = await ctx.sessionQuery.readSession(agent.id)
    if (after) assert.equal(candidateWrites.length, 0, 'live native tool detection, reservation and message commits never write a duplicate candidate ledger')
    if (abortAt) {
      assert.equal(bodies, 0)
      assert.equal(beforeHooks, abortAt === 'after' ? 1 : 0)
      assert.equal(ctx.get('reminderRules').snapshot(String(agent.id)).candidates.filter(item => item.ruleId === 'before' && item.status === 'pending' && item.queued === true).length,
        abortAt === 'after' ? 1 : 0, 'only the real completed hook produces a native reminder handoff')
      assert.equal(initial.events.some(event => event.type === 'user/message' && event.data.source.kind === 'plugin:dsh-context-care:reminder'), false)
      assert.equal(initial.events.some(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.source.kind === 'plugin:dsh-context-care:reminder')), abortAt === 'after')
    }
    if (collapseBefore) {
      assert.equal(bodies, 0)
      assert.equal(beforeHooks, 0, 'the real PTC presentation rejects this direct name before any pre-execution hook')
      assert.equal(ctx.get('reminderRules').snapshot(String(agent.id)).candidates.length, 0)
    }
    if (cancelAfterBefore) {
      assert.equal(bodies, 0)
      assert.equal(initial.events.some(event => event.type === 'user/message' && event.data.source.kind === 'plugin:dsh-context-care:reminder'), true,
        'native inbox handoff survives a cancellation decision after the before-execution match')
    }
    const original = initial.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.ok(original)
    // A later real surface replacement must not change an earlier judge input.
    agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'LATE_CONTEXT replacement of the old input.' }] }),
    { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
    assert.doesNotMatch(JSON.stringify(agent.session.deriveMessages()), /EARLY_CONTEXT/)
    const log = await ctx.sessionQuery.readSession(agent.id)
    const path = resolve(owned.root, 'native-prefix-seed.json')
    await writeFile(path, JSON.stringify({ header: agent.session.header, events: log.events, inheritedEventCount: log.inheritedEventCount }))
    const seed = JSON.parse(await readFile(path, 'utf8'))
    await owned.close(ctx)
    return seed
  },
  async captureAlias(t, descriptor, source, detector, late = false) {
    const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
    const ctx = await owned.open(), runtime = ctx.get('reminderRules')
    const install = () => {
      ctx.effect(() => runtime.registerCustomEvents([descriptor]))
      ctx.effect(() => runtime.registerDetector(detector))
      ctx.effect(() => runtime.registerSource(source).dispose)
    }
    if (!late) install()
    const sideWrites = []
    ctx.on('domain/changed', change => { if (change.domain === 'context_care_reminders') sideWrites.push(change) })
    ctx.llm.registerAdapter(['care-test'], new CompletionAdapter(Array.from({ length: 3 }, () => ({
      blocks: [{ type: 'text', text: 'Actual alias turn.' }],
    }))))
    const agent = await ctx.agentLoop.create('native-alias', { provider: 'care-test', model: 'care-test' })
    await completionTurn(ctx, agent, 'Actual alias input.')
    await runtime.settle(String(agent.id))
    if (late) {
      install()
      const messages = await runtime.collect({ sessionId: String(agent.id), visible: agent.session.deriveMessages() })
      assert.deepEqual(messages, [], 'late registration does not turn an old human message into a new event')
      await completionTurn(ctx, agent, 'A new human input after alias registration.')
      await runtime.settle(String(agent.id))
    } else assert.equal(runtime.snapshot(String(agent.id)).candidates.filter(candidate => candidate.status === 'pending').length, 1,
      'the actual live observer matched the committed human input without cold discovery')
    agent.followup(createUserMessage({ source: { kind: 'plugin:dsh-context-care:test-continuation' },
      content: [{ type: 'text', text: 'Use the next natural request boundary.' }] }))
    await agent.whenIdle(); await runtime.settle(String(agent.id))
    const history = await ctx.sessionQuery.readSession(agent.id)
    assert.equal(history.events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder').length, 1,
      'the live Session observer must publish and hand off the alias exactly once')
    const path = resolve(owned.root, 'native-alias-seed.json')
    await writeFile(path, JSON.stringify({ header: agent.session.header, events: history.events, inheritedEventCount: history.inheritedEventCount }))
    assert.equal(sideWrites.length, 0)
    const seed = JSON.parse(await readFile(path, 'utf8'))
    await owned.close(ctx)
    return seed
  },
  async open(t, seed, cachedSeen, cachedCandidates) {
    const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
    let ctx = await owned.open()
    if (cachedSeen || cachedCandidates) {
      // Seed an actual obsolete file without asking production to open its domain.
      const directory = resolve(owned.root, 'context_care_reminders', 'sessions')
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, String(seed.header.id) + '.json'), JSON.stringify({ version: 1,
        record: { seen: cachedSeen ?? [], candidates: cachedCandidates ?? [], diagnostics: [] } }))
      await owned.close(ctx)
      ctx = await owned.open()
    }
    await ctx.loader.create({ name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: resolve(owned.root, 'session-logs'), compression: 'none' } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl') await entry.fiber.await()
    const handle = await ctx.sessionPersistence.create(seed.header, { inheritedEventCount: seed.inheritedEventCount })
    try { await handle.append(seed.events); await handle.flush() }
    finally { await handle.close() }
    let writes = 0
    ctx.on('domain/changed', change => { if (change.domain === 'context_care_reminders') writes++ })
    return { runtime: ctx.get('reminderRules'), liveCount: () => ctx.sessions.list().length,
      sideWriteCount: () => writes,
      storedCandidates: async () => cachedCandidates ? JSON.parse(await readFile(resolve(owned.root,
        'context_care_reminders', 'sessions', String(seed.header.id) + '.json'), 'utf8')).record.candidates : [],
      storedSeen: async () => cachedSeen ? JSON.parse(await readFile(resolve(owned.root,
        'context_care_reminders', 'sessions', String(seed.header.id) + '.json'), 'utf8')).record.seen : [] }
  },
})

test('committed native tool result remains a reminder trigger after execution cancellation', async t => {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open(), runtime = ctx.get('reminderRules')
  ctx.effect(() => runtime.registerSource({ sourceId: 'late-tool-cancel', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'COMMITTED_TOOL_NOTICE',
    when: { tool: 'late_abort_probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] }).dispose)
  ctx.effect(() => ctx.tools.register({ name: 'late_abort_probe', description: 'Commit before late cancellation',
    parameters: { type: 'object' }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'completed tool body' } }))
  let cancellation = Promise.resolve()
  ctx.on('tools/result', (exec, result) => {
    if (exec.name === 'late_abort_probe' && !result.isError && exec.agent) {
      cancellation = exec.agent.cancel({ kind: 'hook', reason: 'cancel after the frozen tool outcome' })
    }
  })
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([
    { blocks: [{ type: 'tool-call', id: 'late-abort-call', name: 'late_abort_probe', arguments: '{}' }] },
    { blocks: [{ type: 'text', text: 'Continue after the aborted turn.' }] },
  ]))
  const agent = await ctx.agentLoop.create('late-tool-cancel', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  await cancellation
  await runtime.settle(String(agent.id))
  const before = await ctx.get('sessionQuery').readSession(agent.session.id)
  const result = before.events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'late-abort-call')
  assert.ok(result && result.type === 'tool/result' && result.data.message.isError !== true, 'the actual successful outcome committed')
  assert.equal(before.events.filter(event => event.type === 'user/message'
    && event.data.source.kind === 'plugin:dsh-context-care:reminder').length, 0, 'an aborted turn does not wake another request')
  await completionTurn(ctx, agent)
  const after = await ctx.get('sessionQuery').readSession(agent.session.id)
  const notices = after.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin:dsh-context-care:reminder')
  assert.equal(notices.length, 1)
  assert.equal(notices[0].data.content[0].text, 'COMMITTED_TOOL_NOTICE')
})

test('obsolete candidate files have no production reader or writer and HTTP routes survive restart', async t => {
  const owned = await fixture(t, true, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const old = preV4State()
  const directory = resolve(owned.root, 'context_care_reminders', 'sessions')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'upgrade-session.json'), JSON.stringify({ version: 1, record: old }))

  // This is the failing upgrade path: real persisted data, Loader activation,
  // service dependencies and HTTP registration, followed by another restart.
  for (let restart = 0; restart < 2; restart++) {
    const ctx = await owned.open()
    ctx.sessions.create('upgrade-session')
    const runtime = ctx.get('reminderRules')
    const state = runtime.snapshot('upgrade-session')
    assert.deepEqual(state.candidates, [])
    // Legacy seen and windows are caches, not committed Session handoffs.
    assert.deepEqual(state.seen, [])
    assert.deepEqual(state.windows, [])
    assert.deepEqual(state.stickies, [])
    assert.equal(state.diagnostics.length, 0, 'retired JSON is not interpreted by the production runtime')
    assert.deepEqual(await runtime.collect({ sessionId: 'upgrade-session', visible: [] }), [])
    assert.throws(() => runtime.registerSource({ sourceId: 'old', plugin: 'test', revision: 1,
      rules: [old.candidates[0].rule] }), /reminder\/v4/)
    const { base, cookie } = await controlCookie(ctx)
    for (const collection of ['actions', 'prompts']) {
      const response = await fetch(`${base}/context-care/${collection}?sessionId=upgrade-session&limit=20`, { headers: { cookie } })
      assert.equal(response.status, 200, `${collection} must be registered after upgrade`)
      assert.ok(Array.isArray((await response.json())[collection]))
    }
    await owned.close(ctx)
    assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'upgrade-session.json'), 'utf8')).record, old,
      'restarting and using native rules never depends on rewriting the obsolete candidate cache')
  }
})

test('a deny rule stops its own tool through the real registry and leaves other tools runnable', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open()
  ctx.effect(() => ctx.get('reminderRules').registerSource({ sourceId: 'deny-registry', plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'blocked', on: 'tool.before-execute', text: '这次调用被规则拦下',
      when: { tool: 'deny_probe' }, effect: { kind: 'deny-tool', dangerous: true, reason: '不得调用 deny_probe',
        deliver: { model: { once: 'surface' } } } }] }).dispose)
  // The bodies record that they ran: a denial must not reach the tool at all.
  const executed = []
  for (const name of ['deny_probe', 'allow_probe']) {
    ctx.effect(() => ctx.tools.register({ name, description: `${name} probe`, parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      async execute() { executed.push(name); return `${name} body ran` } }))
  }
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([
    { blocks: [{ type: 'tool-call', id: 'denied-call', name: 'deny_probe', arguments: '{}' }] },
    { blocks: [{ type: 'tool-call', id: 'allowed-call', name: 'allow_probe', arguments: '{}' }] },
    { blocks: [{ type: 'text', text: 'Handled both tool results.' }] },
  ]))
  const agent = await ctx.agentLoop.create('deny-registry', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  const resultFor = /** @param {string} id */ id => results.find(event => event.data.message.source.callId === id)
  const textOf = id => resultFor(id).data.message.content.map(block => block.text ?? '').join('')
  assert.deepEqual(executed, ['allow_probe'])
  assert.equal(resultFor('denied-call').data.message.isError, true)
  assert.match(textOf('denied-call'), /不得调用 deny_probe/)
  assert.notEqual(resultFor('allowed-call').data.message.isError, true)
  assert.match(textOf('allowed-call'), /allow_probe body ran/)
})

test('real tool registry preserves preparation failure details and recovers after the cause is removed', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open()
  const runtime = ctx.get('reminderRules')
  ctx.effect(() => runtime.registerSource({ sourceId: 'failure-detail', plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'unmatched', on: 'tool.before-execute', text: 'Unmatched denial',
      when: { tool: 'failure_detail_probe', arguments: { block: { regex: '^yes$' } } }, effect: { kind: 'deny-tool', dangerous: true, reason: 'unmatched',
        deliver: { model: { once: 'surface' } } } }] }).dispose)
  let executed = 0
  ctx.effect(() => ctx.tools.register({ name: 'failure_detail_probe', description: 'Observe preparation failure propagation',
    parameters: { type: 'object' }, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute() { executed++; return 'FAILURE_DETAIL_BODY_RAN' } }))
  const { agent } = await ctx.agents.create({ sessionId: 'failure-detail', agentOptions: { provider: 'care-test', model: 'care-test' } })
  // Exercise the real controls extension point. No fake Context or replacement
  // runtime is involved; the registry must turn the actual guard failure into text.
  const remove = ctx.contextCareRequests.controls.registerProvider(() => { throw new Error('ORIGINAL_CONTROL_READ_FAILED') })
  try {
    const failed = await ctx.tools.execute({ callId: 'preparation-failed', name: 'failure_detail_probe', arguments: {}, agent,
      signal: new AbortController().signal })
    const text = failed.content.map(block => block.text ?? '').join('')
    assert.equal(executed, 0)
    assert.equal(failed.isError, true)
    assert.match(text, /ORIGINAL_CONTROL_READ_FAILED/)
    assert.match(text, /\[unclassified\]/)
    assert.doesNotMatch(text, /无法确认会话归属/)
    t.diagnostic(text)
  } finally { remove() }
  const recovered = await ctx.tools.execute({ callId: 'preparation-recovered', name: 'failure_detail_probe', arguments: {}, agent,
    signal: new AbortController().signal })
  assert.equal(executed, 1)
  assert.match(JSON.stringify(recovered), /FAILURE_DETAIL_BODY_RAN/)
})

registerDenialLifetimeHostCases({ async open(t, ruleTimeoutMs) {
  const owned = await fixture(t, false, {}, {}, { reminders: { maxIdle: 1, ruleTimeoutMs, roundTimeoutMs: 5000 } })
  const ctx = await owned.open()
  return { ctx, runtime: ctx.get('reminderRules'), async turn(calls) {
    ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([
      ...calls.map(call => ({ blocks: [{ type: 'tool-call', ...call, arguments: '{}' }] })),
      { blocks: [{ type: 'text', text: 'Handled lifetime probe.' }] },
    ]))
    const agent = await ctx.agentLoop.create('denial-lifetime', { provider: 'care-test', model: 'care-test' })
    await completionTurn(ctx, agent)
    return agent.session.snapshotEvents()
  } }
} })

registerDiagnosticPageCases({ async open(t) { const owned = await fixture(t, false); return owned.open() } })

registerRewritePerformanceCases({ async open(t, external) {
  const owned = await fixture(t, false), ctx = await owned.open(), { base, cookie } = await controlCookie(ctx)
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Independent rewrite probe completed.' }] }]))
  const target = await ctx.agentLoop.create('long-rewrite-stream', { provider: 'care-test', model: 'care-test' }), session = target.session
  if (external) {
    // The optional provider has no revision/event API and returns fresh JSON;
    // its current listAttributes defaults to the newest 500 rows.
    const rows = []
    ctx.provide('sessionBlockQuery', {
      async putAttribute(row) { rows.push(JSON.parse(JSON.stringify(row))); return String(rows.length) },
      async listAttributes(filter) {
        return rows.filter(row => row.sessionId === filter.sessionId && row.namespace === filter.namespace)
          .slice(-500).reverse().map(row => JSON.parse(JSON.stringify(row)))
      },
    })
  }
  let writer
  ctx.provide('requestRewrite', { register(name, callback) {
    assert.equal(name, 'context-care'); writer = callback
    return () => { writer = undefined }
  } })
  await ctx.fiber.await(); assert.equal(typeof writer, 'function')
  assert.equal(ctx.contextCareControls.enabled(session.id, 'dsh-context-care', 'loop-line-repeat', 'clean'), true)
  return { ctx, session, base, cookie,
    forbidFullReads() {
      t.mock.method(ctx.contextCareRequests, 'list', () => { throw new Error('rewrite-full-list') })
      t.mock.method(ctx.contextCareRequests, 'view', () => { throw new Error('rewrite-full-view') })
    },
    rewrite: async index => {
      const original = `Unique original ${index}.\n` + '继续做这件事。\n'.repeat(30)
      const body = JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: original }] }] })
      const result = await writer({ body, url: 'https://provider.test/v1/chat/completions', scope: { sessionId: session.id } })
      assert.equal(typeof result, 'string'); assert.doesNotMatch(JSON.parse(result).messages[0].content[0].text, /继续做这件事/)
      return result
    },
    http: async () => {
      const response = await fetch(`${base}/context-care/rules?sessionId=${session.id}`, { headers: { cookie } })
      assert.equal(response.status, 200); await response.json()
    },
    probe: async () => {
      const agent = await ctx.agentLoop.create('rewrite-independent-probe', { provider: 'care-test', model: 'care-test' })
      await completionTurn(ctx, agent, 'Answer independently of rewrite subscriptions.')
      assert.ok(agent.session.deriveMessages().some(message => message.role === 'assistant'
        && message.content.some(block => block.type === 'text' && block.text === 'Independent rewrite probe completed.')))
    },
  }
} })

registerDiagnosticPerformanceCases({ async open(t) {
  const owned = await fixture(t, false), ctx = await owned.open(), { base, cookie } = await controlCookie(ctx)
  const session = ctx.sessions.create('long-diagnostic-pages')
  let probeId = 0
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter(Array.from({ length: 2 }, () => ({ blocks: [{ type: 'text', text: 'Independent page probe completed.' }] }))))
  return { ctx, session,
    phase: index => ctx.contextCareRequests.recordAction(session, { action: 'rule-evaluation', phase: 'completed', operationId: `phase-${index}` }),
    page: async (offset, seq) => {
      const query = new URLSearchParams({ sessionId: session.id, limit: '20', offset: String(offset), ...(seq === undefined ? {} : { seq: String(seq) }) })
      const response = await fetch(`${base}/context-care/prompts?${query}`, { headers: { cookie } })
      assert.equal(response.status, 200); return response.json()
    },
    http: async () => {
      const response = await fetch(`${base}/context-care/rules?sessionId=${session.id}`, { headers: { cookie } })
      assert.equal(response.status, 200); await response.json()
    },
    probe: async () => {
      const other = await ctx.agentLoop.create(`pages-other-agent-${++probeId}`, { provider: 'care-test', model: 'care-test' })
      await completionTurn(ctx, other, 'Answer independently of diagnostic pagination.')
      assert.ok(other.session.deriveMessages().some(message => message.role === 'assistant'
        && message.content.some(block => block.type === 'text' && block.text === 'Independent page probe completed.')))
    },
  }
} })

registerSessionLogCases({ async open(t) {
  const owned = await fixture(t, false), ctx = await owned.open()
  await ctx.loader.create({ name: '@deepseek-ai/dsh-session-persistence-jsonl',
    config: { root: resolve(owned.root, 'shared-log-tests'), compression: 'none' } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl') await entry.fiber.await()
  return ctx
} })

registerWorkbenchPerformanceCases({ async open(t) {
  const owned = await fixture(t, false), ctx = await owned.open(), service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('workbench-performance', { provider: 'care-test', model: 'care-test' })
  const displayCalls = t.mock.method(service, 'display')
  const projectionCalls = t.mock.method(ensureSessionLog(ctx).cache, 'worked')
  const recordReads = t.mock.method(service.store, 'read')
  const policyTokenReads = t.mock.method(service.store, 'token')
  const publicSerializations = t.mock.method(JSON, 'stringify')
  const localeComparisons = t.mock.method(String.prototype, 'localeCompare')
  const collators = t.mock.method(Intl, 'Collator')
  let catalogReads = 0
  t.after(ctx.contextCareControls.registerProvider(id => { if (id === agent.id) catalogReads++; return [] }))
  const { base, cookie } = await controlCookie(ctx)
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Independent workbench probe completed.' }] }]))
  return { session: agent.session, tokenReads: () => policyTokenReads.mock.calls.filter(call => call.arguments[0] === agent.id).length, catalogReads: () => catalogReads, recordReads: () => recordReads.mock.calls.filter(call => call.arguments[0] === agent.id).length,
    pauseFilter: paused => ctx.contextCareControls.patch(agent.id, { revision: ctx.contextCareControls.revision(agent.id),
      sourceId: 'context-care:document:workbench-performance', ruleId: 'filter-pairs', paused }).then(() => undefined),
    preview: request => service.preview(agent, request), cacheNames: () => ensureSessionLog(ctx).cache.report().map(row => row.name),
    numericComparisons: () => localeComparisons.mock.calls.filter(call => call.arguments[2]?.numeric).length,
    removalCollators: () => collators.mock.callCount(),
    byteSerializations: request => publicSerializations.mock.calls.filter(call => call.arguments[0]?.messages?.[0]?.id === request.messages[0].id).length,
    actionWork: () => projectionCalls.mock.calls.filter(call => call.arguments[0].name === 'request-plan-actions').reduce((sum, call) => sum + (call.arguments[1] ?? 1), 0),
    projectionWork: () => projectionCalls.mock.calls.filter(call => call.arguments[0].name === 'request-model-projection')
      .reduce((sum, call) => sum + (call.arguments[1] ?? 1), 0),
    configure: filters => service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: {
      schemaVersion: 2, id: 'workbench-performance', revision: 1, title: 'Performance',
      entries: filters === 'cascade' ? [
        { id: 'first', revision: 1, title: 'First', enabledDefault: true, template: 'SECOND_LINK',
          activation: { kind: 'keywords', keywords: ['START_CHAIN'] }, select: { view: 'model', roles: ['user'], blockTypes: ['text'], depth: { unit: 'message', limit: 1 } },
          target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } },
        { id: 'second', revision: 1, title: 'Second', enabledDefault: true, cascade: true, template: 'THIRD_LINK',
          activation: { kind: 'keywords', keywords: ['SECOND_LINK'] }, select: { view: 'model', roles: ['user'], blockTypes: ['text'], depth: { unit: 'message', limit: 1 } },
          target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } },
        { id: 'third', revision: 1, title: 'Third', enabledDefault: true, cascade: true, template: 'FINAL_LINK',
          activation: { kind: 'keywords', keywords: ['THIRD_LINK'] }, select: { view: 'model', roles: ['user'], blockTypes: ['text'], depth: { unit: 'message', limit: 1 } },
          target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } },
      ] : [], rules: filters === 'cascade' ? [] : filters ? [
        { schemaVersion: 2, id: 'filter-pairs', revision: 1, on: ['request.assemble'],
          select: { view: 'model', roles: ['tool'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '^REMOVE' },
          actions: [{ id: 'filter', kind: 'filter', stage: 'request.assemble', enabledDefault: true }] },
      ] : [
        { schemaVersion: 2, id: 'display', revision: 1, on: ['display.render'],
          select: { view: 'display', roles: ['assistant'], blockTypes: ['text'], depth: { unit: 'message', limit: 2 } },
          match: { kind: 'regex', pattern: '^HIST' }, actions: [{ id: 'patch', kind: 'replace', template: 'VIEW', stage: 'display.render', enabledDefault: true }] },
        { schemaVersion: 2, id: 'output', revision: 1, on: ['output.complete'],
          select: { view: 'original', roles: ['assistant'], blockTypes: ['text'], depth: { unit: 'message', limit: 2 } },
          match: { kind: 'regex', pattern: '^CURRENT_END' }, actions: [{ id: 'notice', kind: 'notify', template: 'Matched current output', stage: 'output.complete', enabledDefault: true }] },
      ] } }).then(() => undefined),
    display: seq => service.display(agent, seq), reconcile: () => service.reconcile(agent),
    http: async () => {
      const response = await fetch(base + '/context-care/rules?sessionId=' + encodeURIComponent(agent.id), { headers: { cookie } })
      assert.equal(response.status, 200); await response.json()
    },
    probe: async () => {
      const other = await ctx.agentLoop.create('workbench-other-agent', { provider: 'care-test', model: 'care-test' })
      await completionTurn(ctx, other, 'Answer independently of the workbench query.')
      assert.ok(other.session.deriveMessages().some(message => message.role === 'assistant'
        && message.content.some(block => block.type === 'text' && block.text === 'Independent workbench probe completed.')))
    }, runs: () => service.store.read(agent.id).runtime.runs.length, displayCalls: () => displayCalls.mock.callCount(),
  }
} })

registerHistoryPerformanceCases({ async open(t) {
  const owned = await fixture(t, false), ctx = await owned.open()
  const { base, cookie } = await controlCookie(ctx)
  const runtime = ctx.get('reminderRules')
  ctx.effect(() => runtime.registerSource({ sourceId: 'history-performance', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'probe', on: 'tool.succeeded', when: { tool: 'history_performance_probe' },
    text: 'HISTORY_PERFORMANCE_NOTICE', effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] }).dispose)
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Concurrent Host turn completed.' }] }]))
  const collect = async session => runtime.collect({ sessionId: String(session.id), visible: session.deriveMessages() })
  const probe = async () => {
    const agent = await ctx.agentLoop.create('history-concurrent-agent', { provider: 'care-test', model: 'care-test' })
    await completionTurn(ctx, agent, 'Process a separate request during history recovery.')
    assert.ok(agent.session.deriveMessages().some(message => message.role === 'assistant'
      && message.content.some(block => block.type === 'text' && block.text === 'Concurrent Host turn completed.')))
  }
  const match = async session => {
    const callId = ToolCallId('history-current-hit')
    const call = session.append('tool/call', { turn: 1, step: 2001, callId,
      name: 'history_performance_probe', arguments: JSON.stringify({ index: 'current' }) })
    session.append('tool/result', { turn: 1, step: 2001,
      message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'CURRENT_RESULT' }] })
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    await runtime.settle(String(session.id))
    const messages = await collect(session)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].content[0].text, 'HISTORY_PERFORMANCE_NOTICE')
    session.append('user/message', messages[0], { surfaceOp: 'append' })
    assert.deepEqual(await collect(session), [], 'the native receipt suppresses repeat delivery')
  }
  const nativeLog = process.env.DSH_NATIVE_RECOVERY_LOG
  if (!nativeLog) return { ctx, base, cookie, collect, probe, match, session: ctx.sessions.create('history-performance'), nativeLog: false }
  // The explicit native sample is read by the official decoder; no original events are rewritten.
  const { readDecodedJsonlSource } = await import(pathToFileURL(resolve(checkout, 'packages/session/session-persistence-jsonl/src/generation.ts')).href)
  const { sessionFormatCatalog } = await import(pathToFileURL(resolve(checkout, 'packages/session/session-format-catalog/src/index.ts')).href)
  const { artifact } = await readDecodedJsonlSource(nativeLog, 4, 'zstd', {
    createRestore: header => sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'transformed' }),
  })
  const session = ctx.sessions.create(artifact.header.id, { seed: artifact.events, meta: artifact.header,
    inheritedEventCount: artifact.inheritedEventCount, eventState: 'detached' })
  return { ctx, base, cookie, collect, probe, match, session, nativeLog: true }
} })

registerSiyuanWindowHostCases({ async open(t) {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  return { ctx, session: ctx.sessions.create('siyuan-window'), expirySession: ctx.sessions.create('siyuan-window-expiry') }
} })

registerShutdownHostCases({ async open(t) {
  const owned = await fixture(t, false, {}, {}, { reminders: { maxIdle: 1, storageTimeoutMs: 20, ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open(), options = { provider: 'care-test', model: 'care-test' }
  const agent = (await ctx.agents.create({ sessionId: 'host-drain', agentOptions: options })).agent
  const runtime = ctx.get('reminderRules')
  assert.ok(runtime, 'the real reminder Host must be active')
  const owner = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care/requests')
  assert.ok(owner?.fiber, 'the real request plugin must own the reminder runtime')
  let sideWrites = 0
  ctx.on('domain/changed', change => { if (change.domain === 'context_care_reminders') sideWrites++ })
  return { root: owned.root, runtime, sessionId: String(agent.id),
    pending: () => agent.inbox.nextStep.filter(message => message.source.kind === 'plugin:dsh-context-care:reminder').length,
    events: () => agent.session.snapshotEvents(), sideWrites: () => sideWrites,
    candidateStoreOpened: () => ctx.storageDomain.get('context_care_reminders') !== undefined,
    unload: scope => scope === 'host' ? owned.close(ctx) : owner.fiber.dispose(),
    async replay(source) {
      // Read after teardown: Host cancellation is a native fact and must survive replay.
      const seed = { events: agent.session.snapshotEvents(), inheritedEventCount: agent.session.inheritedEventCount,
        meta: { isSeeded: agent.session.header.isSeeded } }
      const reopened = await fixture(t, false), cold = await reopened.open()
      cold.effect(() => cold.get('reminderRules').registerSource(source).dispose)
      const resumed = (await cold.agents.create({ sessionId: String(agent.id), seed: seed.events, meta: seed.meta,
        inheritedEventCount: seed.inheritedEventCount, agentOptions: options })).agent
      cold.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Resume native handoff.' }] }]))
      await completionTurn(cold, resumed); await cold.get('reminderRules').settle(String(resumed.id))
      assert.equal(cold.storageDomain.get('context_care_reminders'), undefined)
      return resumed.session.snapshotEvents().filter(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin:dsh-context-care:reminder').map(event => event.data.content[0].text)
    } }
} })

registerRecoveryHostCases({ async exercise(t, scenario) {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  let ctx = await owned.open()
  const source = { sourceId: 'recovery', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'RECOVERED_NOTICE',
    when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] }
  const options = { provider: 'care-test', model: 'care-test' }
  let agent = (await ctx.agents.create({ sessionId: 'recovery-session', agentOptions: options })).agent
  let service = ctx.get('reminderRules'), handle = service.registerSource(source)
  await service.submit({ sessionId: String(agent.id), callId: 'probe', rootCallId: 'probe', name: 'probe', arguments: {} })
  assert.equal(agent.inbox.nextStep.length, 1, 'the unanchored match has a real native inbox receipt')
  const seed = { events: agent.session.snapshotEvents(), inheritedEventCount: agent.session.inheritedEventCount,
    meta: { isSeeded: agent.session.header.isSeeded } }
  assert.ok(seed.events.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.length === 1))
  assert.equal(ctx.storageDomain.get('context_care_reminders'), undefined)
  if (scenario.restart) {
    await owned.close(ctx)
    ctx = await owned.open(); service = ctx.get('reminderRules')
    handle = service.registerSource({ ...source, revision: 2,
      rules: scenario.changed ? [{ ...source.rules[0], text: 'CHANGED_NOTICE' }] : source.rules })
    agent = (await ctx.agents.create({ sessionId: 'recovery-session', seed: seed.events, meta: seed.meta,
      inheritedEventCount: seed.inheritedEventCount, agentOptions: options })).agent
    // Observe the accepted frozen message before replacing its registration.
    await service.queuePending({ sessionId: String(agent.id), visible: agent.session.deriveMessages(), accepted: [...agent.inbox.nextStep] })
  }
  if (scenario.replace) {
    handle.replace({ ...source, revision: 3, rules: [{ ...source.rules[0], text: 'TEMPORARY_NOTICE' }] })
    handle.replace({ ...source, revision: 4 })
  }
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Continue after recovery.' }] }]))
  await completionTurn(ctx, agent); await service.settle(String(agent.id))
  const messages = agent.session.snapshotEvents().filter(event => event.type === 'user/message'
    && event.data.source.kind === 'plugin:dsh-context-care:reminder').map(event => event.data)
  return { notices: messages.length, text: messages[0]?.content[0]?.text }
} })

registerTimeoutHostCases({ async exercise(t, outcome, execute) {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open()
  const policy = await load('packages/guard/timeout-policy/lib/index.js', '@deepseek-ai/dsh-tool-call-timeout-policy')
  modules.set('@care-test/timeout-policy', policy)
  await ctx.loader.create({ name: '@care-test/timeout-policy' })
  await ctx.loader.await()
  ctx.effect(() => ctx.get('reminderRules').registerSource({ sourceId: 'timeout-test', plugin: 'test', revision: 1,
    rules: [{ format: 'reminder/v4', id: 'timeout', on: 'tool.failed', text: 'TIMEOUT_ONLY_NOTICE',
      when: { tool: 'timeout_probe', error: { code: 'TOOL_TIMEOUT' } }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] }).dispose)
  ctx.effect(() => ctx.tools.register({ name: 'timeout_probe', description: 'Exercise tool completion',
    parameters: { type: 'object' }, timeoutMs: outcome === 'cancel' ? 10000 : 30,
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args, exec) {
      if (outcome === 'cancel') setTimeout(() => exec.agent.cancel({ kind: 'hook', reason: 'timeout negative case' }), 10)
      return execute(args, exec)
    } }))
  class TimeoutAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) { this.requests.push(JSON.stringify(request.messages)); yield* super.stream(request) }
  }
  const adapter = new TimeoutAdapter([
    { blocks: [{ type: 'tool-call', id: 'timeout-probe', name: 'timeout_probe', arguments: '{}' }] },
    { blocks: [{ type: 'text', text: 'Continue.' }] },
  ])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create(`timeout-${outcome}`, { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  await ctx.get('reminderRules').settle(agent.id)
  const events = agent.session.snapshotEvents()
  return { errorCode: events.find(event => event.type === 'tool/result')?.data.error?.code,
    notices: events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'plugin:dsh-context-care:reminder').length,
    requests: adapter.requests }
} })

test('shared reminder quota limits real concurrent sessions and survives Host restart and source edits', async t => {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const source = { sourceId: 'shared-life', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'request.before', text: 'SHARED_LIFETIME_NOTICE', when: {},
    effect: { kind: 'remind', deliver: { model: { once: 'surface', shared: { reset: 'lifetime', lifetime: 'campaign-1', limit: 2 } } } },
  }] }
  const ctx = await owned.open()
  ctx.effect(() => ctx.get('reminderRules').registerSource(source).dispose)
  class RecordingAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) { this.requests.push(request); yield* super.stream(request) }
  }
  const adapter = new RecordingAdapter(Array.from({ length: 4 }, () => ({ blocks: [{ type: 'text', text: 'Done.' }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agents = await Promise.all(['one', 'two', 'three', 'four'].map(id => ctx.agentLoop.create(`quota-${id}`, { provider: 'care-test', model: 'care-test' })))
  await Promise.all(agents.map(agent => completionTurn(ctx, agent)))
  const notices = agents.flatMap(agent => agent.session.snapshotEvents().filter(event =>
    event.type === 'user/message' && event.data.source?.kind === 'plugin:dsh-context-care:reminder'))
  assert.equal(notices.length, 2)
  assert.equal(adapter.requests.filter(request => JSON.stringify(request.messages).includes('SHARED_LIFETIME_NOTICE')).length, 2)
  assert.equal(new Set(notices.map(event => event.data.source.reminder.shared.key)).size, 1)
  assert.equal(ctx.storageDomain.get('context_care_reminder_claims'), undefined)
  const logPath = resolve(owned.root, 'shared-session-replay.json')
  await writeFile(logPath, JSON.stringify(agents.map(agent => ({ header: agent.session.header,
    inheritedEventCount: agent.session.inheritedEventCount, events: agent.session.snapshotEvents() }))))
  const saved = JSON.parse(await readFile(logPath, 'utf8'))
  await owned.close(ctx)

  // A different storage root has neither the former quota file nor reminder state.
  const restoredRoot = await fixture(t, false)
  const resumed = await restoredRoot.open()
  resumed.effect(() => resumed.get('reminderRules').registerSource({ ...source, revision: 2,
    rules: [{ ...source.rules[0], text: 'EDITED_SHARED_NOTICE' }] }).dispose)
  const resumedAdapter = new RecordingAdapter([{ blocks: [{ type: 'text', text: 'Still done.' }] }])
  resumed.llm.registerAdapter(['care-test'], resumedAdapter)
  await resumed.loader.create({ name: '@deepseek-ai/dsh-session-persistence-jsonl',
    config: { root: resolve(restoredRoot.root, 'session-logs'), compression: 'none' } })
  await resumed.loader.await()
  for (const entry of resumed.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl') await entry.fiber.await()
  for (const session of saved) {
    const handle = await resumed.sessionPersistence.create(session.header, { inheritedEventCount: session.inheritedEventCount })
    try { await handle.append(session.events); await handle.flush() }
    finally { await handle.close() }
  }
  assert.equal(resumed.sessions.list().length, 0, 'quota contributors remain dormant, not live Agents')
  assert.equal((await resumed.sessionQuery.listSessions()).filter(session => session.persisted && !session.live).length, 4)
  const newcomer = await resumed.agentLoop.create('quota-newcomer', { provider: 'care-test', model: 'care-test' })
  await completionTurn(resumed, newcomer)
  assert.doesNotMatch(JSON.stringify(resumedAdapter.requests[0].messages), /EDITED_SHARED_NOTICE/)
  assert.ok(saved.every(({ header }) => !resumed.sessions.get(header.id)), 'quota replay does not activate dormant Sessions')
  assert.equal(resumed.storageDomain.get('context_care_reminder_claims'), undefined)
  assert.equal((await readdir(restoredRoot.root)).includes('context_care_reminder_claims'), false)
})

test('shared reminder cache restores accepted inbox reservations without calling them consumed', async t => {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open()
  const { createSessionClaims } = await import('../lib/reminder-runtime/session-claims.js')
  const { changeClaims } = await import('../lib/reminder-runtime/claims.js')
  const runtime = ctx.get('reminderRules')
  ctx.effect(() => runtime.registerSource({ sourceId: 'accepted-quota', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'request.before', text: 'ACCEPTED_SHARED_NOTICE', when: {},
    effect: { kind: 'remind', deliver: { model: { once: 'surface',
      shared: { reset: 'lifetime', lifetime: 'pending', limit: 1 } } } },
  }] }).dispose)
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([]))
  const agent = await ctx.agentLoop.create('accepted-quota-session', { provider: 'care-test', model: 'care-test' })
  await runtime.prepareRequest({ sessionId: agent.id, events: [], visible: [] })
  const messages = await runtime.collect({ sessionId: agent.id, visible: [] })
  assert.equal(messages.length, 1)
  agent.inject(messages[0])
  assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'user/message').length, 0)
  const cold = createSessionClaims(ctx)
  ctx.on('session/event', (session, event) => cold.observe(session, event))
  ctx.effect(() => () => cold.close())
  const restored = await cold.update(book => book)
  assert.equal(restored.buckets[0].claims[0].messageId, messages[0].id)
  assert.equal(restored.buckets[0].claims[0].status, 'reserved')
  const transition = operation => cold.update(book => changeClaims(book, { at: Date.now(), maxBytes: 1024 * 1024, ...operation }))
  await assert.rejects(transition({ consume: [messages[0].id] }), /reminder-shared-delivery-not-committed/)
  const competing = { key: messages[0].source.reminder.shared.key, limit: 1,
    sessionId: 'competitor', messageId: 'competitor-message', candidateId: 'competitor-candidate' }
  assert.equal((await transition({ reserve: [competing] })).buckets[0].claims.length, 1)
  assert.equal((await cold.update(book => book)).buckets[0].claims[0].messageId, messages[0].id)
  await agent.cancel({ kind: 'hook', reason: 'discard the pending fixture reminder' })
  assert.ok(agent.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled'))
  assert.deepEqual(await cold.update(book => book), { buckets: [] })
  assert.equal((await transition({ reserve: [competing] })).buckets[0].claims[0].messageId, competing.messageId)
  const replayed = createSessionClaims(ctx)
  assert.deepEqual(await replayed.update(book => book), { buckets: [] },
    'a discarded inbox item and a never-accepted local reservation leave no durable consumption')
  await replayed.close()
  assert.equal(ctx.storageDomain.get('context_care_reminder_claims'), undefined)
})

test('shared reminder window grants a new quota on the next night', async t => {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  const { createReminderRuntime } = await pluginModule('reminder-runtime/index.js')
  const { createBoundedMatcher } = await pluginModule('bounded-matcher.js')
  const { createSessionClaims } = await import('../lib/reminder-runtime/session-claims.js')
  let at = new Date(2026, 9, 14, 23).getTime()
  const claims = createSessionClaims(ctx, () => at)
  const matcher = createBoundedMatcher({ timeoutMs: 2000, maxIdle: 1 })
  const runtime = createReminderRuntime({ wallNow: () => at, dispatches: true,
    config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 },
    execute: (input, signal, timing) => matcher.detect(input, signal, timing),
    updateClaims: change => claims.update(change) })
  ctx.on('session/event', (session, event) => claims.observe(session, event))
  ctx.on('session/created', session => claims.created(session))
  ctx.effect(() => async () => { await runtime.close(); await claims.close(); await matcher.close() })
  runtime.registerSource({ sourceId: 'shared-night', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'night', on: 'request.before', text: 'Night reminder',
    when: { timeWindow: { start: '23:00', end: '06:00' } },
    effect: { kind: 'remind', deliver: { model: { once: 'window', shared: { reset: 'window', limit: 1 } } } },
  }] })
  for (const id of ['a', 'b', 'c']) ctx.sessions.create(id)
  await matcher.warmup()
  const prepare = sessionId => runtime.prepareRequest({ sessionId, events: [] })
  await Promise.all(['a', 'b'].map(prepare))
  const first = await Promise.all(['a', 'b'].map(sessionId => runtime.collect({ sessionId, visible: [] })))
  assert.equal(first.flat().length, 1)
  const firstMessage = first.flat()[0], winner = first[0].length ? 'a' : 'b'
  ctx.sessions.get(winner).append('user/message', firstMessage, { surfaceOp: 'append' })
  await runtime.collect({ sessionId: winner, visible: [firstMessage] })
  assert.equal((await claims.update(book => book)).buckets[0].claims[0].status, 'consumed')
  at = new Date(2026, 9, 15, 23).getTime()
  await prepare('c')
  const next = await runtime.collect({ sessionId: 'c', visible: [] })
  assert.equal(next.length, 1)
  assert.notEqual(next[0].source.reminder.shared.key, firstMessage.source.reminder.shared.key)
  assert.equal((await claims.update(book => book)).buckets.length, 1)
  assert.equal(ctx.storageDomain.get('context_care_reminder_claims'), undefined)
})

test('exported Host rows mount together, serve the journal, and remove routes and tools on unload', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  for (const route of ['rewrite-journal', 'actions', 'prompts']) assert.equal((await globalThis.fetch(`${base}/context-care/${route}`)).status, 503)
  const { cookie } = await controlCookie(ctx)
  const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { cookie, ...options.headers } })
  for (const route of ['rewrite-journal', 'actions', 'prompts']) assert.equal((await globalThis.fetch(`${base}/context-care/${route}`)).status, 401)
  ctx.sessions.create('journal-one'); ctx.sessions.create('journal-two')
  const url = `${base}/context-care/rewrite-journal?sessionId=journal-one`
  assert.equal((await fetch(`${base}/context-care/rewrite-journal`)).status, 400)
  assert.equal((await fetch(`${base}/context-care/rewrite-journal?sessionId=missing`)).status, 404)
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).records, [])
  for (const sessionId of ['journal-one', 'journal-two']) await ctx.contextCareRequests.recordAction(ctx.sessions.get(sessionId), {
    action: 'request-rewrite', phase: 'recorded', rewrite: { sessionId, hash: sessionId === 'journal-one' ? 'visible' : 'private-other' } })
  const rewritePage = await fetch(url)
  assert.equal(rewritePage.headers.get('cache-control'), 'no-store')
  assert.deepEqual((await rewritePage.json()).records.map(record => record.hash), ['visible'])
  assert.equal((await fetch(url, { headers: { origin: 'http://foreign.test' } })).status, 403)
  const actionsUrl = `http://127.0.0.1:${ctx.webServer.port}/context-care/actions`
  const fullView = t.mock.method(ctx.contextCareRequests, 'view', () => { throw new Error('production-page-requested-full-list') })
  assert.equal((await fetch(actionsUrl)).status, 400)
  assert.equal((await fetch(`${actionsUrl}?sessionId=s1&limit=999`)).status, 400)
  const firstActionSession = ctx.sessions.create('s1'), secondActionSession = ctx.sessions.create('s2')
  // Live diagnostics retain the latest operation per family, not an unlimited action ledger.
  for (const [index, action] of ['prune', 'summary', 'deep-rest'].entries()) {
    await ctx.contextCareRequests.recordAction(firstActionSession, { action, phase: 'completed', operationId: `s1-${index}` })
  }
  await ctx.contextCareRequests.recordAction(secondActionSession, { action: 'summary', phase: 'committed', compactionId: 'private-s2' })
  const page = await (await fetch(`${actionsUrl}?sessionId=s1&limit=2&offset=0`)).json()
  assert.equal(page.total, 3)
  assert.equal(page.actions.length, 2)
  assert.ok(page.actions.every(action => action.journalPersisted === false))
  assert.equal(page.nextOffset, 2)
  assert.doesNotMatch(JSON.stringify(page), /private-s2/)
  const lastPage = await (await fetch(`${actionsUrl}?sessionId=s1&limit=2&offset=2`)).json()
  assert.equal(lastPage.actions.length, 1)
  assert.equal(lastPage.nextOffset, null)
  const promptSession = ctx.sessions.create('prompt-history')
  const seqs = []
  for (let index = 0; index < 25; index++) seqs.push(promptSession.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `<context-care>exact notice ${index}</context-care>` }],
    source: { kind: 'plugin:dsh-context-care:state', form: 'notice', contextCareTrace: { trigger: 'budget-state' } },
  }), { surfaceOp: 'append' }).seq)
  const promptsUrl = `http://127.0.0.1:${ctx.webServer.port}/context-care/prompts`
  assert.equal((await fetch(`${promptsUrl}?sessionId=unknown&limit=20`)).status, 404)
  assert.equal((await fetch(`${promptsUrl}?sessionId=prompt-history&limit=20&seq=-1`)).status, 400)
  const selectedPage = await (await fetch(`${promptsUrl}?sessionId=prompt-history&limit=20&seq=${seqs[0]}`)).json()
  assert.equal(selectedPage.offset, 20)
  assert.equal(selectedPage.selectedFound, true)
  assert.equal(selectedPage.total, 25)
  assert.equal(selectedPage.prompts.at(-1).text, '<context-care>exact notice 0</context-care>')
  assert.doesNotMatch(JSON.stringify(selectedPage), /private-s2/)
  assert.equal(fullView.mock.callCount(), 0, 'authenticated production pages consume the shared delta feed')
  const missingSelection = await (await fetch(`${promptsUrl}?sessionId=prompt-history&limit=20&seq=999999`)).json()
  assert.equal(missingSelection.selectedFound, false)
  assert.equal(missingSelection.offset, 0, 'A missing selection must not fabricate a matching historical page')
  const originalFlush = ctx.contextCareRequests.flush
  let flushes = 0
  ctx.contextCareRequests.flush = async () => { flushes++; throw new Error('Reads must not force Session I/O') }
  try {
    assert.equal((await fetch(`${actionsUrl}?sessionId=s1&limit=2`)).status, 200)
    assert.equal((await fetch(`${promptsUrl}?sessionId=prompt-history&limit=20`)).status, 200)
    assert.equal((await fetch(url)).status, 200)
    assert.equal(flushes, 0, 'Session-authoritative diagnostic GETs never force a durable flush')
  } finally { ctx.contextCareRequests.flush = originalFlush }
  const row = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care/runtime')
  await row.fiber.dispose()
  assert.equal((await fetch(actionsUrl + '?sessionId=s1&limit=2')).status, 404)
  assert.equal((await fetch(url)).status, 404)
  assert.equal((await fetch(`${promptsUrl}?sessionId=prompt-history&limit=20`)).status, 404)
  assert.equal(ctx.tools.get('context_rest'), undefined)
})

test('disabling the display leaves runtime sampling, tools, request observation and queries active', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const display = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care')
  await display.fiber.dispose()
  assert.ok(ctx.tools.get('context_rest'), 'Display must not own maintenance tools')
  const agent = await ctx.agentLoop.create('display-disabled', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Keep the runtime running without a browser.')
  await completionTurn(ctx, agent, 'Sample the now-bound request configuration.')
  assert.equal(adapter.calls, 2, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data)))
  assert.equal(typeof ctx.sessionProjections.stateOf(agent.session, 'contextCareNumeric').fatigueValue, 'number')
  await ctx.contextCareRequests.flush(agent.id)
  assert.ok(ctx.contextCareRequests.list(agent.id).some(record => record.kind === 'request' && record.data.dispatched))
  const { cookie } = await controlCookie(ctx)
  const page = await fetch(`http://127.0.0.1:${ctx.webServer.port}/context-care/actions?sessionId=${agent.id}&limit=20`, { headers: { cookie } })
  assert.equal(page.status, 200)
  assert.ok((await page.json()).admission)
})

test('real Loader/loop preserves request prefix and compacts after tool result, then continues', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('care-integration', { provider: 'care-test', model: 'care-test' })
  const turn = async text => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  await turn('Earlier verified work. '.repeat(1200))
  await turn('Continue the next work unit. '.repeat(100))
  assert.equal(adapter.calls, 2)
  const first = adapter.requests[0]
  const second = adapter.requests[1]
  assert.equal(first.system, second.system)
  assert.doesNotMatch(first.system ?? '', /Fatigue:|wakefulness:/)
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages)
  for (const request of [first, second]) {
    for (const message of request.messages) {
      if (message.content.some(block => block.type === 'text' && block.text.includes('<context-care>'))) assert.equal(message.role, 'user')
    }
  }
  await turn('Checkpoint now, then continue working.')
  const events = agent.session.snapshotEvents()
  const summaries = events.filter(event => event.type === 'compaction/summary')
  assert.equal(summaries.length, 1, `Expected one committed compaction; events: ${events.map(e => e.type).join(', ')}`)
  const result = events.find(event => event.type === 'tool/result')
  const start = events.find(event => event.type === 'compaction/start')
  assert.ok(result.seq < start.seq)
  const statuses = events.filter(event => event.type === 'user/message' && producedBy(event.data.source, 'dsh-context-care:state'))
  assert.match(statuses.at(-1).data.content[0].text, /休息结果：较早的历史已摘要，近况与交接笔记保留。/)
  assert.equal(adapter.calls, 4)
  const final = adapter.requests.at(-1)
  assert.ok(final.messages.some(message => message.content.some(block => block.text?.includes('Verify output and finish'))))
  const ui = ctx.sessionProjections.stateOf(agent.session, 'contextCareNumeric')
   assert.equal(typeof ui.fatigueValue, 'number')
   assert.equal(typeof ui.wakefulnessValue, 'number')
   assert.equal(ui.fatigueValue, statuses.at(-1).data.source.contextCare.fatigueValue)
   // Numeric provenance is persisted, but never inserted into model text.
   assert.ok(final.messages.every(message => message.content.every(block => !block.text?.includes('fatigueValue'))))
  assert.equal(ui.sampledSeq, statuses.at(-1).seq)
  const projection = (await import('../src/projection.js')).contextCareProjection
  assert.deepEqual(events.reduce((state, event) => projection.apply(state, event), projection.init()), ui)
  const observed = statuses.map(event => event.data.content[0].text)
  const expected = JSON.parse(await readFile(new URL('./fixtures/statuses.json', import.meta.url), 'utf8'))
  assert.deepEqual(observed, expected)
})

test('real loop honors explicit rest when conversation and summary capacities are unknown', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  class UnknownCapacityAdapter extends ScriptedAdapter {
    // Public metadata represents an unknown capacity by omitting context.
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
  }
  const adapter = new UnknownCapacityAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('unknown-capacity-rest', { provider: 'care-test', model: 'care-test' })
  const turn = async text => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  await turn('Earlier verified work. '.repeat(1200))
  await turn('Continue the next work unit. '.repeat(100))
  assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
  await turn('Checkpoint now, then continue working.')
  const summaries = agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')
  assert.equal(summaries.length, 1, JSON.stringify({ calls: adapter.calls,
    events: agent.session.snapshotEvents().map(event => ({ type: event.type, content: event.data.content,
      error: event.data.error, failure: event.data.failure, result: event.type === 'tool/result' ? event.data : undefined })),
    actions: ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'maintenance').map(record => record.data) }))
  const request = adapter.requests.find(request => request.purpose === 'compaction')
  assert.ok(request, 'Unknown capacity must still reach the summary provider')
  const instruction = request.messages.at(-1).content.map(block => block.text ?? '').join('\n')
  assert.match(instruction, /分别记录原始请求中的明确要求与纠正、执行者自行选择的实现方案和推测/)
  assert.match(instruction, /准确区分工作状态与指令/)
  assert.equal(adapter.calls, 4, 'The task continues after the checkpoint')
  assert.ok(adapter.requests.at(-1).messages.some(message => message.content.some(block => block.text?.includes('Verify output and finish'))))
  await ctx.contextCareRequests.flush(agent.session.id)
  const committed = ctx.contextCareRequests.list(agent.session.id).find(record => record.kind === 'maintenance' && record.data.phase === 'committed')
  assert.ok(committed.data.afterInput < committed.data.beforeInput)
})

// Each test owns its disk root and Loader instances, including restart instances.
async function fixture(t, completion = true, config = {}, completionConfig = {}, requestConfig = {}) {
  const sourceComposition = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
  const root = await mkdtemp(resolve(tmpdir(), 'context-care-durable-'))
  const contexts = new Set()
  t.after(async () => {
    try { for (const ctx of contexts) await ctx.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
    assert.equal(await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'), sourceComposition, 'Loader must not mutate the shared source fixture')
  })
  // Loader writes entry ids and disabled flags: never give it the shared source fixture.
  await copyFile(new URL('./fixtures/cordis.yml', import.meta.url), resolve(root, 'cordis.yml'))
  return {
    root,
    async open(completionEnabled = completion) { const ctx = await boot(root, completionEnabled, config, completionConfig, requestConfig); contexts.add(ctx); return ctx },
    async close(ctx) { await ctx.fiber.dispose(); contexts.delete(ctx) },
  }
}

test('unloading the contribution cancels a live summary and releases session occupancy without a replacement', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  let enter
  const entered = new Promise(resolve => { enter = resolve })
  let summarySignal
  class BlockingAdapter extends ScriptedAdapter {
    async *stream(options) {
      this.requests.push(options)
      if (options.purpose === 'compaction') {
        summarySignal = options.signal
        enter()
        await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }) })
        options.signal.throwIfAborted()
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Continue verified work.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new BlockingAdapter())
  const agent = await ctx.agentLoop.create('unload-summary', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Original saved task. '.repeat(1500))
  await completionTurn(ctx, agent, 'Recent work retained. '.repeat(200))
  await ctx.tools.get('context_rest', agent).execute({ note: 'Keep verified findings and continue.'.padEnd(1200, '…') }, { agent, signal: new AbortController().signal })
  const turn = completionTurn(ctx, agent)
  await entered
  const row = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care/runtime')
  await row.fiber.dispose()
  await turn
  assert.equal(summarySignal.aborted, true)
  assert.equal(ctx.tools.get('context_rest'), undefined)
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 0)
  assert.equal(events.filter(event => event.type === 'compaction/start').length, events.filter(event => event.type === 'compaction/end').length)
})

test('auxiliary prepared requests keep their registration across replacement and compose scoped text once', async t => {
  const owned = await fixture(t, false, { modelScopedPrompts: [{ ruleId: 'summary-only', version: '1', provider: 'care-test',
    model: 'care-test', purposes: ['compaction'], trigger: 'static', text: 'Keep the verified recovery paths.' }] })
  const ctx = await owned.open()
  const original = new ScriptedAdapter()
  const removeOriginal = ctx.llm.registerAdapter(['care-test'], original)
  const agent = await ctx.agentLoop.create('prepared-registration', { provider: 'care-test', model: 'care-test' })
  const signal = new AbortController().signal
  const prepared = await ctx.contextCareRequests.prepareCall({ provider: 'care-test', model: 'care-test', maxTokens: 128 }, signal)
  removeOriginal()
  const replacement = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], replacement)
  const request = { ...prepared.config, sessionId: agent.session.id, purpose: 'compaction', signal,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Summarize verified work.' }] })] }
  const chunks = []
  for await (const chunk of prepared.stream(request)) chunks.push(chunk)
  assert.equal(original.requests.length, 1)
  assert.equal(replacement.requests.length, 0, 'Planning and dispatch must use the same adapter registration')
  assert.equal(original.requests[0].messages.filter(message => message.content.some(block => block.text === 'Keep the verified recovery paths.')).length, 1)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(ctx.contextCareRequests.snapshot(prepared.callId).record.dispatchBasis, 'prepared-stream-handoff')
  assert.equal(agent.session.deriveMessages().some(message => message.content.some(block => block.text === 'Keep the verified recovery paths.')), false)
  assert.throws(() => prepared.stream(request), /already consumed/)
  ctx.contextCareRequests.release(prepared.callId)
})

test('request observation preserves native cancellation and prepares only model configuration', async t => {
  const owned = await fixture(t, false, { modelScopedPrompts: [{ ruleId: 'signal-test', version: '1', provider: 'care-test',
    model: 'care-test', trigger: 'static', text: 'Preserve the current task.' }] })
  const ctx = await owned.open()
  class CancellationAdapter extends ScriptedAdapter {
    async *stream(options) {
      this.upstream = AbortSignal.any([options.signal, new AbortController().signal])
      yield* super.stream(options)
    }
  }
  const adapter = new CancellationAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('native-cancellation', { provider: 'care-test', model: 'care-test' })
  const caller = new AbortController()
  const request = Object.freeze({ provider: 'care-test', model: 'care-test', sessionId: agent.id, signal: caller.signal,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue safely.' }] })] })
  const preparedConfigs = []
  const prepare = ctx.llm.prepareCall.bind(ctx.llm)
  ctx.llm.prepareCall = (config, signal) => { preparedConfigs.push(config); return prepare(config, signal) }
  const chunks = []
  for await (const chunk of ctx.llm.stream(request)) chunks.push(chunk)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(adapter.requests[0].signal, caller.signal)
  assert.deepEqual(preparedConfigs, [{ provider: 'care-test', model: 'care-test' }])
  assert.equal(adapter.requests[0].messages.at(-1).content[0].text, 'Preserve the current task.')
  const reason = new Error('Caller stopped this exact request')
  caller.abort(reason)
  assert.equal(adapter.upstream.aborted, true)
  assert.equal(adapter.upstream.reason, reason)
  assert.equal(request.signal, caller.signal)
})

test('operation prices keep captured calibration and image projection across adapter and usage changes', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  let imagePrices = 0
  const firstPricing = { priceImages: images => { imagePrices++; return images.map(() => ({ visualTokens: 100, text: 'Captured image handle' })) } }
  const nextPricing = { priceImages: images => images.map(() => ({ visualTokens: 1000, text: 'New image handle'.repeat(50) })) }
  class PricingAdapter extends ScriptedAdapter {
    pricing = firstPricing
    imageRequestPricing() { return this.pricing }
  }
  const adapter = new PricingAdapter()
  ctx.llm.registerAdapter(['care-pricing'], adapter)
  const session = Session.create('care-pricing-session')
  const header = { config: { provider: 'care-pricing', model: 'vision' }, tools: [{ name: 'example', description: 'A real schema price', parameters: { type: 'object' } }] }
  const image = { type: 'image', attachment: { attachmentId: 'sha256:12345678', name: 'capture.png', width: 800, height: 800, bytes: 2048, mediaType: 'image/png' } }
  const message = createUserMessage({ source: { kind: 'user' }, content: [
    { type: 'text', text: 'Compare the original prices.' }, image, image,
    { type: 'file', attachment: { attachmentId: 'sha256:abcdef12', name: 'records.txt', bytes: 100 } },
  ] })
  session.append('user/message', message, { surfaceOp: 'append' })
  const estimates = t.mock.method(ctx.tokenMeter, 'estimateMessage'), fileReads = t.mock.method(ctx.llm, 'fileRequestText')
  const derives = t.mock.method(session, 'deriveEventMessage')
  const rawPricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session, header })
  assert.equal(estimates.mock.callCount(), 1, 'capture only estimates role framing, not all retained messages')
  assert.equal(imagePrices, 0, 'file prewarm must not invoke provider image pricing')
  assert.equal(fileReads.mock.callCount(), 1)
  const projected = derives.mock.callCount()
  captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session, header })
  assert.equal(derives.mock.callCount(), projected, 'another operation borrows the unchanged file attachment projection')
  assert.equal(estimates.mock.callCount(), 2); assert.equal(imagePrices, 0)
  assert.equal(fileReads.mock.callCount(), 2, 'path-dependent file text is frozen separately at each operation')
  const raw = rawPricing.priceRequest({ messages: [message], tools: header.tools })
  const calibrationRecords = []
  const calibration = { calibration: (_session, selectedHeader, basis) => journalCalibration(calibrationRecords, selectedHeader, basis) }
  function usageCall(inputTokens, step) {
    const rawInput = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session, header }).decomposeRequest({ messages: session.deriveMessages(), tools: header.tools })
    calibrationRecords.push({ kind: 'request', data: { purpose: 'conversation', dispatched: true, outcome: 'completed',
      eventType: 'assistant/message', eventSeq: session.seq, rawInput, usage: { inputTokens }, calibrationHeaderKey: calibrationHeaderKey(header) } })
    session.append('step/start', { turn: 1, step })
    session.append('request/header', { header, reason: 'initial' })
    session.append('assistant/message', { turn: 1, step, stream: [], usage: { inputTokens, outputTokens: 99999 },
      message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-pricing', model: 'vision' }, content: [{ type: 'text', text: 'A saved answer.' }] }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step })
  }
  usageCall((raw - 200) * 3 + 200, 1)
  const pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session, requests: calibration })
  assert.equal(pricing.pricingBasis.textScale, 3)
  assert.equal(pricing.measure().inputTokens, pricing.priceRequest({ messages: session.deriveMessages(), tools: header.tools }))
  const request = { messages: [message], tools: header.tools, system: 'One-shot system' }
  const before = pricing.priceRequest(request)
  const parts = pricing.decomposeRequest(request)
  assert.equal(before, parts.textTokens * 3 + parts.visualTokens)
  adapter.pricing = nextPricing
  usageCall(50000, 2)
  const repriced = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session, requests: calibration })
  assert.notEqual(repriced.pricingBasis.textScale, 3)
  assert.notEqual(repriced.priceRequest(request), before)
  assert.equal(pricing.priceRequest(request), before)
  assert.equal(pricing.measure().pricingBasis, pricing.pricingBasis)
  assert.equal(pricing.measure().logRevision, session.seq)
  // Dispatch can explicitly bind absence, even if the route currently declares images.
  const absent = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session, imageRequestPricing: undefined })
  const imageOnly = createUserMessage({ source: { kind: 'user' }, content: [image] })
  assert.equal(absent.priceMessages([imageOnly]), ctx.tokenMeter.estimateMessage(imageOnly) * absent.pricingBasis.textScale)
})

test('structured summary image failure delegates then records selected oldest omissions through the real projection', async t => {
  const owned = await fixture(t, true, { retainTokens: 600 })
  const ctx = await owned.open()
  class ImagesAdapter extends ScriptedAdapter {
    imageRequestPricing() { return { priceImages: images => images.map(image => ({ visualTokens: image.offloaded ? 0 : 4000, text: 'Image reference' })) } }
    async *stream(options) {
      this.requests.push(options)
      if (options.purpose === 'compaction') {
        const images = options.messages.flatMap(message => message.content.filter(block => block.type === 'image' && !block.offloaded))
        if (images.length > 1) {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'IMAGE_OFFLOAD_REQUIRED', message: 'Omit one oldest image', offloadImages: 1 } } }
          return
        }
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Verified image comparison and outstanding work.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new ImagesAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('image-repair', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Set up image comparison.')
  const image = { type: 'image', attachment: { attachmentId: 'sha256:12345678', name: 'capture.png', width: 800, height: 800, bytes: 2048, mediaType: 'image/png' } }
  const selected = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Earlier comparison task. '.repeat(500) }, image, image] }), { surfaceOp: 'append' })
  const tail = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep recent task. '.repeat(500) }] }), { surfaceOp: 'append' })
  await ctx.tools.get('context_rest', agent).execute({ note: 'Compare remaining image and continue.'.padEnd(1200, '…') }, { agent, signal: new AbortController().signal })
  await completionTurn(ctx, agent)
  const events = agent.session.snapshotEvents()
  const offloads = events.filter(event => event.type === 'image/offload')
  assert.equal(offloads.length, 1)
  assert.deepEqual(offloads[0].data.targets, [{ seq: selected.seq, imageIndexes: [0] }])
  const summaries = adapter.requests.filter(request => request.purpose === 'compaction')
  assert.equal(summaries.length, 2)
  assert.equal(summaries[1].messages.flatMap(message => message.content.filter(block => block.type === 'image' && !block.offloaded)).length, 1)
  assert.ok(agent.session.surface.nodes.includes(tail.seq))
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 1)
  assert.ok(ctx.contextCareRequests.list(agent.session.id).some(record => record.data.phase === 'repaired' && record.data.afterSummaryInput < record.data.beforeSummaryInput))
})

test('natural rest merges two old checkpoints, records recursive coverage and preserves the task fixture for continuation', async t => {
  const owned = await fixture(t, true, { retainTokens: 600, minFreshTokens: 1000 })
  const ctx = await owned.open()
  class FactsAdapter extends ScriptedAdapter {
    async *stream(options) {
      if (options.purpose !== 'compaction') { yield* super.stream(options); return }
      this.requests.push(options)
      const body = options.messages.flatMap(message => message.content.map(block => block.text ?? '')).join('\n')
      const facts = ['Original requirement: finish report.', 'Correction: exclude the obsolete conclusion.', 'Pending job: verify D:/dev/work.md.'].filter(fact => body.includes(fact))
      yield { type: 'block-end', index: 0, block: { type: 'text', text: facts.join('\n') } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new FactsAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('checkpoint-merge', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Original requirement: finish report. '.repeat(400))
  const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests, spec: resolveConfig() })
  let sources = agent.session.surface.nodes.slice(1)
  await compact(ctx.compaction, { start: sources[0], end: sources.at(-1) }, agent, new AbortController().signal,
    captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }))
  const correction = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Correction: exclude the obsolete conclusion. Pending job: verify D:/dev/work.md. '.repeat(400) }] }), { surfaceOp: 'append' })
  await compact(ctx.compaction, { start: correction.seq, end: correction.seq }, agent, new AbortController().signal,
    captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }))
  const parents = agent.session.surface.nodes.slice(1)
  const tail = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Recent retained work. '.repeat(500) }] }), { surfaceOp: 'append' })
  await ctx.tools.get('context_rest', agent).execute({ note: 'Continue from the two verified checkpoints.'.padEnd(1200, '…') }, { agent, signal: new AbortController().signal })
  await completionTurn(ctx, agent)
  const summaries = agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')
  assert.equal(summaries.length, 3)
  assert.deepEqual(summaries.at(-1).data.shadowedSeqs, parents)
  assert.ok(agent.session.surface.nodes.includes(tail.seq))
  const records = ctx.contextCareRequests.list(agent.session.id)
  assert.ok(records.some(record => record.data.rule === 'checkpoint-merge' && record.data.phase === 'planning'))
  const merged = records.filter(record => record.data.phase === 'committed' && record.data.coverage).at(-1).data.coverage
  assert.equal(merged.depth, 2)
  assert.deepEqual(merged.parentCheckpointSeqs, parents)
  assert.ok(merged.leafSeqs.includes(correction.seq))
  const visible = adapter.requests.at(-1).messages.flatMap(message => message.content.map(block => block.text ?? '')).join('\n')
  for (const fact of ['Original requirement: finish report.', 'Correction: exclude the obsolete conclusion.', 'Pending job: verify D:/dev/work.md.', 'Recent retained work.', 'Continue from the two verified checkpoints.']) assert.ok(visible.includes(fact), fact)
})

test('summary planner fits the complete auxiliary request and preserves a balanced recent tail', async t => {
  const owned = await fixture(t, true, { summary: { provider: 'care-summary', model: 'small', maxTokens: 128, maxRetries: 0 },
    modelScopedPrompts: [{ ruleId: 'summary-only', version: '1', provider: 'care-summary', model: 'small', purposes: ['compaction'],
      trigger: 'static', text: '只保留已核对的事实与尚未完成的工作。'.repeat(1600) }] })
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('small-summary', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Earlier verified work. '.repeat(400))
  for (let index = 0; index < 3; index++) agent.session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: `Work unit ${index}. `.repeat(800) }],
  }), { surfaceOp: 'append' })
  const selected = agent.session.surface.nodes.slice(1, -1)
  const pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const proposed = { provider: 'care-summary', model: 'small', maxTokens: 128 }
  // Enough space for exactly the shorter prefix, including the system, schemas
  // and directive. The full selected prefix is deliberately larger.
  const shorter = selected.slice(0, -1)
  const summaryPrice = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session,
    header: { config: proposed, tools: agent.session.requestHeader().tools } })
  const capacity = Math.ceil(summaryPrice.priceRequest(ctx.contextCareRequests.preview(agent.session, buildSummaryRequest(agent.session, shorter, proposed, new AbortController().signal, ensureSessionLog(ctx))).request)) + 128
  class SmallAdapter extends ScriptedAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: capacity } } }
  }
  const small = new SmallAdapter()
  ctx.llm.registerAdapter(['care-summary'], small)
  const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
    spec: resolveConfig({ summary: proposed, minFreshTokens: 100 }) })
  const tail = agent.session.surface.nodes.at(-1)
  const result = await compact(ctx.compaction, { start: selected[0], end: selected.at(-1) }, agent, new AbortController().signal, pricing)
  assert.deepEqual(result.shadowedSeqs, shorter)
  assert.ok(agent.session.surface.nodes.includes(selected.at(-1)))
  assert.ok(agent.session.surface.nodes.includes(tail))
  assert.ok(result.afterInput < result.beforeInput)
  assert.equal(small.requests.length, 1)
  const actual = small.requests[0]
  assert.equal(actual.maxTokens, 128)
  assert.ok(summaryPrice.priceRequest(actual) + actual.maxTokens <= capacity)
  assert.ok(actual.tools.length > 0)
  const event = agent.session.eventAt(result.summarySeq)
  assert.equal(event.data.shadowedTokenCount, result.shadowedSeqs.reduce((sum, seq) => sum + ctx.tokenMeter.estimateMessage(agent.session.deriveEventMessage(agent.session.eventAt(seq))), 0))
  const replay = Session.create('small-summary-replay', agent.session.snapshotEvents(), undefined, undefined, ctx.sessions.messageProjections)
  assert.deepEqual(replay.deriveMessages(), agent.session.deriveMessages())
})

test('a custom summary provider is rechecked after its audit acknowledgement', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Work continues.' }] }]))
  const agent = await ctx.agentLoop.create('summary-toggle-before-provider', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Verified prefix. '.repeat(100))
  let active = true
  let called = false
  const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm,
    requests: { ...ctx.contextCareRequests, async recordAction(...args) {
      await ctx.contextCareRequests.recordAction(...args)
      active = false
    } }, spec: resolveConfig({}), eligible: () => active })
  const pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const seqs = agent.session.surface.nodes
  await assert.rejects(compact({ compactRegion() { called = true } }, { start: seqs[0], end: seqs.at(-1) }, agent,
    new AbortController().signal, pricing), { code: 'CONTROL_DISABLED' })
  assert.equal(called, false)
})

test('summary overflow shrinks its candidate once and a changed surface closes without replacement', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('summary-retry', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Verified prefix. '.repeat(800))
  for (let index = 0; index < 3; index++) agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: `Large item ${index}. `.repeat(600) }] }), { surfaceOp: 'append' })
  class RetryAdapter extends ScriptedAdapter {
    tries = 0
    async *stream(options) {
      if (this.tries++ === 0) {
        this.requests.push(options)
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'Auxiliary input was underestimated' } } }
      } else yield* super.stream(options)
    }
  }
  const summary = new RetryAdapter()
  const offSummary = ctx.llm.registerAdapter(['care-summary'], summary)
  const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
    spec: resolveConfig({ summary: { provider: 'care-summary', model: 'summary', maxTokens: 100, maxRetries: 1 } }) })
  let seqs = agent.session.surface.nodes.slice(1, -1)
  let pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const result = await compact(ctx.compaction, { start: seqs[0], end: seqs.at(-1) }, agent, new AbortController().signal, pricing)
  assert.equal(summary.requests.length, 2)
  assert.ok(summary.requests[1].messages.length < summary.requests[0].messages.length)
  assert.deepEqual(result.shadowedSeqs, seqs.slice(0, -1))
  assert.equal(ctx.contextCareRequests.snapshot(summary.requests[0].callId), undefined)
  for (let index = 0; index < 2; index++) agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'New verified work. '.repeat(500) }] }), { surfaceOp: 'append' })
  class MutatingAdapter extends ScriptedAdapter {
    async *stream(options) {
      agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Arrived during summary' }] }), { surfaceOp: 'append' })
      yield* super.stream(options)
    }
  }
  offSummary()
  ctx.llm.registerAdapter(['care-summary'], new MutatingAdapter())
  seqs = agent.session.surface.nodes.slice(1, -1)
  pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const replacements = agent.session.snapshotEvents().filter(event => event.surfaceOp?.op === 'replace').length
  await assert.rejects(compact(ctx.compaction, { start: seqs[0], end: seqs.at(-1) }, agent, new AbortController().signal, pricing), { code: 'SUMMARY_SURFACE_CHANGED' })
  assert.equal(agent.session.snapshotEvents().filter(event => event.surfaceOp?.op === 'replace').length, replacements)
  assert.match(agent.session.snapshotEvents().at(-1).data.error, /input changed before commit/)
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter(event => event.type === 'compaction/start').length, events.filter(event => event.type === 'compaction/end').length)
})

test('summary repair rebases replaced endpoints, preserves the original failure without progress, and obeys explicit caps', async t => {
  const secondaryReports = []
  t.mock.method(console, 'error', (...args) => secondaryReports.push(args))
  for (const mode of ['endpoint', 'noop', 'outside', 'repair-cap', 'call-cap', 'repair-audit-fails', 'settlement-fails', 'repair-throws', 'end-fails']) {
    const owned = await fixture(t)
    const ctx = await owned.open()
    ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
    const agent = await ctx.agentLoop.create(`repair-${mode}`, { provider: 'care-test', model: 'care-test' })
    await completionTurn(ctx, agent, 'Original requirement: preserve D:/dev/work.md. '.repeat(300))
    const first = agent.session.surface.nodes[1]
    agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Later correction, obsolete decision and pending job. '.repeat(500) }] }), { surfaceOp: 'append' })
    const last = agent.session.surface.nodes.at(-1)
    const tail = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Recent retained tail' }] }), { surfaceOp: 'append' })
    class RepairAdapter extends ScriptedAdapter {
      tries = 0
      async *stream(options) {
        if (this.tries++ === 0) {
          this.requests.push(options)
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'REPAIR_NEEDED', message: 'Original selected input needs repair' } } }
        } else yield* super.stream(options)
      }
    }
    const adapter = new RepairAdapter()
    ctx.llm.registerAdapter(['repair-summary'], adapter)
    let hooks = 0
    ctx.on('compaction/summary-error', ({ session, sourceEventSeqs }, next) => {
      hooks++
      if (mode === 'repair-throws') throw new Error('Repair listener failed')
      if (['noop', 'settlement-fails', 'end-fails'].includes(mode)) return true
      const selected = mode === 'outside' ? tail.seq : sourceEventSeqs.at(-1)
      const replacement = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Corrected pending job: verify D:/dev/work.md.' }] })
      session.append('user/message', replacement, { surfaceOp: { op: 'replace', startSeq: selected, endSeq: selected }, sourceEventSeqs: [selected] })
      return true
    })
    if (mode === 'end-fails') {
      const append = agent.session.append.bind(agent.session)
      agent.session.append = (type, data, options) => { if (type === 'compaction/end') throw new Error('End append failed'); return append(type, data, options) }
    }
    const requests = { ...ctx.contextCareRequests,
      settle: mode === 'settlement-fails' ? async () => { throw new Error('Settlement audit failed') } : ctx.contextCareRequests.settle,
      recordAction: async (session, data) => { if (mode === 'repair-audit-fails' && data.phase === 'repaired') throw new Error('Repair audit failed'); return ctx.contextCareRequests.recordAction(session, data) },
    }
    const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, requests,
      spec: resolveConfig({ minFreshTokens: 100, summary: { provider: 'repair-summary', model: 'summary', maxTokens: 100, maxRetries: 0 },
        ...(mode === 'repair-cap' ? { maxSummaryRepairRetries: 0 } : {}), ...(mode === 'call-cap' ? { maxSummaryCallsPerAction: 1 } : {}) }),
      recover: payload => ctx.waterfall('compaction/summary-error', payload, () => false) })
    const pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
    const run = () => compact(ctx.compaction, { start: first, end: last }, agent, new AbortController().signal, pricing)
    if (mode === 'endpoint') {
      const result = await run()
      assert.equal(adapter.requests.length, 2)
      assert.ok(!result.shadowedSeqs.includes(last))
      assert.ok(result.shadowedSeqs.includes(first))
      assert.ok(agent.session.surface.nodes.includes(tail.seq))
      assert.match(adapter.requests[1].messages.map(message => message.content.map(block => block.text ?? '').join('')).join('\n'), /Corrected pending job: verify D:\/dev\/work.md/)
      assert.ok(ctx.contextCareRequests.list(agent.session.id).some(record => record.kind === 'maintenance' && record.data.phase === 'repaired'))
    } else {
      await assert.rejects(run(), { code: 'REPAIR_NEEDED', message: 'Original selected input needs repair' })
      assert.equal(adapter.requests.length, 1)
      assert.equal(hooks, mode === 'repair-cap' ? 0 : 1)
      assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
    }
    const events = agent.session.snapshotEvents()
    assert.equal(events.filter(event => event.type === 'compaction/start').length, events.filter(event => event.type === 'compaction/end').length + (mode === 'end-fails' ? 1 : 0))
  }
  assert.deepEqual(secondaryReports.map(args => args[1].message), ['Repair audit failed', 'Settlement audit failed', 'Repair listener failed', 'End append failed'])
})

test('summary uses calibrated replacement cost and retains history when the framed text is larger', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('summary-calibration', { provider: 'care-vision', model: 'vision' })
  const imagePricing = { priceImages: images => images.map(() => ({ visualTokens: 300, text: 'Image handle' })) }
  class VisionAdapter extends ScriptedAdapter { imageRequestPricing() { return imagePricing } }
  ctx.llm.registerAdapter(['care-vision'], new VisionAdapter())
  const image = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: {
    attachmentId: 'sha256:calibrated', name: 'work.png', width: 800, height: 800, bytes: 100, mediaType: 'image/png',
  } }] })
  agent.session.append('user/message', image, { surfaceOp: 'append' })
  const header = { config: { provider: 'care-vision', model: 'vision' } }
  const raw = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, header }).priceMessages([image])
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('request/header', { header, reason: 'initial' })
  agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: (raw - 300) * 4 + 300, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-vision', model: 'vision' }, content: [{ type: 'text', text: 'Recent tail' }] }),
  }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: 1, step: 1 })
  const rawInput = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, header }).decomposeRequest({ messages: [image] })
  const calibrationRecords = [{ kind: 'request', data: { purpose: 'conversation', dispatched: true, outcome: 'completed',
    eventType: 'assistant/message', eventSeq: agent.session.seq - 2, rawInput, usage: { inputTokens: (raw - 300) * 4 + 300 }, calibrationHeaderKey: calibrationHeaderKey(header) } }]
  const pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session,
    requests: { calibration: (_session, selectedHeader, basis) => journalCalibration(calibrationRecords, selectedHeader, basis) } })
  assert.equal(pricing.pricingBasis.textScale, 4)
  class LongSummary extends ScriptedAdapter {
    async *stream(options) {
      const block = { type: 'text', text: 'Structured checkpoint.'.repeat(15) }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-summary'], new LongSummary())
  const replacement = createUserMessage({ source: { kind: 'plugin:checkpoint' }, content: frameSummary([{ type: 'text', text: 'Structured checkpoint.'.repeat(15) }]) })
  assert.ok(ctx.tokenMeter.estimateMessage(replacement) < pricing.priceMessages([image]), 'Fixed replacement heuristic would falsely pass')
  assert.ok(pricing.priceMessages([replacement]) >= pricing.priceMessages([image]))
  const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
    spec: resolveConfig({ summary: { provider: 'care-summary', model: 'summary', maxTokens: 1000 }, minFreshTokens: 1 }) })
  const seq = agent.session.surface.nodes[0]
  await assert.rejects(compact(ctx.compaction, { start: seq, end: seq }, agent, new AbortController().signal, pricing), { code: 'SUMMARY_NOT_SMALLER' })
  assert.ok(agent.session.surface.nodes.includes(seq))
  assert.equal(agent.session.snapshotEvents().some(event => event.surfaceOp?.op === 'replace'), false)
  assert.equal(agent.session.snapshotEvents().at(-1).type, 'compaction/end')
})

test('native rejected summary survives empty caches and native JSONL in a fresh Host', async t => {
  const first = await fixture(t, false)
  const ctx = await first.open()
  let summaryCalls = 0
  class NonShrinking extends ScriptedAdapter {
    async *stream() {
      summaryCalls++
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'A larger checkpoint. '.repeat(120) } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  ctx.llm.registerAdapter(['care-summary'], new NonShrinking())
  const agent = await ctx.agentLoop.create('summary-native-reject', { provider: 'care-test', model: 'care-test' })
  const material = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Keep this verified task.' }] }), { surfaceOp: 'append' })
  const spec = resolveConfig({ summary: { provider: 'care-summary', model: 'summary', maxTokens: 1000 }, minFreshTokens: 1 })
  const operation = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const proposal = { start: material.seq, end: material.seq, sourceSeqs: [material.seq], rule: 'fresh-summary', comparisons: [] }
  const service = { config: {} }, signal = new AbortController().signal
  const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests, spec })
  const execute = createProposalExecutor(ctx.contextCareRequests, compact, ensureSessionLog(ctx))
  await assert.rejects(execute(service, proposal, agent, signal, operation, spec, 'requested'), { code: 'SUMMARY_NOT_SMALLER' })
  assert.equal(await execute(service, proposal, agent, signal, operation, spec, 'requested'), null)
  assert.equal(summaryCalls, 1)
  let rerun = false
  const reconfigured = createProposalExecutor(ctx.contextCareRequests, async () => { rerun = true; return 'summary policy changed' }, ensureSessionLog(ctx))
  const changed = resolveConfig({ summary: { provider: 'care-summary', model: 'summary', maxTokens: 2000 }, minFreshTokens: 1 })
  assert.equal(await reconfigured(service, proposal, agent, signal, operation, changed, 'requested'), 'summary policy changed')
  assert.equal(rerun, true)
  const log = await ctx.sessionQuery.readSession(agent.id)
  const start = log.events.find(event => event.type === 'compaction/start')
  const end = log.events.find(event => event.type === 'compaction/end')
  assert.equal(start.data.contextCareSummary.format, 'context-care/summary-proposal/v1')
  assert.equal(end.data.contextCareSummary.proposalKey, start.data.contextCareSummary.proposalKey)
  assert.equal(end.data.contextCareSummary.failureCode, 'SUMMARY_NOT_SMALLER')
  const seed = { header: agent.session.header, events: log.events, inheritedEventCount: log.inheritedEventCount }
  await first.close(ctx)

  const second = await fixture(t, false)
  const cold = await second.open()
  await cold.loader.create({ name: '@deepseek-ai/dsh-session-persistence-jsonl',
    config: { root: resolve(second.root, 'session-logs'), compression: 'none' } })
  await cold.loader.await()
  for (const entry of cold.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl') await entry.fiber.await()
  const handle = await cold.sessionPersistence.create(seed.header, { inheritedEventCount: seed.inheritedEventCount })
  try { await handle.append(seed.events); await handle.flush() } finally { await handle.close() }
  cold.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const doc = await cold.sessionQuery.readSession(agent.id)
  const detached = cold.sessions.prepare(agent.id, { seed: doc.events, meta: doc.session,
    inheritedEventCount: doc.inheritedEventCount, eventState: 'detached' })
  const after = captureInputPricing({ history: ensureSessionLog(cold), meter: cold.tokenMeter, llm: cold.llm, session: detached })
  assert.equal(cold.contextCareRequests.list(agent.id).length, 0, 'no action side records are available to decide rejection')
  const coldExecute = createProposalExecutor(cold.contextCareRequests, async () => {
    throw new Error('a rejected proposal must not call the summary executor again')
  }, ensureSessionLog(cold))
  assert.equal(await coldExecute(service, proposal, { session: detached }, signal, after, spec, 'requested'), null)
  assert.equal(cold.sessions.list().length, 0)
  assert.equal(cold.agents.list().length, 0)
})

class CompletionAdapter extends LlmAdapter {
  constructor(outputs) { super(); this.outputs = outputs }
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
  async *stream() {
    const output = this.outputs.shift()
    assert.ok(output, 'Unexpected extra model request')
    for (const [index, block] of output.blocks.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }
      if (block.type === 'reasoning') yield { type: 'reasoning-delta', index, text: block.text }
      yield { type: 'block-end', index, block }
    }
    yield { type: 'finish', reason: output.reason ?? { kind: 'stop' } }
  }
}

registerCompletionReplayCases({ async open(t, outputs, seed, fork = false) {
  const owned = await fixture(t, true, {}, { maxDeliveries: 2 })
  const ctx = await owned.open()
  class RecordingCompletionAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) { this.requests.push(request); yield* super.stream() }
  }
  const adapter = new RecordingCompletionAdapter(outputs.map(output => ({ blocks: output.blocks,
    ...(output.failure ? { reason: { kind: 'error', failure: output.failure } } : {}) })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const options = { provider: 'care-test', model: 'care-test' }
  const agent = seed ? (await ctx.agents.create(fork
    ? { sessionId: seed.id + '-fork', seed: buildForkSeed(seed.events, seed.events.at(-1).seq),
      inheritedEventCount: seed.events.length, meta: { isSeeded: true, parentSession: seed.id }, agentOptions: options }
    : { sessionId: seed.id, seed: seed.events, inheritedEventCount: seed.inheritedEventCount,
      meta: seed.meta, agentOptions: options })).agent
    : await ctx.agentLoop.create('native-completion-replay', options)
  return {
    turn: () => completionTurn(ctx, agent),
    notices: () => ctx.contextCareCompletion.list(agent.id),
    clear: () => ctx.contextCareCompletion.clear(),
    requests: () => adapter.requests,
    async seed() {
      await ctx.sessions.flush(agent.session)
      const log = await ctx.sessionQuery.readSession(agent.id), path = resolve(owned.root, 'completion-replay-seed.json')
      await writeFile(path, JSON.stringify({ id: agent.id, events: log.events, inheritedEventCount: log.inheritedEventCount,
        meta: { isSeeded: agent.session.header.isSeeded,
          ...(agent.session.header.parentSession ? { parentSession: agent.session.header.parentSession } : {}) } }))
      return JSON.parse(await readFile(path, 'utf8'))
    },
  }
} })

registerDeliveryReplayCases({ async open(t, source, seed, fork = false, detector) {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open(), runtime = ctx.get('reminderRules')
  if (detector) ctx.effect(() => runtime.registerDetector(detector))
  ctx.effect(() => runtime.registerSource(source).dispose)
  const adapter = new CompletionAdapter(Array.from({ length: 20 }, () => ({
    blocks: [{ type: 'text', text: 'Continue after the recorded delivery.' }],
  })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const options = { provider: 'care-test', model: 'care-test' }
  const agent = seed ? (await ctx.agents.create(fork
    ? { sessionId: seed.id + '-fork', seed: buildForkSeed(seed.events, seed.events.at(-1).seq),
      inheritedEventCount: seed.events.length, meta: { isSeeded: true, parentSession: seed.id }, agentOptions: options }
    : { sessionId: seed.id, seed: seed.events, inheritedEventCount: seed.inheritedEventCount,
      meta: seed.meta, agentOptions: options })).agent
    : await ctx.agentLoop.create('delivery-replay', options)
  const log = () => ctx.sessionQuery.readSession(agent.id)
  // Observe the real methods without replacing their behavior.
  const reads = t.mock.method(ctx.sessionQuery, 'observeSession')
  let stateWrites = 0
  ctx.on('domain/changed', change => { if (change.domain === 'context_care_reminders') stateWrites++ })
  const clock = createSessionDeliveries(ctx)
  ctx.on('session/event', (session, event) => clock.observe(session, event))
  ctx.effect(() => () => clock.close())
  return {
    async collectOnly() { return (await runtime.collect({ sessionId: String(agent.id), visible: agent.session.deriveMessages() })).length },
    async reserveElsewhere() {
      const competitor = (await ctx.agents.create({ sessionId: String(agent.id) + '-competitor', agentOptions: options })).agent
      await runtime.submit({ sessionId: String(competitor.id), callId: 'competing', rootCallId: 'competing',
        name: 'replay_probe', arguments: { marker: 'competitor' } })
      const accepted = competitor.inbox.claim('next-step', 0)
      const messages = await runtime.collect({ sessionId: String(competitor.id), visible: competitor.session.deriveMessages(), accepted })
      assert.equal(messages.length, 1)
      competitor.inject(messages[0])
      return async () => { assert.equal(competitor.inbox.remove(messages[0].id), true) }
    },
    cancelQueued() { agent.cancel({ kind: 'hook', reason: 'Cancel the queued test input.' }) },
    humanTurn: () => clock.humanTurn(String(agent.id)),
    historyReadCount: () => reads.mock.callCount(),
    stateWriteCount: () => stateWrites,
    async turn(human = true, count = 1) {
      for (let index = 0; index < count; index++) {
        const message = createUserMessage({ content: [{ type: 'text', text: 'Continue the replay case.' }],
          source: human ? { kind: 'user' } : { kind: 'plugin:dsh-context-care:test-continuation' } })
        if (index < count - 1) agent.inject(message)
        else agent.followup(message)
      }
      await agent.whenIdle(); await runtime.settle(String(agent.id))
    },
    async trigger(id, marker) {
      await runtime.submit({ sessionId: String(agent.id), callId: id, rootCallId: id,
        name: 'replay_probe', arguments: { marker } })
    },
    async queueReminder() {
      await runtime.settle(String(agent.id))
      assert.equal(agent.inbox.nextStep.filter(message => message.source.kind === 'plugin:dsh-context-care:reminder').length, 1,
        'the completed unlogged match already belongs to the real inbox')
    },
    async seed() {
      const path = resolve(owned.root, 'delivery-seed.json')
      const history = await log()
      await writeFile(path, JSON.stringify({ id: agent.id, events: history.events,
        inheritedEventCount: history.inheritedEventCount, meta: { isSeeded: agent.session.header.isSeeded,
          ...(agent.session.header.parentSession ? { parentSession: agent.session.header.parentSession } : {}) } }))
      return JSON.parse(await readFile(path, 'utf8'))
    },
    async notices() {
      return (await log()).events.filter(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin:dsh-context-care:reminder').map(event =>
        event.data.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    },
    async hideNotice() {
      const original = (await log()).events.find(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin:dsh-context-care:reminder')
      assert.ok(original)
      agent.session.append('user/message', createUserMessage({ source: { kind: 'plugin:dsh-context-care:test-replacement' },
        content: [{ type: 'text', text: 'The earlier reminder has been compacted from the surface.' }] }),
      { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
      assert.equal(agent.session.deriveMessages().some(message => message.id === original.data.id), false)
    },
    async storedDerived() {
      assert.equal((await readdir(owned.root)).includes('context_care_reminders'), false, 'production never opens the retired candidate domain')
      return { windows: 0, stickies: 0 }
    },
    activeStickies: () => runtime.snapshot(String(agent.id)).stickies.length,
    async setModelEnabled(enabled) {
      const controls = ctx.contextCareControls
      for (const rule of source.rules) await controls.patch(agent.id, { revision: controls.revision(agent.id),
        sourceId: source.sourceId, ruleId: rule.id, actionId: 'model', enabled })
    },
    async snooze() {
      adapter.outputs.unshift({ blocks: [{ type: 'tool-call', id: 'real-snooze', name: 'reminder_snooze', arguments: '{}' }] })
      await completionTurn(ctx, agent); await runtime.settle(String(agent.id))
    },
  }
} })

registerScopeHostCases({ async exercise(t, scenario) {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open(), service = ctx.get('reminderRules')
  ctx.effect(() => service.registerSource({ sourceId: 'scope-case', plugin: 'test', revision: 1,
    ...(scenario.sourceScope ? { scope: scenario.sourceScope } : {}), rules: [{
      format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'SCOPED_HEADER_NOTICE',
      ...(scenario.ruleScope ? { scope: scenario.ruleScope } : {}), when: { tool: 'scope_probe' },
      effect: { kind: 'remind', deliver: { model: { once: 'surface', ...(scenario.sharedLimit === undefined ? {} : {
        shared: { reset: 'lifetime', lifetime: 'scope-campaign', limit: scenario.sharedLimit },
      }) } } },
    }] }).dispose)
  class ScopeAdapter extends CompletionAdapter {
    requests = new Map()
    async *stream(request) { this.requests.set(request.sessionId, JSON.stringify(request.messages)); yield* super.stream(request) }
  }
  const adapter = new ScopeAdapter(Array.from({ length: 4 }, () => ({ blocks: [{ type: 'text', text: 'Done.' }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const definitions = [{ id: 'scope-alpha-one', preset: 'alpha' }, { id: 'scope-alpha-two', preset: 'alpha' },
    { id: 'scope-beta', preset: 'beta' }, { id: 'scope-unassigned' }]
  const handles = await Promise.all(definitions.map(({ id, preset }) => ctx.agents.create({
    sessionId: id, agentOptions: { provider: 'care-test', model: 'care-test' },
    ...(preset === undefined ? {} : { meta: { agentPreset: preset } }),
  })))
  const agents = handles.map(handle => handle.agent)
  // Contradictory event hints exercise the Host resolver, not a fabricated header.
  await Promise.all(agents.map(agent => service.submit({ sessionId: agent.id,
    agentPreset: agent.session.header.agentPreset === 'alpha' ? 'beta' : 'alpha',
    callId: `scope:${agent.id}`, rootCallId: `scope:${agent.id}`, name: 'scope_probe', arguments: {},
  })))
  // A matched candidate is pending until it is handed to the native inbox, then reserved.
  const pending = new Map(agents.map(agent => [agent.id, service.snapshot(agent.id).candidates
    .filter(candidate => candidate.status === 'pending' || candidate.status === 'reserved').length]))
  await Promise.all(agents.map(agent => completionTurn(ctx, agent)))
  const recipients = await Promise.all(agents.map(async agent => {
    assert.equal(ctx.sessions.get(agent.id), agent.session)
    const request = adapter.requests.get(agent.id)
    assert.equal(typeof request, 'string', `Missing request for ${agent.id}`)
    return { id: agent.id, preset: agent.session.header.agentPreset,
      catalogRules: (await service.catalog(agent.id)).reduce((total, source) => total + source.rules.length, 0),
      pendingBeforeTurn: pending.get(agent.id),
      notices: agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && event.data.source?.kind === 'plugin:dsh-context-care:reminder').length,
      requestHasNotice: request.includes('SCOPED_HEADER_NOTICE') }
  }))
  const claims = agents.reduce((total, agent) => total + agent.session.snapshotEvents().filter(event =>
    event.type === 'user/message' && event.data.source?.kind === 'plugin:dsh-context-care:reminder'
    && event.data.source.reminder.shared !== null).length, 0)
  await owned.close(ctx)
  return { recipients, claims }
} })

registerReminderHostCases({ async create(t, stream, maxInterrupts = 1) {
  const owned = await fixture(t, false, {}, {}, { reminders: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000,
    streamFlushMs: 5, streamEveryChars: 256, maxInterruptsPerTurn: maxInterrupts } })
  const ctx = await owned.open()
  class OutputAdapter extends CompletionAdapter { async *stream(request) { yield* stream(request) } }
  ctx.llm.registerAdapter(['care-test'], new OutputAdapter([]))
  const agent = await ctx.agentLoop.create('output-reminder-case', { provider: 'care-test', model: 'care-test' })
  const runtime = ctx.get('reminderRules')
  return {
    register(rules) { ctx.effect(() => runtime.registerSource({ sourceId: 'output-case', plugin: 'test', revision: 1, rules }).dispose) },
    turn: () => completionTurn(ctx, agent), settle: () => runtime.settle(agent.session.id),
    pending: () => runtime.snapshot(agent.session.id).candidates.filter(item => item.status === 'pending').length,
    notices: () => agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source?.kind === 'plugin:dsh-context-care:reminder').length,
    claims: () => agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source?.kind === 'plugin:dsh-context-care:reminder' && event.data.source.reminder.shared !== null).length,
  }
} })

for (const outcome of ['completed', 'failed', 'cancelled', 'legacy', 'partial']) test(`explicit native output retries reproduce live ${outcome} samples without automatic discovery`, async t => {
  const config = { maxStreamChars: 16, maxStreamBlocks: 4, streamEveryChars: 4, streamFlushMs: 5 }
  const owned = await fixture(t, false, {}, {}, { reminders: { ...config, ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
  const ctx = await owned.open(), runtime = ctx.get('reminderRules')
  const sideWrites = []
  ctx.on('domain/changed', change => { if (change.domain === 'context_care_reminders') sideWrites.push(change) })
  const live = /** @type {unknown[]} */ ([])
  ctx.effect(() => {
    const submit = runtime.submit
    runtime.submit = (event, signal) => {
      if (event !== null && typeof event === 'object' && 'type' in event && event.type === 'assistant.output') live.push(structuredClone(event))
      return submit(event, signal)
    }
    return () => { runtime.submit = submit }
  })
  if (outcome !== 'legacy') ctx.effect(() => runtime.registerSource({ sourceId: 'native-output-replay', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'observe', on: 'assistant.output', text: 'unused',
    when: { blockTypes: ['text', 'reasoning'], pattern: { kind: 'literal', text: 'THIS_PATTERN_DOES_NOT_APPEAR' } },
    effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
  }] }).dispose)
  const tracePath = resolve(owned.root, 'output-judges.jsonl')
  const matches = { sourceId: 'native-output-matches', plugin: 'test', revision: 1,
    rules: ['prefix', 'TEXT', 'prefix', 'TEXT'].map((text, index) => ({
      format: 'reminder/v4', id: `r${index}`, on: 'assistant.output', text: `OUTPUT_${index}`,
      ...(index >= 2 ? { exclusiveGroup: 'same-output-choice' } : {}),
      when: { blockTypes: ['text'], pattern: outcome === 'partial' && index === 2
        ? { kind: 'regex', regex: '^pref$' } : { kind: 'literal', text } },
      judge: { ref: 'native-output', revision: 1, params: { tracePath, label: String(index) } },
      effect: { kind: 'remind', deliver: { model: { once: 'surface' } } },
    })) }
  function registerOutputRules(scope) {
    const rules = scope.get('reminderRules')
    scope.effect(() => rules.registerDetector({ ref: 'native-output', revision: 1,
      module: new URL('./fixtures/reminder-native-output.ts', import.meta.url).href }))
    scope.effect(() => rules.registerSource(matches).dispose)
  }
  if (outcome !== 'legacy') registerOutputRules(ctx)
  else {
    // This actual observer uses DSH's lifecycle-local attempt id, the identity
    // emitted by the previous provider. No committed seed event is rewritten.
    const previous = createOutputStream({ config, sessionId: subject => String(subject.session.id),
      submit: event => runtime.submit(event), afterSubmit: () => {}, report: error => { throw error }, enabled: () => true })
    let installed = false
    ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
      if (frame.type === 'start' && !installed) { registerOutputRules(ctx); installed = true }
      if (frame.type === 'end') {
        if (frame.outcome.kind === 'abandoned') return previous.abandon(subject, frame)
        const terminal = subject.session.eventAt(frame.outcome.seq)
        if (!terminal) throw new Error('legacy-output-terminal-missing')
        previous.observe(subject, { ...frame, time: terminal.time })
      } else previous.observe(subject, frame)
    })
    ctx.effect(() => () => previous.close())
  }
  let agent, calls = 0, cancellation = Promise.resolve()
  class NativeOutputAdapter extends CompletionAdapter {
    async *stream() {
      if (calls++ > 0) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'next' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'next' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: 'ab' }
      await new Promise(resolve => setTimeout(resolve, 15))
      yield { type: 'reasoning-delta', index: 0, text: 'cd' }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'abcd' } }
      yield { type: 'text-delta', index: 1, text: 'prefixTEXT' }
      await new Promise(resolve => setTimeout(resolve, 15))
      if (outcome === 'failed') throw new Error('native-output-attempt')
      if (outcome === 'cancelled') { cancellation = agent.cancel({ kind: 'hook', reason: 'native-output-replay' }); return }
      yield { type: 'block-end', index: 1, block: { type: 'text', text: 'prefixTEXT' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new NativeOutputAdapter([]))
  agent = await ctx.agentLoop.create('native-output-replay', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  await cancellation
  await runtime.settle(String(agent.id))
  const seed = await ctx.sessionQuery.readSession(agent.id), header = agent.session.header
  assert.ok(live.length > 3, 'real character and timer prefixes were actually observed')
  assert.equal(seed.events.some(event => event.type === 'assistant/attempt'), outcome === 'failed')
  assert.equal(seed.events.some(event => event.type === 'assistant/message' && event.data.interrupted), outcome === 'cancelled')
  await runtime.settle(String(agent.id))
  const liveEvaluations = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeOutputObservation.parse(JSON.parse(line)))
  assert.ok(liveEvaluations.some(row => row.event.output.text.includes('prefix') && row.event.native === undefined),
    'the live matching prefix ran in a real matcher Worker')
  assert.equal(liveEvaluations.some(row => row.label === '3'), outcome === 'partial',
    'a later prefix has its own exclusive choice when the earlier winner no longer matches')
  const initialLive = structuredClone(live)
  assert.equal(ctx.storageDomain.get('context_care_reminders'), undefined,
    'production opens no candidate domain; only native stream and inbox facts survive restart')
  assert.equal(sideWrites.length, 0, 'output detection does not write a duplicate JSON candidate record')
  const expected = outcome === 'partial' ? ['OUTPUT_2', 'OUTPUT_0', 'OUTPUT_1', 'OUTPUT_3'] : ['OUTPUT_0', 'OUTPUT_2', 'OUTPUT_1']
  if (outcome === 'partial') {
    const messages = await runtime.collect({ sessionId: String(agent.session.id), visible: agent.session.deriveMessages() })
    assert.deepEqual(messages.map(message => message.content[0].text), expected)
    // Commit one actual model-input message, leaving the later choice unhanded.
    // The cold fixture imports this real native record, never an edited seed.
    agent.session.append('user/message', messages[0], { surfaceOp: 'append' })
  } else await completionTurn(ctx, agent, 'Deliver the pending output notices at this natural request.')
  await runtime.settle(String(agent.id))
  const handedSeed = await ctx.sessionQuery.readSession(agent.id)
  assert.deepEqual(handedSeed.events.filter(event => event.type === 'user/message'
    && event.data.source.kind === 'plugin:dsh-context-care:reminder').map(event => event.data.content[0].text), outcome === 'partial' ? ['OUTPUT_2'] : expected)
  assert.equal(sideWrites.length, 0, 'natural delivery also advances only native Session facts')
  await owned.close(ctx)
  async function openNative(snapshot) {
    const next = await fixture(t, false, {}, {}, { reminders: { ...config, ruleTimeoutMs: 2000, roundTimeoutMs: 5000 } })
    const cold = await next.open()
    await cold.loader.create({ name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: resolve(next.root, 'session-logs'), compression: 'none' } })
    await cold.loader.await()
    for (const entry of cold.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl') await entry.fiber.await()
    const handle = await cold.sessionPersistence.create(header, { inheritedEventCount: snapshot.inheritedEventCount })
    try { await handle.append(snapshot.events); await handle.flush() } finally { await handle.close() }
    const doc = await cold.sessionQuery.readSession(header.id)
    const detached = cold.sessions.prepare(header.id, { seed: doc.events, meta: doc.session,
      inheritedEventCount: doc.inheritedEventCount, eventState: 'detached' })
    registerOutputRules(cold)
    const query = cold.sessionQuery, readSession = query.readSession.bind(query)
    let reads = 0
    query.readSession = (...args) => { reads++; return readSession(...args) }
    return { cold, doc, detached, readCount: () => reads }
  }
  const { cold, doc, detached, readCount } = await openNative(seed)
  const replayed = []
  for (const event of doc.events) if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    replayed.push(...ensureSessionLog(cold).withLive(detached, log => [...replayNativeOutput(config, detached, log, event, error => { throw error })]))
  }
  if (outcome === 'legacy') {
    const legacyId = initialLive[0].rootCallId, nativeId = replayed[0].rootCallId
    assert.equal(legacyId, `${header.id}:1`, 'the previous observer uses the actual DSH lifecycle identity')
    assert.match(nativeId, /^session:.*:output:\d+$/)
    assert.deepEqual(replayed, initialLive.map(event => ({ ...event,
      callId: event.callId.replace(legacyId, nativeId), rootCallId: nativeId,
      output: { ...event.output, attemptId: nativeId },
      textSamples: event.textSamples.map(sample => ({ ...sample, sampleId: sample.sampleId.replace(legacyId, nativeId) })),
    })), 'only the explicitly migrated attempt identity differs; all recorded evidence remains equal')
  } else assert.deepEqual(replayed, initialLive, 'identity, timestamps, prefix/complete phases and full-output evidence all come from the same native stream')
  const input = { sessionId: String(header.id), visible: [] }
  const submitOutput = async target => {
    for (const terminal of doc.events) if (terminal.type === 'assistant/message' || terminal.type === 'assistant/attempt') {
      for (const event of ensureSessionLog(cold).withLive(detached, log => [...replayNativeOutput(config, detached, log, terminal, error => { throw error })])) {
        await target.get('reminderRules').submit({ ...event, native: { type: 'assistant-output', seq: terminal.seq } })
      }
    }
  }
  assert.deepEqual(await cold.get('reminderRules').collect(input), [], 'ordinary collection never reconstructs old output triggers')
  await submitOutput(cold)
  const recovered = await cold.get('reminderRules').collect(input)
  assert.deepEqual(recovered.map(message => message.content[0].text), expected, 'a fresh Host reconstructs unhanded matches and the same ordered exclusive choices using actual Workers')
  assert.ok(readCount() <= 8, `ordered output recovery shares native history and recipient snapshots across samples (${readCount()} reads)`)
  const recoveredTrace = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeOutputObservation.parse(JSON.parse(line)))
  assert.ok(recoveredTrace.slice(liveEvaluations.length).every(row => row.event.native?.type === 'assistant-output'))
  const traceCount = recoveredTrace.length
  assert.deepEqual(await cold.get('reminderRules').collect(input), [])
  assert.equal((await readFile(tracePath, 'utf8')).trim().split('\n').length, traceCount, 'repeat collection does not repeat output judges')
  assert.equal(cold.sessions.list().length, 0)
  assert.equal(cold.agents.list().length, 0)
  const { cold: delivered, readCount: handedReads } = await openNative(handedSeed)
  assert.deepEqual(await delivered.get('reminderRules').collect(input), [], 'unhanded historical output is not pending work')
  await submitOutput(delivered)
  assert.deepEqual((await delivered.get('reminderRules').collect(input)).map(message => message.content[0].text),
    outcome === 'partial' ? ['OUTPUT_0', 'OUTPUT_1', 'OUTPUT_3'] : [], 'native handoffs suppress only recorded deliveries and preserve later unhanded exclusive winners')
  assert.ok(handedReads() <= (outcome === 'partial' ? 8 : 4), `handed output discovery does not reread history for each prefix or rule (${handedReads()} reads)`)
  const afterHandoff = (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => NativeOutputObservation.parse(JSON.parse(line))).slice(traceCount)
  if (outcome === 'partial') assert.ok(afterHandoff.some(row => row.label === '3'), 'the unhanded later choice is evaluated by a real Worker')
  else assert.ok(afterHandoff.every(row => row.label === '2'), 'independent handed rules and suppressed alternatives never rerun; only an unresolved exclusive choice needs its higher-priority barrier')
  if (outcome !== 'legacy') {
    const choice = handedSeed.events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin:dsh-context-care:reminder' && event.data.source.contextCareTrace.ruleId === 'r2')
    assert.ok(choice)
    assert.equal(afterHandoff.some(row => row.event.callId === choice.data.source.contextCareTrace.callId), false,
      'the exact exclusive choice with a native handoff is never judged again')
  }
  assert.equal(delivered.sessions.list().length, 0)
  assert.equal(delivered.agents.list().length, 0)
})

async function completionTurn(ctx, agent, text = 'Continue the requested task.') {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
  // All completion facts are native commits; flush their Session writer.
  await ctx.get('contextCareCompletion')?.flush(String(agent.session.id))
}

test('disabled model state report retains numeric sampling and explicit status results', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter(Array.from({ length: 2 }, () => ({ blocks: [{ type: 'text', text: 'Work continues.' }] }))))
  const agent = await ctx.agentLoop.create('care-report-off', { provider: 'care-test', model: 'care-test' })
  const controls = ctx.contextCareRequests.controls
  for (const actionId of ['report', 'advice']) await controls.patch(agent.id, {
    revision: controls.revision(agent.id), sourceId: 'dsh-context-care', ruleId: 'state', actionId, enabled: false,
  })
  await completionTurn(ctx, agent)
  assert.equal(agent.session.snapshotEvents().some(event => event.type === 'user/message'
    && producedBy(event.data.source, 'dsh-context-care:state')), false)
  // The first boundary may precede the Session's routed header. A second
  // natural turn supplies authoritative capacity instead of guessing it.
  await completionTurn(ctx, agent, 'Continue after the first routed request.')
  assert.equal(agent.session.snapshotEvents().some(event => event.type === 'user/message'
    && producedBy(event.data.source, 'dsh-context-care:state')), false)
  assert.equal(typeof controls.currentSample(agent.id).fatigueValue, 'number')
  const { cookie } = await controlCookie(ctx)
  const page = await (await fetch(`http://127.0.0.1:${ctx.webServer.port}/context-care/actions?sessionId=${agent.id}&limit=20`, { headers: { cookie } })).json()
  assert.equal(typeof page.currentState.wakefulnessValue, 'number')
  const text = await ctx.tools.get('context_status', agent).execute({}, { agent, signal: new AbortController().signal })
  assert.match(text, /疲劳/)
  assert.doesNotMatch(text, /写细交接/)
})

test('real completion commits exclude reasoning and quotes and replay cooldown without observation side files', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const changes = []
  ctx.on('domain/changed', change => {
    if (['context_care_completion', 'context_care_completion_notices'].includes(change.domain)) changes.push(change)
  })
  const adapter = new CompletionAdapter([
    { blocks: [{ type: 'reasoning', text: 'DONE' }, { type: 'text', text: '> completed\n```\n搞定\n```\nNot done.' }] },
    { blocks: [{ type: 'text', text: '任务完成了。' }] },
    { blocks: [{ type: 'text', text: 'DONE' }] },
    { blocks: [{ type: 'text', text: 'DONE' }] },
  ])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const first = await ctx.agentLoop.create('completion-one', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, first)
  assert.deepEqual(ctx.contextCareCompletion.list(first.id), [])
  await completionTurn(ctx, first)
  assert.equal(ctx.contextCareCompletion.list(first.id)[0].line, '任务完成了。')
  assert.equal(ctx.contextCareCompletion.list(first.id)[0].status, 'pending')
  await completionTurn(ctx, first)
  const saved = ctx.contextCareCompletion.list(first.id)
  assert.equal(saved.length, 1, 'native output times preserve source cooldown across different attempts')
  assert.equal(saved[0].status, 'dispatched')
  const second = await ctx.agentLoop.create('completion-two', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, second)
  assert.equal(ctx.contextCareCompletion.list(second.id).length, 1, 'another Session has its own cooldown')
  ctx.contextCareCompletion.clear()
  assert.deepEqual(ctx.contextCareCompletion.list(first.id), saved)
  assert.deepEqual(changes, [], 'completion does not write a second fact store')
  assert.equal(ctx.storageDomain.get('context_care_completion'), undefined)
  assert.equal(ctx.storageDomain.get('context_care_completion_notices'), undefined)
  const log = first.session.snapshotEvents()
  const cold = await fixture(t)
  const resumed = await cold.open()
  const restored = (await resumed.agents.create({ sessionId: first.id, seed: log,
    agentOptions: { provider: 'care-test', model: 'care-test' } })).agent
  assert.deepEqual(resumed.contextCareCompletion.list(restored.id), saved, 'an independent Host only needs the actual Session log')
})

test('disabled completion notices do not consume observation cooldown, and oversized text is unavailable', async t => {
  for (const config of [{ notifications: false }, { maxObservedChars: 16 }]) {
    const owned = await fixture(t, true, {}, config)
    const ctx = await owned.open()
    const text = config.notifications === false ? 'DONE' : `DONE\n${'Verified evidence. '.repeat(20)}`
    ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text }] }]))
    const agent = await ctx.agentLoop.create(`completion-preferences-${Object.keys(config)[0]}`, { provider: 'care-test', model: 'care-test' })
    await completionTurn(ctx, agent)
    assert.equal(ctx.storageDomain.get('context_care_completion'), undefined)
    assert.equal(ctx.storageDomain.get('context_care_completion_notices'), undefined)
    assert.equal(ctx.contextCareCompletion.list(agent.session.id).length, 0)
    assert.deepEqual(ctx.contextCareCompletion.collect(agent.session, { provider: 'care-test', model: 'care-test' }), [])
  }
})

test('complete-input calibration shrinks once and does not repeat maintenance over ten small steps', async t => {
  const owned = await fixture(t, false, { retainRatio: 0.16, safetyTokens: 2048, burstTokens: 8192, releaseMarginTokens: 8192, summary: { maxTokens: 8192 } })
  const ctx = await owned.open()
  class CalibratedAdapter extends LlmAdapter {
    requests = []
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 262144 } } }
    async *stream(options) {
      this.requests.push(options)
      const raw = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, header: { config: options, tools: options.tools } }).decomposeRequest(options)
      const text = options.purpose === 'compaction' ? 'Verified progress, corrections and pending paths. '.repeat(240) : 'Continue verified work.'
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: raw.textTokens * (250000 / 49000) + raw.visualTokens, outputTokens: 8192 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new CalibratedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('calibration-regression', { provider: 'care-test', model: 'care-test', maxTokens: 8192 })
  await completionTurn(ctx, agent, 'Earlier verified work. '.repeat(7200))
  // A separately appended recent complete unit lets retention use calibrated input
  // prices rather than the historical provider anchor plus fixed shadow deltas.
  agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Recent work. '.repeat(2600) }] }), { surfaceOp: 'append' })
  await completionTurn(ctx, agent)
  const summaries = () => agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')
  await ctx.contextCareRequests.flush(agent.session.id)
  assert.equal(summaries().length, 1, JSON.stringify(ctx.contextCareRequests.list(agent.session.id).map(record => ({ kind: record.kind, scale: record.data.pricingBasis?.textScale, budget: record.data.budget, action: record.data.action, phase: record.data.phase }))))
  const compacted = summaries()[0].data
  assert.ok(compacted.shadowedSeqs.length > 0)
  assert.ok(compacted.shadowedTokenCount > 30000)
  await ctx.contextCareRequests.flush(agent.session.id)
  const requests = () => ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'request' && record.data.purpose === 'conversation')
  assert.ok(Math.abs(requests().at(-1).data.pricingBasis.textScale - 250000 / 49000) < 1e-9)
  assert.ok(requests().at(-1).data.budget.inputTokens < 201523)
  const frozen = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, requests: ctx.contextCareRequests })
  const before = frozen.measure().inputTokens
  for (let index = 0; index < 10; index++) agent.session.append('request/header', { header: agent.session.requestHeader(), reason: 'series' })
  assert.equal(frozen.measure().inputTokens, before, 'Log-only records add no phantom input')
  for (let index = 0; index < 10; index++) await completionTurn(ctx, agent, `New verified unit ${index}. ${'Small progress. '.repeat(100)}`)
  assert.equal(summaries().length, 1, 'Real new input remains below the release threshold without artificial action caps')
  assert.equal(adapter.requests.filter(request => request.purpose === 'compaction').length, 1)
  assert.deepEqual(agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt').map(event => event.data), [])
})

test('real failed model attempt creates no completion and consumes no native cooldown', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new CompletionAdapter([{ blocks: [{ type: 'text', text: 'DONE' }], reason: {
    kind: 'error', failure: { code: 'TEST_FAILURE', message: 'Original provider failure' },
  } }, { blocks: [{ type: 'text', text: 'DONE' }] }])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('completion-failed', { provider: 'care-test', model: 'care-test' })
  const values = []
  const off = ctx.on('domain/changed', change => { if (change.domain === 'context_care_completion') values.push(change.value) })
  t.after(off)
  await completionTurn(ctx, agent)
  assert.ok(agent.session.snapshotEvents().some(event => event.type === 'assistant/attempt'))
  assert.deepEqual(ctx.contextCareCompletion.list(agent.id), [])
  assert.deepEqual(values, [])
  await completionTurn(ctx, agent)
  assert.equal(ctx.contextCareCompletion.list(agent.id)[0].status, 'pending')
  assert.equal(ctx.contextCareCompletion.list(agent.id)[0].line, 'DONE')
})

test('real first request enforces an exact route policy before adapter dispatch and preserves the local failure', async t => {
  const owned = await fixture(t, true, { maxOverflowRetries: 0,
    routeBudgets: [{ provider: 'care-test', model: 'care-test', purpose: 'conversation', contextBudgetTokens: 2000 }] })
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const failures = []
  const off = ctx.on('agent/request-error', async ({ failure }, next) => { failures.push(failure); return next() })
  t.after(off)
  const agent = await ctx.agentLoop.create('care-local-budget', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Uncompressible first input. '.repeat(1500))
  assert.equal(adapter.requests.length, 0)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].code, 'REQUEST_BUDGET_EXCEEDED')
  assert.match(failures[0].message, /exceeds hard input budget 2000/)
  const attempt = agent.session.snapshotEvents().find(event => event.type === 'assistant/attempt')
  assert.ok(attempt)
  const finish = attempt.data.stream.find(record => record.type === 'chunk' && record.chunk.type === 'finish').chunk
  assert.deepEqual(finish.reason.failure, failures[0])
  const careEntry = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care/runtime')
  await careEntry.fiber.dispose()
  assert.equal(ctx.tools.get('context_rest', agent), undefined)
  await completionTurn(ctx, agent, 'A natural followup after controller disposal. '.repeat(500))
  assert.equal(adapter.requests.length, 1, 'Disposed budget contribution must no longer reject this route')
})

class OverflowAdapter extends LlmAdapter {
  constructor(rejectSummary = false) { super(); this.rejectSummary = rejectSummary }
  requests = []
  conversationCalls = 0
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
  async *stream(options) {
    this.requests.push(options)
    if (options.purpose === 'compaction' && this.rejectSummary) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SUMMARY_REJECTED', message: 'Separate summary failure' } } }
      return
    }
    if (options.purpose !== 'compaction' && ++this.conversationCalls === 2) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'Original context failure' } } }
      return
    }
    const block = { type: 'text', text: options.purpose === 'compaction' ? 'Earlier verified work is saved. Continue the current task.' : 'Work continues.' }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

test('real provider overflow below the estimated soft limit forces a prefix and retries once after durable shrink', async t => {
  const owned = await fixture(t, true, { modelScopedPrompts: [{ ruleId: 'overflow-static', version: '1', provider: 'care-test', model: 'care-test',
    trigger: 'static', text: '沿当前思考模型执行已授权工作，核对实际输入与输出。' }] })
  const ctx = await owned.open()
  const adapter = new OverflowAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('care-overflow', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Earlier verified work and recovery records. '.repeat(800))
  await completionTurn(ctx, agent, 'Continue.')
  assert.equal(adapter.conversationCalls, 3, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt' || event.type === 'compaction/end')))
  assert.equal(adapter.requests.filter(request => request.purpose === 'compaction').length, 1)
  const events = agent.session.snapshotEvents()
  const failure = events.find(event => event.type === 'assistant/attempt')
  const replacement = events.find(event => event.surfaceOp?.op === 'replace')
  assert.ok(failure.seq < replacement.seq)
  assert.ok(events.at(-1))
  assert.equal(events.filter(event => event.type === 'assistant/message').length, 2)
  await ctx.contextCareRequests.flush(agent.session.id)
  const attempts = ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'request' && record.data.purpose === 'conversation')
  assert.deepEqual(attempts.map(record => record.data.outcome), ['completed', 'failed', 'completed'])
  assert.equal(attempts[1].data.eventSeq, failure.seq)
  assert.equal(attempts[1].data.promptDecision.segments.length, 1)
})

test('disabled overflow actions retain the original provider failure without maintenance or retry', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new OverflowAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('care-overflow-off', { provider: 'care-test', model: 'care-test' })
  const controls = ctx.contextCareRequests.controls
  for (const actionId of ['prune', 'summary', 'retry']) await controls.patch(agent.id, {
    revision: controls.revision(agent.id), sourceId: 'dsh-context-care', ruleId: 'overflow', actionId, enabled: false,
  })
  await completionTurn(ctx, agent, 'Earlier verified work. '.repeat(800))
  await completionTurn(ctx, agent, 'Continue.')
  assert.equal(adapter.conversationCalls, 2)
  assert.equal(adapter.requests.filter(request => request.purpose === 'compaction').length, 0)
  assert.equal(agent.session.snapshotEvents().some(event => event.surfaceOp?.op === 'replace'), false)
  const attempt = agent.session.snapshotEvents().find(event => event.type === 'assistant/attempt')
  const failure = attempt.data.stream.find(record => record.type === 'chunk' && record.chunk.type === 'finish').chunk.reason.failure
  assert.equal(failure.code, 'CONTEXT_WINDOW_EXCEEDED')
})

test('failed overflow summary leaves the original provider failure terminal and never retries without shrink', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new OverflowAdapter(true)
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('care-overflow-failed', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Earlier verified work and recovery records. '.repeat(800))
  await completionTurn(ctx, agent, 'Continue.')
  assert.equal(adapter.conversationCalls, 2)
  const events = agent.session.snapshotEvents()
  assert.equal(events.some(event => event.surfaceOp?.op === 'replace'), false)
  const attempt = events.find(event => event.type === 'assistant/attempt')
  const failure = attempt.data.stream.find(record => record.type === 'chunk' && record.chunk.type === 'finish').chunk.reason.failure
  assert.deepEqual(failure, { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'Original context failure' })
  assert.ok(events.some(event => event.type === 'compaction/end' && event.data.error.includes('Separate summary failure')))
})

test('a committed prune qualifies overflow recovery even when the following summary fails', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new OverflowAdapter(true)
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('care-partial-overflow', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Earlier verified work and recovery records. '.repeat(800))
  ctx.provide('toolResultPruner', { async pruneSession(session) {
    const seq = session.surface.nodes.find(seq => session.eventAt(seq).type === 'user/message' && session.eventAt(seq).data.source.kind === 'user')
    const original = session.eventAt(seq)
    // External pruner double performs the same public replacement protocol.
    session.append('user/message', createUserMessage({ source: original.data.source,
      content: [{ type: 'text', text: 'The verified records remain on disk. '.repeat(60) }] }), {
      surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  } })
  await completionTurn(ctx, agent, 'Continue.')
  await ctx.contextCareRequests.flush(agent.session.id)
  assert.equal(adapter.conversationCalls, 3)
  const records = ctx.contextCareRequests.list(agent.session.id)
  const pruned = records.find(record => record.kind === 'maintenance' && record.data.action === 'prune' && record.data.phase === 'completed')
  assert.equal(pruned.data.progressed, true)
  assert.ok(pruned.data.afterInput < pruned.data.beforeInput)
  assert.ok(records.some(record => record.kind === 'maintenance' && record.data.action === 'summary' && record.data.phase === 'failed'))
  assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').length, 2)
})

test('real deep rest commits one handoff, fixed shadow prices, and replayable completion', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter(true)
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('care-deep', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Earlier verified work. '.repeat(1400))
  await completionTurn(ctx, agent, 'Continue the next work unit. '.repeat(100))
  await completionTurn(ctx, agent)
  const events = agent.session.snapshotEvents()
  const summary = events.find(event => event.type === 'compaction/summary')
  assert.ok(summary)
  const replacement = events.find(event => event.type === 'user/message' && event.data.source.kind === 'compact-checkpoint')
  assert.ok(replacement)
  const last = adapter.requests.at(-1)
  const handoffs = last.messages.filter(message => message.content.some(block => block.type === 'text' && block.text.includes('历史压缩的交接笔记')))
  assert.equal(handoffs.length, 1)
  assert.equal(adapter.requests.filter(request => request.purpose === 'compaction').length, 0)
  const status = events.filter(event => event.type === 'user/message' && producedBy(event.data.source, 'dsh-context-care:state')).at(-1)
  const expectedStatus = JSON.parse(await readFile(new URL('./fixtures/deep-status.json', import.meta.url), 'utf8'))
  assert.equal(status.data.content[0].text, expectedStatus)
  assert.ok(last.messages.some(message => message.content.some(block => block.type === 'text' && block.text === expectedStatus)))
  const shadow = summary.data.shadowedSeqs.map(seq => agent.session.eventAt(seq)).reduce((sum, event) => {
    if (event.type === 'user/message') return sum + ctx.tokenMeter.estimateMessage(event.data)
    if (event.type === 'assistant/message' || event.type === 'system/message') return sum + ctx.tokenMeter.estimateMessage(event.data.message)
    if (event.type === 'tool/result') return sum + ctx.tokenMeter.estimateMessage(event.data.message)
    throw new Error(`Unexpected selected event ${event.type}`)
  }, 0)
  assert.equal(summary.data.shadowedTokenCount, shadow)
  await ctx.contextCareRequests.flush(agent.session.id)
  const deepRecord = ctx.contextCareRequests.list(agent.session.id).find(record => record.kind === 'maintenance' && record.data.action === 'deep-rest' && record.data.phase === 'completed')
  assert.equal(deepRecord.data.compactionId, summary.data.compactionId)
  assert.equal(deepRecord.data.progressed, true)
  assert.ok(deepRecord.data.afterInput < deepRecord.data.beforeInput)
  const { cookie } = await controlCookie(ctx)
  const actions = await (await fetch(`http://127.0.0.1:${ctx.webServer.port}/context-care/actions?sessionId=${agent.session.id}&limit=20`, { headers: { cookie } })).json()
  const deepActions = actions.actions.filter(action => action.action === 'deep-rest')
  assert.equal(deepActions.length, 1)
  assert.equal(deepActions[0].phase, 'completed')
  assert.equal(deepActions[0].journalPersisted, false, 'live prices are cache diagnostics, not a durable side audit')
  assert.ok(deepActions[0].replacements.some(item => item.newSeq === replacement.seq))
  const restored = Session.create('care-deep-replay', events, undefined, undefined, ctx.sessions.messageProjections)
  const replayedAction = ensureSessionLog(ctx).withLive(restored, log => contextCareActions([], restored, log)).actions.find(action => action.action === 'deep-rest')
  assert.equal(replayedAction.auditStatus, 'session-only')
  assert.equal(replayedAction.journalPersisted, false)
  assert.ok(replayedAction.replacements.some(item => item.newSeq === replacement.seq))
  const { logRevision: restoredRevision, ...restoredInput } = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: restored }).measure()
  const { logRevision: liveRevision, ...liveInput } = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }).measure()
  // Session.create owns an additional constructor-seed event, with no input cost.
  assert.equal(restoredRevision, liveRevision + 1)
  assert.deepEqual(restoredInput, liveInput)
})

test('real request cache rebuilds route and calibration from Session without request files', async t => {
  const config = { modelScopedPrompts: [{ ruleId: 'replay-once', version: '1', provider: 'care-test', model: 'care-test',
    trigger: 'model-switch', initialBind: true, text: 'CALIBRATION_REPLAY_NOTICE '.repeat(200) }] }
  const owned = await fixture(t, false, config)
  let ctx = await owned.open()
  let agent
  const requests = []
  class ReplayAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
    async *stream(request) {
      requests.push(request)
      const raw = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }).decomposeRequest(request)
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Continue verified work.' } }
      yield { type: 'usage', usage: { inputTokens: raw.textTokens * 2 + raw.visualTokens } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new ReplayAdapter())
  const options = { provider: 'care-test', model: 'care-test' }
  agent = await ctx.agentLoop.create('request-session-replay', options)
  await completionTurn(ctx, agent, 'Use the actual session facts.')
  await ctx.contextCareRequests.flush(agent.id)
  assert.equal(requests.length, 1)
  const initial = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, requests: ctx.contextCareRequests }).pricingBasis
  assert.equal(initial.textScale, 2, 'one-shot text must be included in the recovered denominator')
  const facts = ctx.contextCareRequests.list(agent.id).filter(record => record.kind === 'request')
    .map(({ data }) => ({ callId: data.callId, route: data.route, outcome: data.outcome, eventSeq: data.eventSeq, usage: data.usage }))
  const logFile = resolve(owned.root, 'recorded-session.json')
  await writeFile(logFile, JSON.stringify(agent.session.snapshotEvents()))
  const seed = JSON.parse(await readFile(logFile, 'utf8'))
  await owned.close(ctx)
  const fresh = await fixture(t, false, config)
  ctx = await fresh.open()
  ctx.llm.registerAdapter(['care-test'], new ReplayAdapter())
  agent = (await ctx.agents.create({ sessionId: 'request-session-replay', seed, agentOptions: options })).agent
  const restored = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, requests: ctx.contextCareRequests }).pricingBasis
  assert.equal(restored.textScale, initial.textScale)
  assert.equal(restored.sampleSeq, initial.sampleSeq)
  assert.deepEqual(ctx.contextCareRequests.list(agent.id).filter(record => record.kind === 'request')
    .map(({ data }) => ({ callId: data.callId, route: data.route, outcome: data.outcome, eventSeq: data.eventSeq, usage: data.usage })), facts)
  await completionTurn(ctx, agent, 'Continue after reopening.')
  assert.equal(requests.length, 2)
  assert.doesNotMatch(JSON.stringify(requests[1]), /CALIBRATION_REPLAY_NOTICE/, 'a restored previous route must not fire the first-bind notice twice')
  for (const root of [owned.root, fresh.root]) {
    const files = await readdir(root, { recursive: true })
    assert.equal(files.some(file => file.includes('context_care_requests')), false, 'no independent request domain is opened')
  }
})

test('real request settlements and summary actions recover from the actual Session alone', async t => {
  const owned = await fixture(t)
  let ctx = await owned.open()
  const adapter = new OverflowAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('request-journal-restart', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent, 'Verified earlier work. '.repeat(1400))
  await completionTurn(ctx, agent, 'Continue')
  await ctx.contextCareRequests.flush(agent.session.id)
  const records = ctx.contextCareRequests.list(agent.session.id)
  const conversation = records.filter(record => record.kind === 'request' && record.data.purpose === 'conversation')
  const summary = records.find(record => record.kind === 'request' && record.data.purpose === 'compaction')
  assert.equal(conversation.length, 3)
  assert.ok(conversation.every(record => record.data.phase === 'settled'))
  assert.ok(conversation.filter(record => record.data.outcome === 'completed').every(record => record.data.dispatched),
    'completed output establishes dispatch; an error-only attempt is not proof of provider handoff')
  assert.ok(conversation.some(record => record.data.outcome === 'failed'))
  assert.equal(summary.data.outcome, 'completed')
  assert.equal(summary.data.route.provider, 'care-test')
  assert.equal(summary.data.route.model, 'care-test')
  assert.equal(agent.session.eventAt(summary.data.eventSeq).type, 'compaction/summary')
  assert.deepEqual(summary.data.usage, agent.session.eventAt(summary.data.eventSeq).data.usage)
  const action = records.find(record => record.kind === 'maintenance' && record.data.phase === 'committed')
  assert.ok(action.data.afterInput < action.data.beforeInput)
  assert.equal(agent.session.eventAt(action.data.summarySeq).type, 'compaction/summary')
  const facts = rows => rows.filter(record => record.kind === 'request').map(({ data }) => ({
    outcome: data.outcome, eventSeq: data.eventSeq, eventType: data.eventType, purpose: data.purpose, route: data.route, usage: data.usage }))
  const expected = facts(records)
  const actions = ensureSessionLog(ctx).withLive(agent.session, log => contextCareActions([], agent.session, log))
  assert.ok(actions.actions.length > 0, 'the actual Session carries committed checkpoint actions')
  assert.ok(ensureSessionLog(ctx).withLive(agent.session, log => contextCareActions(records, agent.session, log)).actions.every(action => !action.journalPersisted),
    'live diagnostics must not claim a separate persisted audit')
  const seed = agent.session.snapshotEvents()
  await owned.close(ctx)
  const fresh = await fixture(t)
  ctx = await fresh.open()
  const restored = (await ctx.agents.create({ sessionId: agent.id, seed,
    agentOptions: { provider: 'care-test', model: 'care-test' } })).agent
  assert.deepEqual(facts(ctx.contextCareRequests.list(restored.id)), expected)
  assert.deepEqual(ensureSessionLog(ctx).withLive(restored.session, log => contextCareActions([], restored.session, log)), actions)
})

test('exact model-switch prompts are request-only, logged, priced and absent from another summary route', async t => {
  const owned = await fixture(t, true, { modelScopedPrompts: [{ ruleId: 'route-reminder', version: '1', provider: 'care-test', model: 'care-test',
    trigger: 'model-switch', initialBind: true, text: '你当前使用的思考模型是 {boundModelLabel}。依据实际请求、已有授权与证据继续工作。' }] })
  const ctx = await owned.open()
  class RecordingAdapter extends LlmAdapter {
    requests = []
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
    async *stream(options) {
      this.requests.push(options)
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Progress remains verified.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new RecordingAdapter()
  const other = new RecordingAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  ctx.llm.registerAdapter(['care-other'], other)
  let route = 'care-test'
  const off = ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider: route, model: route }))
  t.after(off)
  const agent = await ctx.agentLoop.create('scoped-prompt-isolation', { provider: 'care-test', model: 'care-test' })
  const hasReminder = request => request.messages.flatMap(message => message.content).filter(block => block.text?.includes('你当前使用的思考模型是'))
  await completionTurn(ctx, agent, 'Earlier verified records. '.repeat(1000))
  assert.ok(adapter.requests.length, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt' || event.type === 'turn/end')))
  assert.equal(hasReminder(adapter.requests.at(-1)).length, 1)
  route = 'care-other'
  await completionTurn(ctx, agent)
  assert.equal(hasReminder(other.requests.at(-1)).length, 0)
  route = 'care-test'
  await completionTurn(ctx, agent)
  assert.equal(hasReminder(adapter.requests.at(-1)).length, 1)
  await completionTurn(ctx, agent)
  assert.equal(hasReminder(adapter.requests.at(-1)).length, 0)
  const decisions = agent.session.snapshotEvents().filter(event => event.data.contextCarePrompt)
  assert.equal(decisions.length, 2)
  assert.ok(decisions.every(event => event.surfaceOp === undefined))
  assert.ok(agent.session.deriveMessages().every(message => !hasReminder({ messages: [message] }).length))
  const operation = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const compact = createSummaryExecutor({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
    spec: resolveConfig({ summary: { provider: 'care-other', model: 'care-other', maxTokens: 128 }, minFreshTokens: 100 }) })
  const selected = agent.session.surface.nodes.slice(1, -1)
  await compact(ctx.compaction, { start: selected[0], end: selected.at(-1) }, agent, new AbortController().signal, operation)
  assert.equal(hasReminder(other.requests.at(-1)).length, 0)
  await ctx.contextCareRequests.flush(agent.session.id)
  const records = ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'request' && record.data.promptDecision)
  assert.equal(records.length, 2)
  for (const record of records) {
    assert.equal(record.data.promptDecision.segments.length, 1)
    const sent = [...adapter.requests, ...other.requests].find(request => hasReminder(request).some(block =>
      record.data.promptDecision.message.content.some(expected => expected.text === block.text)))
    assert.ok(sent, 'the logged one-shot prompt reached a real adapter')
    assert.ok(operation.priceRequest(sent) > 0, 'price the actual request, not an independent saved budget')
    assert.equal(agent.session.eventAt(record.data.promptDecision.seq).data.contextCarePrompt.callId, record.data.callId)
  }
  const replay = Session.create('scoped-prompt-replay', agent.session.snapshotEvents(), undefined, undefined, ctx.sessions.messageProjections)
  assert.deepEqual(replay.deriveMessages(), agent.session.deriveMessages())
  const careEntry = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care/runtime')
  await careEntry.fiber.dispose()
  await completionTurn(ctx, agent)
  assert.equal(hasReminder(adapter.requests.at(-1)).length, 0)
})

test('actual request calibration includes a large one-shot reminder and does not distort the next prompt', async t => {
  const scoped = [{ ruleId: 'first-large', version: '1', provider: 'care-test', model: 'care-test', trigger: 'model-switch',
    initialBind: true, text: '当前思考模型的能力用于继续已授权工作。'.repeat(300) }]
  const owned = await fixture(t, false, { modelScopedPrompts: scoped })
  const ctx = await owned.open()
  let agent
  class CalibratedAdapter extends ScriptedAdapter {
    async *stream(options) {
      this.requests.push(options)
      const raw = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }).decomposeRequest(options)
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '继续实际工作。' } }
      yield { type: 'usage', usage: { inputTokens: raw.textTokens * 2 + raw.visualTokens } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new CalibratedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  agent = await ctx.agentLoop.create('calibrated-one-shot', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  await completionTurn(ctx, agent)
  await ctx.contextCareRequests.flush(agent.session.id)
  const records = ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'request')
  assert.equal(records.length, 2)
  assert.equal(records[0].data.promptDecision.segments.length, 1)
  assert.equal(records[1].data.promptDecision, undefined)
  assert.equal(records[1].data.pricingBasis.textScale, 2)
  assert.equal(records[1].data.pricingBasis.sampleCallId, records[0].data.callId)
  assert.equal(records[1].data.budget.inputTokens, Math.ceil(records[1].data.rawInput.textTokens * 2 + records[1].data.rawInput.visualTokens))
  const pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const raw = adapter.requests.map(request => pricing.decomposeRequest(request))
  assert.ok(raw[0].textTokens > raw[1].textTokens, 'the actual one-shot request is larger')
  assert.equal(records[1].data.budget.inputTokens, Math.ceil(raw[1].textTokens * 2 + raw[1].visualTokens))
})

test('committed output feedback waits for a natural request, uses actual dispatch, and stays out of history', async t => {
  const rules = [{ ruleId: 'pattern', version: '1', provider: 'care-test', model: 'care-test', trigger: 'output-pattern', detector: detectorFixture,
    text: '刚才思考模型 {sourceModel} 的输出有 {H} 处措辞、{K}/{N} 个语句。当前思考模型 {boundModelLabel}。核对授权与证据并继续。' }]
  const owned = await fixture(t, true, { modelScopedPrompts: rules })
  const ctx = await owned.open()
  class FeedbackAdapter extends LlmAdapter {
    requests = []
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
    async *stream(options) {
      this.requests.push(options)
      const text = this.requests.length === 1 ? '我不会做第一项。\n我不会做第二项。\n我不会做第三项。' : '已核对证据，继续完成工作。'
      yield { type: 'text-delta', index: 0, text: text.slice(0, 3) }
      yield { type: 'text-delta', index: 0, text: text.slice(3) }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new FeedbackAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('feedback-natural', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  await ctx.contextCareRequests.flush(agent.session.id)
  assert.equal(adapter.requests.length, 1, 'No feedback-only continuation')
  assert.equal(ctx.contextCareRequests.feedback(agent.session.id)[0].pending.sample.H, 3)
  const committed = agent.session.snapshotEvents().find(event => event.type === 'assistant/message')
  ctx.emit('agent/assistant-stream', { agent, frame: { type: 'end', attemptId: `${agent.id}:1`, outcome: { kind: 'committed', seq: committed.seq } } })
  await ctx.contextCareRequests.flush(agent.session.id)
  assert.equal(ctx.contextCareRequests.feedback(agent.session.id)[0].completed, 1)
  await completionTurn(ctx, agent)
  await ctx.contextCareRequests.flush(agent.session.id)
  const reminder = adapter.requests[1].messages.flatMap(message => message.content).filter(block => block.text?.includes('刚才思考模型'))
  assert.equal(reminder.length, 1)
  assert.match(reminder[0].text, /3 处措辞、3\/3 个语句/)
  assert.ok(agent.session.deriveMessages().every(message => message.content.every(block => !block.text?.includes('刚才思考模型'))))
  const episode = ctx.contextCareRequests.feedback(agent.session.id)[0]
  assert.equal(episode.pending, undefined)
  assert.equal(episode.lastDelivery.status, 'dispatched')
  const records = ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'request')
  assert.equal(records.length, 2)
  assert.equal(records[1].data.outcome, 'completed')
  assert.deepEqual(records[1].data.promptDecision.segments[0].sourceSeqs, [committed.seq])
})

test('native output feedback cold replay ignores legacy episodes and retains unknown delivery allowance', async t => {
  const rules = [{ ruleId: 'native-pattern', version: '1', provider: 'care-test', model: 'care-test', trigger: 'output-pattern',
    detector: detectorFixture, text: 'OUTPUT_PATTERN_NOTICE {H} hits from {sourceModel}.' }]
  const legacy = 'This obsolete feedback JSON must not be opened.\n'
  async function open(outputs, seed) {
    const owned = await fixture(t, false, { modelScopedPrompts: rules })
    const directory = resolve(owned.root, 'context_care_output_feedback', 'episodes')
    await mkdir(directory, { recursive: true })
    const legacyFile = resolve(directory, 'legacy.json')
    await writeFile(legacyFile, legacy)
    const ctx = await owned.open()
    assert.equal(await readFile(legacyFile, 'utf8'), legacy)
    await ctx.loader.create({ name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: resolve(owned.root, 'session-logs'), compression: 'none' } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl') await entry.fiber.await()
    class NativeFeedbackAdapter extends CompletionAdapter {
      requests = []
      async *stream(request) { this.requests.push(request); yield* super.stream(request) }
    }
    const adapter = new NativeFeedbackAdapter(outputs)
    ctx.llm.registerAdapter(['care-test'], adapter)
    const agentOptions = { provider: 'care-test', model: 'care-test' }
    const agent = seed ? (await ctx.agents.create({ sessionId: seed.id, seed: seed.events,
      inheritedEventCount: seed.inheritedEventCount, meta: seed.header, agentOptions })).agent
      : await ctx.agentLoop.create('feedback-native-cold', agentOptions)
    return { ctx, agent, adapter, episodes: () => ctx.contextCareRequests.feedback(agent.id),
      turn: () => completionTurn(ctx, agent),
      async close() {
        await ctx.sessions.flush(agent.session)
        const log = await ctx.sessionQuery.readSession(agent.id)
        const next = { id: agent.id, header: agent.session.header, events: log.events, inheritedEventCount: log.inheritedEventCount }
        await owned.close(ctx)
        assert.equal(await readFile(legacyFile, 'utf8'), legacy)
        return next
      } }
  }
  const failed = { blocks: [], reason: { kind: 'error', failure: { code: 'NATIVE_FEEDBACK_UNKNOWN', message: 'No provider response proves delivery' } } }
  const first = await open([{ blocks: [{ type: 'text', text: '我不会做第一项。\n我不会做第二项。\n我不会做第三项。' }] }, failed])
  await first.turn()
  const original = structuredClone(first.episodes()[0].pending)
  assert.equal(original.deliveries, 0)
  await first.turn()
  assert.equal(first.episodes()[0].pending.deliveries, 1)
  assert.equal(first.episodes()[0].lastDelivery.status, 'delivery-unknown')
  const second = await open([failed], await first.close())
  assert.equal(second.episodes()[0].pending.segmentId, original.segmentId)
  assert.equal(second.episodes()[0].pending.deliveries, 1)
  await second.turn()
  assert.equal(second.episodes()[0].pending.deliveries, 2)
  const third = await open([{ blocks: [{ type: 'text', text: 'The verified work continues.' }] }], await second.close())
  assert.equal(third.episodes()[0].pending.deliveries, 2)
  await third.turn()
  assert.doesNotMatch(JSON.stringify(third.adapter.requests[0].messages), /OUTPUT_PATTERN_NOTICE/)
  assert.equal(third.episodes()[0].pending, undefined)
  assert.equal(third.episodes()[0].lastDelivery.exhausted, true)
  await third.close()
})

test('a control edit during notice preparation refuses handoff without logging a completion delivery', async t => {
  const owned = await fixture(t, true, { modelScopedPrompts: [{ ruleId: 'pattern', version: '1', provider: 'care-test', model: 'care-test',
    trigger: 'output-pattern', detector: detectorFixture, text: 'Review the output evidence.' }] })
  const ctx = await owned.open()
  const adapter = new CompletionAdapter([{ blocks: [{ type: 'text', text: '我不会做第一项。\n我不会做第二项。\n我不会做第三项。\n任务完成了。' }] }])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('notice-reservation-toggle', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  await ctx.contextCareRequests.flush(agent.id)
  const completion = ctx.get('contextCareCompletion')
  const beforeFeedback = structuredClone(ctx.contextCareRequests.feedback(agent.id))
  const beforeCompletion = structuredClone(completion.list())
  assert.equal(beforeFeedback[0].pending.deliveries, 0)
  assert.equal(beforeCompletion[0].deliveries, 0)
  const reserve = completion.reserve
  // Change controls after real preparation, before the provider sees the request.
  completion.reserve = async (...args) => {
    await reserve(...args)
    const controls = ctx.contextCareRequests.controls
    await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'dsh-context-care:completion',
      ruleId: 'completion', actionId: 'notice', enabled: false })
  }
  t.after(() => { completion.reserve = reserve })
  const signal = new AbortController().signal
  const prepared = await ctx.contextCareRequests.prepareCall({ provider: 'care-test', model: 'care-test' }, signal)
  const request = { ...prepared.config, signal, sessionId: agent.id, messages: agent.session.deriveMessages() }
  await assert.rejects(async () => { for await (const chunk of prepared.stream(request)) void chunk }, { code: 'CONTROL_CHANGED' })
  assert.deepEqual(ctx.contextCareRequests.feedback(agent.id), beforeFeedback)
  assert.deepEqual(completion.list(), [], 'the disabled generation cannot contribute old completion notices')
  assert.equal(agent.session.snapshotEvents().some(event => event.type === 'request/header'
    && event.data.contextCarePrompt?.callId === prepared.callId), false,
  'a refused preparation must not leave a completion-delivery receipt')
  const call = ctx.contextCareRequests.snapshot(prepared.callId)
  assert.equal(call.dispatched, false)
  assert.equal(call.record.phase, 'failed')
  assert.equal(call.record.outcome, 'not-dispatched')
  assert.equal(call.record.failure.code, 'CONTROL_CHANGED')
})

test('source disposal during preflight invalidates a request even without a preference revision change', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('source-disposal-preflight', { provider: 'care-test', model: 'care-test' })
  const controls = ctx.contextCareRequests.controls
  const remove = controls.register(registeredRuleSource)
  t.after(remove)
  const initialRevision = controls.revision(agent.id)
  const completion = ctx.get('contextCareCompletion')
  const reserve = completion.reserve
  completion.reserve = async (...args) => { await reserve(...args); remove() }
  t.after(() => { completion.reserve = reserve })
  const signal = new AbortController().signal
  const prepared = await ctx.contextCareRequests.prepareCall({ provider: 'care-test', model: 'care-test' }, signal)
  await assert.rejects(async () => {
    for await (const chunk of prepared.stream({ ...prepared.config, signal, sessionId: agent.id, messages: [] })) void chunk
  }, { code: 'CONTROL_CHANGED' })
  assert.equal(controls.revision(agent.id), initialRevision)
  assert.equal(adapter.requests.length, 0)
  assert.equal(ctx.contextCareRequests.snapshot(prepared.callId).dispatched, false)
})

test('completion Session replay restores a bounded notice and delivers it on the next natural request', async t => {
  const owned = await fixture(t)
  let ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: '任务完成了。' }] }]))
  let agent = await ctx.agentLoop.create('completion-outbox', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  const log = agent.session.snapshotEvents()
  assert.equal(ctx.get('contextCareCompletion').list()[0].status, 'pending')
  await owned.close(ctx)
  ctx = await owned.open()
  assert.deepEqual(ctx.get('contextCareCompletion').list(), [], 'no side file certifies a Session that has not been restored')
  class NoticeAdapter extends ScriptedAdapter {
    async *stream(options) {
      this.requests.push(options)
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '核对交付并继续工作。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new NoticeAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  agent = (await ctx.agents.create({ sessionId: 'completion-outbox', seed: log, agentOptions: { provider: 'care-test', model: 'care-test' } })).agent
  assert.equal(agent.session.eventAt(log.at(-1).seq).type, log.at(-1).type)
  await completionTurn(ctx, agent)
  const text = adapter.requests[0].messages.flatMap(message => message.content).filter(block => block.text?.includes('上一份输出使用了'))
  assert.equal(text.length, 1)
  assert.match(text[0].text, /输出措辞的观察结果/)
  assert.equal(ctx.get('contextCareCompletion').list()[0].status, 'dispatched')
  assert.ok(agent.session.deriveMessages().every(message => message.content.every(block => !block.text?.includes('上一份输出使用了'))))
})

test('cold completion reconciliation ignores conflicting side files and restores native source cooldown', async t => {
  const owned = await fixture(t)
  let ctx = await owned.open(false)
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([
    { blocks: [{ type: 'text', text: 'DONE' }] }, { blocks: [{ type: 'text', text: 'DONE' }] },
  ]))
  let agent = await ctx.agentLoop.create('cold-completion', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  await completionTurn(ctx, agent)
  await ctx.contextCareRequests.flush(agent.session.id)
  const records = ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'request')
  // Conflicting legacy data is deliberately present, but is not replay input.
  const store = createCompletionStateStore({ storageDomain: ctx.storageDomain })
  await store.ready
  await store.save(completionStateKey(String(agent.id), 'assistant'), { version: 1,
    cooldownUntil: Number.MAX_SAFE_INTEGER, completedOccurrenceId: 'unrelated-side-file-occurrence' })
  await store.close()
  const log = agent.session.snapshotEvents()
  await owned.close(ctx)
  ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Continue verifying evidence.' }] }]))
  agent = (await ctx.agents.create({ sessionId: 'cold-completion', seed: log, agentOptions: { provider: 'care-test', model: 'care-test' } })).agent
  assert.equal(agent.session.eventAt(records[0].data.eventSeq).type, 'assistant/message')
  await completionTurn(ctx, agent)
  const notices = ctx.contextCareCompletion.list(agent.session.id)
  assert.equal(notices.length, 1, JSON.stringify(notices))
  assert.equal(ctx.storageDomain.get('context_care_completion'), undefined)
  assert.equal(ctx.storageDomain.get('context_care_completion_notices'), undefined)
  assert.equal(notices[0].eventSeq, records[0].data.eventSeq)
  assert.equal(notices[0].status, 'dispatched')
})

test('real JSON storage acknowledges pending, restores it after restart, and retains source isolation', async t => {
  const owned = await fixture(t, false)
  let ctx = await owned.open()
  let store = createCompletionStateStore({ storageDomain: ctx.storageDomain })
  await store.ready
  let observer = createCompletionObserver({ ...store, now: () => 100, cooldownMs: 50 })
  const input = { sessionId: 'session/一', sourceId: 'completion:source', occurrenceId: 'attempt:one', text: '搞定' }
  await observer.observe(input)
  const key = completionStateKey(input.sessionId, input.sourceId)
  assert.equal((await store.load(key)).pending.occurrenceId, 'attempt:one')
  await store.close()
  await owned.close(ctx)
  ctx = await owned.open()
  store = createCompletionStateStore({ storageDomain: ctx.storageDomain })
  await store.ready
  observer = createCompletionObserver({ ...store, now: () => 100, cooldownMs: 50 })
  assert.equal((await store.load(key)).pending.line, '搞定')
  assert.equal((await observer.settle(input)).status, 'completed')
  assert.equal((await observer.observe(input)).status, 'cooldown')
  assert.equal((await observer.observe({ ...input, sourceId: 'other:source' })).status, 'pending')
  assert.equal((await observer.recover({ ...input, sourceId: 'other:source' })).status, 'recovered')
  await store.close()
})

test('real Connection admits session controls, rejects malformed writes, and preserves CAS', async t => {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('rule-http', { provider: 'care-test', model: 'care-test' })
  const path = `/context-care/rules?sessionId=${agent.id}`
  assert.equal((await fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`)).status, 503)
  const { base, cookie } = await controlCookie(ctx)
  assert.equal((await fetch(`${base}${path}`)).status, 401)
  const headers = { cookie, 'content-type': 'application/json' }
  const get = await fetch(`${base}${path}`, { headers })
  assert.equal(get.status, 200)
  assert.equal(get.headers.get('cache-control'), 'no-store')
  assert.equal((await get.json()).sessionId, agent.id)
  const change = { revision: 0, sourceId: 'dsh-context-care', ruleId: 'state', actionId: 'advice', enabled: false }
  const send = (body, extra = {}) => fetch(`${base}${path}`, { method: 'PATCH', headers: { ...headers, ...extra }, body })
  assert.equal((await send(JSON.stringify(change), { origin: 'http://foreign.test' })).status, 403)
  assert.equal((await send(JSON.stringify(change), { origin: '%%%malformed' })).status, 403)
  assert.equal((await send(JSON.stringify(change), { 'content-type': 'application/jsonBAD' })).status, 415)
  assert.equal((await send('{')).status, 400)
  assert.equal((await send(JSON.stringify({ ...change, unexpected: true }))).status, 400)
  assert.equal((await send(' '.repeat(65537))).status, 413)
  const result = await send(JSON.stringify(change), { origin: base })
  assert.equal(result.status, 200)
  const saved = await result.json()
  assert.equal(saved.revision, 1)
  assert.equal(saved.sources.find(source => source.sourceId === change.sourceId).rules.find(rule => rule.id === 'state').actions.find(action => action.id === 'advice').selected, false)
  assert.equal((await send(JSON.stringify(change))).status, 409)
  assert.equal(ctx.contextCareControls.revision(agent.id), 1)
  assert.equal((await fetch(`${base}/context-care/rules?sessionId=missing`, { headers })).status, 404)
})

test('real prompt evidence replays from Session with an empty request journal', async t => {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  await addFixtureRow(ctx, '@care-test/rules')
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Continue.' }] }]))
  const options = { provider: 'care-test', model: 'care-test' }
  const agent = await ctx.agentLoop.create('prompt-session-evidence', options)
  await completionTurn(ctx, agent, 'MEMORIZE the evidence in this session.')
  await ctx.contextCareRequests.flush(agent.id)
  const records = ctx.contextCareRequests.list(agent.id)
  assert.equal(records.filter(record => record.data.action === 'rule-evaluation').length, 0,
    'a rule evaluation must not create an additional action_<uuid>.json')
  const log = agent.session.snapshotEvents()
  const notice = log.find(event => event.type === 'user/message' && event.data.source.contextCareTrace?.evaluation)
  assert.ok(notice, 'the real rule engine must deliver its evaluation in the message')
  const expected = ensureSessionLog(ctx).withLive(agent.session, log => contextCarePrompts([], agent.session, log)).find(prompt => prompt.seq === notice.seq)
  assert.equal(expected.evaluations.length, 1)
  assert.deepEqual(expected.evaluations[0].facts, notice.data.source.contextCareTrace.evaluation.facts)
  await owned.close(ctx)

  // A different real Loader/storage root has no context-care side tables to restore.
  // Reopen only the actual log produced above through the public Agent seed API.
  const fresh = await fixture(t, false)
  const reopened = await fresh.open()
  reopened.llm.registerAdapter(['care-test'], new CompletionAdapter([]))
  const restored = (await reopened.agents.create({ sessionId: agent.id, seed: log, agentOptions: options })).agent
  const reconstructed = reopened.contextCareRequests.list(agent.id)
  assert.equal(reconstructed.filter(record => record.kind === 'maintenance').length, 0)
  assert.ok(reconstructed.some(record => record.kind === 'request'), 'the request query now reads committed Session facts')
  const actual = ensureSessionLog(reopened).withLive(restored.session, log => contextCarePrompts(reconstructed, restored.session, log)).find(prompt => prompt.seq === notice.seq)
  assert.deepEqual(actual, expected)
})

test('Loader registrants execute declared rules, respect toggles, and unload without losing persisted choices', async t => {
  const owned = await fixture(t, false)
  let ctx = await owned.open()
  const row = await addFixtureRow(ctx, '@care-test/rules')
  const adapter = new CompletionAdapter(Array.from({ length: 6 }, () => ({ blocks: [{ type: 'text', text: 'Continue the current work.' }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('rule-actions', { provider: 'care-test', model: 'care-test' })
  const control = ctx.contextCareControls
  const change = input => control.patch(agent.id, { revision: control.revision(agent.id), sourceId: 'test-memory', ruleId: 'remember', ...input })
  const generated = () => agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.content.some(block => block.text === registeredRuleSource.rules[0].definition.action.say)).length
  assert.equal(control.snapshot(agent.id).sources.find(source => source.sourceId === 'test-memory').plugin, 'example-memory-plugin')
  await completionTurn(ctx, agent, 'MEMORIZE the initial evidence.')
  assert.equal(generated(), 1, JSON.stringify({ events: agent.session.snapshotEvents().filter(event => event.type === 'turn/end'), journal: ctx.contextCareRequests.list(agent.id).map(record => ({ kind: record.kind, evaluation: record.data.evaluation })), external: control.catalog(agent.id).find(source => source.sourceId === 'test-memory') }))
  await change({ actionId: 'notify', enabled: false })
  await completionTurn(ctx, agent, 'MEMORIZE the disabled occurrence.')
  assert.equal(generated(), 1)
  await change({ actionId: 'notify', enabled: true })
  await completionTurn(ctx, agent, 'Continue without requesting memory.')
  assert.equal(generated(), 1)
  await completionTurn(ctx, agent, 'MEMORIZE the newly requested evidence.')
  assert.equal(generated(), 2)
  await change({ paused: true })
  assert.equal(control.enabled(agent.id, 'test-memory', 'remember', 'notify'), false)
  await change({ paused: false })
  assert.equal(control.enabled(agent.id, 'test-memory', 'remember', 'notify'), true)
  await change({ actionId: 'notify', enabled: false })
  await row.fiber.dispose()
  assert.equal(control.snapshot(agent.id).sources.some(source => source.sourceId === 'test-memory'), false)
  await owned.close(ctx)
  ctx = await owned.open()
  await addFixtureRow(ctx, '@care-test/rules')
  assert.equal(ctx.contextCareControls.enabled(agent.id, 'test-memory', 'remember', 'notify'), false)
  assert.equal(ctx.contextCareControls.enabled('other-session', 'test-memory', 'remember', 'notify'), true)
})

test('native activity pushes retained pages and rewrite deltas without follow-up HTTP requests', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  const { base, cookie } = await controlCookie(ctx)
  const session = ctx.sessions.create('direct-push')
  const routes = []; const errors = []; const frames = []
  const changes = createClientChanges({ fetcher: (url, options) => {
    routes.push(new URL(url, base).pathname)
    return fetch(new URL(url, base), { ...options, headers: { ...options.headers, cookie } })
  }, report: error => errors.push(error) })
  const status = createActionRecords({ changes, collection: 'status' })
  const actions = createActionRecords({ changes })
  const prompts = createActionRecords({ changes, collection: 'prompts' })
  const rewrites = createRewriteRecords({ changes, report: error => errors.push(error) })
  const releases = [status.watch(session.id), actions.watch(session.id), prompts.watch(session.id), rewrites.watch(session.id),
    changes.subscribe({ sessionId: session.id, topic: 'rewrites' }, frame => frames.push(frame))]
  t.after(() => { for (const release of releases) release(); status.dispose(); actions.dispose(); prompts.dispose(); rewrites.dispose(); changes.dispose() })
  const wait = (source, predicate) => new Promise((resolve, reject) => {
    if (predicate()) { resolve(); return }
    const timer = setTimeout(() => { stop(); reject(new Error(`pushed data did not arrive: ${JSON.stringify(errors.map(String))}`)) }, 5000)
    const stop = source.subscribe(() => { if (predicate()) { clearTimeout(timer); stop(); resolve() } })
  })
  await wait(actions.source, () => actions.source.getSnapshot().get(`${session.id}:0`)?.status === 'ready')
  await wait(rewrites.health, () => rewrites.health.getSnapshot().get(session.id)?.status === 'ready')
  assert.deepEqual(routes, ['/context-care/changes'])
  const initialRewriteFrames = frames.length
  const fullRewriteList = t.mock.method(ctx.contextCareRequests, 'list', () => { throw new Error('rewrite-full-list') })
  const fullRewriteView = t.mock.method(ctx.contextCareRequests, 'view', () => { throw new Error('rewrite-full-view') })
  const config = { provider: 'care-test', model: 'care-test' }
  for (let index = 0; index < 12; index++) {
    session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `Turn ${index}` }] }), { surfaceOp: 'append' })
    session.append('request/header', { header: { config }, reason: 'series' })
    session.append('assistant/message', { turn: index + 1, step: 1, stream: [], message: createMessage({ role: 'assistant',
      source: { kind: 'model', ...config }, content: [{ type: 'text', text: 'Ordinary answer.' }] }) }, { surfaceOp: 'append' })
    ctx.contextCareControls.sample(session.id, { fatigue: 'normal', fatigueValue: index, wakefulness: 'normal', wakefulnessValue: 50 })
    await wait(status.source, () => status.source.getSnapshot().get(`${session.id}:0`)?.currentState?.fatigueValue === index)
  }
  assert.equal(frames.length, initialRewriteFrames, 'ordinary dialogue never invalidates rewrite records')
  await ctx.contextCareRequests.recordAction(session, { action: 'request-rewrite', phase: 'recorded', rewrite: { sessionId: session.id, hash: 'new-rewrite' } })
  await wait(rewrites.records, () => rewrites.records.getSnapshot().has(`${session.id}:new-rewrite`))
  assert.equal(frames.at(-1).type, 'delta'); assert.equal(frames.at(-1).value.records.length, 1)
  assert.equal(fullRewriteList.mock.callCount(), 0); assert.equal(fullRewriteView.mock.callCount(), 0)
  await ctx.contextCareRequests.recordAction(session, { action: 'prune', phase: 'completed', operationId: 'native-action' })
  await wait(actions.source, () => actions.source.getSnapshot().get(`${session.id}:0`)?.actions.some(action => action.id === 'native-action'))
  assert.deepEqual(routes, ['/context-care/changes'], 'continuous activity has no actions, prompts or rewrite-journal GETs')
  assert.deepEqual(errors, [])
  t.diagnostic(JSON.stringify({ turns: 12, httpRequests: routes, rewriteFrames: frames.length }))
})

test('long Session diagnostic queries keep unrelated HTTP responsive and push only actual changes', { timeout: 120000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  const { base, cookie } = await controlCookie(ctx)
  const headers = { cookie }
  const session = ctx.sessions.create('long-session-diagnostics')
  const config = { provider: 'care-test', model: 'care-test' }
  // These are real committed headers with request-only changes, not fake services.
  const tools = Array.from({ length: 120 }, (_, index) => ({ name: `tool_${index}`, description: 'A documented tool. '.repeat(60),
    parameters: { type: 'object', properties: { text: { type: 'string' } } } }))
  const messages = Array.from({ length: 200 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user',
    content: [{ type: 'text', text: `Historical message ${index}. ` }], source: { kind: 'user' } }))
  for (let index = 0; index < 350; index++) {
    const callId = `long-call-${index}`
    session.append('request/header', { header: { config, tools }, reason: 'series', contextCareWorkbench: { callId, diff: { after: { messages } } } })
    session.append('assistant/message', { turn: index + 1, step: 1, stream: [], usage: { inputTokens: 100, outputTokens: 1 },
      message: createMessage({ role: 'assistant', source: { kind: 'model', ...config }, content: [{ type: 'text', text: 'Recorded answer.' }] }) }, { surfaceOp: 'append' })
  }
  const journal = await openRequestJournal({ sessions: ctx.sessions, logs: ensureSessionLog(ctx), measureInput: () => ({ textTokens: 50, visualTokens: 0 }) })
  t.after(() => journal.close())
  const measured = (run, count = 1) => { const start = performance.now(); for (let index = 0; index < count; index++) run(); return performance.now() - start }
  const cpuStart = process.cpuUsage(); const wallStart = performance.now()
  const eventLoopStart = performance.eventLoopUtilization()
  const turnStart = performance.now()
  const nextTurnDelay = new Promise(resolve => setImmediate(() => resolve(performance.now() - turnStart)))
  const coldListMs = measured(() => journal.list(session.id))
  const repeatListMs = measured(() => journal.list(session.id), 20)
  const previousRouteMs = measured(() => journal.previousRoute(session, 'conversation'), 20)
  // No compatible sample: expose repeated hashing of the same large header.
  const unmatchedCalibrationMs = measured(() => journal.calibrationRecords(session, { config: { ...config, model: 'unmatched' }, tools }), 20)
  const synchronousCpu = process.cpuUsage(cpuStart)
  const queryWallMs = performance.now() - wallStart
  const queryCpuMs = (synchronousCpu.user + synchronousCpu.system) / 1000
  const nextTurnDelayMs = await nextTurnDelay
  const queryEventLoopUtilization = performance.eventLoopUtilization(eventLoopStart).utilization
  const httpMs = []; const unrelatedMs = []
  for (let index = 0; index < 5; index++) {
    const start = performance.now()
    const diagnostic = fetch(`${base}/context-care/prompts?sessionId=${session.id}&limit=20`, { headers }).then(async response => {
      assert.equal(response.status, 200); await response.json(); httpMs.push(performance.now() - start)
    })
    const unrelated = fetch(`${base}/context-care/rules?sessionId=${session.id}`, { headers }).then(async response => {
      assert.equal(response.status, 200); await response.json(); unrelatedMs.push(performance.now() - start)
    })
    await Promise.all([diagnostic, unrelated])
  }
  const report = { events: session.seq, settledRequests: 350, coldListMs, repeatListMs, previousRouteMs, unmatchedCalibrationMs,
    queryWallMs, queryCpuMs, nextTurnDelayMs, queryEventLoopUtilization, httpMs, unrelatedMs }
  // Broad regression ceilings catch the reproduced seconds-long stall while
  // allowing normal CI scheduling variation; raw measurements remain in output.
  assert.ok(repeatListMs < 1000, `repeated history reads blocked for ${repeatListMs}ms`)
  assert.ok(previousRouteMs < 250, `route lookup blocked for ${previousRouteMs}ms`)
  assert.ok(unmatchedCalibrationMs < 1000, `calibration lookup blocked for ${unmatchedCalibrationMs}ms`)
  assert.ok(Math.max(...unrelatedMs) < 1000, `unrelated HTTP blocked for ${Math.max(...unrelatedMs)}ms`)
  t.diagnostic(`long-session-performance ${JSON.stringify(report)}`)
  if (process.env.DSH_PERFORMANCE_REPORT) await writeFile(process.env.DSH_PERFORMANCE_REPORT, JSON.stringify(report, null, 2) + '\n')
  const controller = new AbortController()
  const query = new URLSearchParams({ subscription: JSON.stringify({ sessionId: session.id, topic: 'actions' }) })
  const response = await fetch(`${base}/context-care/changes?${query}`, { headers, signal: controller.signal })
  assert.equal(response.status, 200)
  const reader = response.body.getReader(); const decoder = new TextDecoder()
  try {
    const first = await reader.read()
    assert.ok(first.value); assert.equal(JSON.parse(decoder.decode(first.value).trim()).sessionId, session.id)
    const next = reader.read()
    ctx.contextCareChanges.changed('unrelated-session', ['controls'])
    await ctx.contextCareRequests.recordAction(session, { action: 'prune', phase: 'completed', operationId: 'pushed-action' })
    const value = await next
    const change = JSON.parse(decoder.decode(value.value).trim())
    assert.equal(change.type, 'snapshot')
    assert.equal(change.topic, 'actions')
    assert.equal(change.value.actions[0].id, 'pushed-action')
  } finally { controller.abort(); await reader.cancel().catch(() => {}); reader.releaseLock() }
})

test('Workbench v2 edits request copies, renders strict entry templates, logs the diff and preserves committed source text', async t => {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  class WorkbenchAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) {
      this.requests.push(request)
      const raw = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }).decomposeRequest(request)
      for await (const chunk of super.stream(request)) {
        if (chunk.type === 'usage') continue
        if (chunk.type === 'finish') yield { type: 'usage', usage: { inputTokens: raw.textTokens * 2 + raw.visualTokens } }
        yield chunk
      }
    }
  }
  const adapter = new WorkbenchAdapter([{ blocks: [{ type: 'text', text: 'The requested work is continuing.' }] }])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-request', { provider: 'care-test', model: 'care-test' })
  const service = ctx.contextCareWorkbench
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: {
    schemaVersion: 2, id: 'editable', revision: 1, title: 'Editable rules', variables: [{ name: 'label', scope: 'session', type: 'string', default: 'literal {{unused}}' }],
    rules: [{ schemaVersion: 2, sourceId: 'context-care:document:editable', id: 'rewrite', revision: 1, title: 'Replace request text', on: ['request.assemble'],
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'BEFORE' }, priority: 0,
      actions: [{ id: 'replace', kind: 'replace', stage: 'request.assemble', enabledDefault: true, template: 'AFTER' }] }],
    entries: [{ id: 'entry', revision: 1, title: 'Entry', enabledDefault: true, template: 'Keep {{vars.label}}.', activation: { kind: 'constant' },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } }],
  } })
  await completionTurn(ctx, agent, 'BEFORE is the original request.')
  const sent = adapter.requests.find(request => request.purpose !== 'compaction')
  assert.match(JSON.stringify(sent.messages), /AFTER is the original request/)
  assert.match(JSON.stringify(sent.messages), /Keep literal \{\{unused\}\}\./)
  const original = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  assert.match(JSON.stringify(original), /BEFORE/)
  assert.doesNotMatch(JSON.stringify(original), /AFTER/)
  const audit = agent.session.snapshotEvents().find(event => event.type === 'request/header' && event.data.contextCareWorkbench)
  assert.ok(audit, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')))
  assert.match(JSON.stringify(audit.data.contextCareWorkbench.diff.after), /AFTER/)
  assert.equal(audit.data.contextCareWorkbench.injectionBudget.kind, 'estimate')
  assert.ok(audit.data.contextCareWorkbench.injectionBudget.tokens > 0)
  assert.equal(audit.data.contextCareWorkbench.impact.providerSerialization, 'unknown')
  assert.equal(audit.data.contextCareWorkbench.impact.cacheHitTokens, null)
  assert.equal(ctx.contextCareControls.snapshot(agent.id).sources.find(source => source.sourceId === 'context-care:document:editable').rules.length, 2)
  const seq = agent.session.seq
  const cold = await openRequestJournal({ sessions: ctx.sessions, logs: ensureSessionLog(ctx),
    measureInput: (session, request) => captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session }).decomposeRequest(request) })
  const samples = cold.calibrationRecords(agent.session, agent.session.requestHeader())
  const pricing = captureInputPricing({ history: ensureSessionLog(ctx), meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  assert.equal(samples.length, 1)
  assert.deepEqual(samples[0].data.rawInput, pricing.decomposeRequest(sent),
    'cold recovery must price the logged AFTER request and injected entry, not the original BEFORE surface')
  assert.equal(agent.session.seq, seq, 'reconstructing input appends no new events or rule evaluations')
  assert.equal(adapter.requests.length, 1, 'reconstructing input dispatches no new provider request')
  await cold.close()
})

test('Workbench cold nested model bodies copy once per message and preserve independent writable plans', async t => {
  const owned = await fixture(t, false), ctx = await owned.open(), service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('nested-body-ownership', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'nested', revision: 1, title: 'Nested',
    rules: [{ schemaVersion: 2, id: 'replace', revision: 1, on: ['request.assemble'],
      select: { view: 'model', roles: ['tool'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '^NESTED' },
      actions: [{ id: 'replace', kind: 'replace', stage: 'request.assemble', enabledDefault: true, template: 'PATCHED' }] }],
  } })
  const messages = []
  for (let index = 0; index < 32; index++) {
    let content = [{ type: 'text', text: `NESTED ${index} ` + 'x'.repeat(512) }]
    for (let depth = 0; depth < 8; depth++) content = [{ type: 'tool-result', callId: `inner-${index}-${depth}`, content }]
    const message = createToolResultMessage({ callId: `outer-${index}`, content, isError: false })
    agent.session.append('tool/result', { turn: 1, step: 1, message }, { surfaceOp: 'append' }); messages.push(message)
  }
  const request = { provider: 'care-test', model: 'care-test', messages }, before = structuredClone(request)
  const payloads = new Set(messages.map(message => message.content)), copies = t.mock.method(globalThis, 'structuredClone')
  const ownedCopies = () => copies.mock.calls.filter(call => payloads.has(call.arguments[0]?.content)
    && Object.keys(call.arguments[0]).length === 2 && Object.hasOwn(call.arguments[0], 'source')).length
  const native = t.mock.method(agent.session, 'eventAt'), snapshots = t.mock.method(agent.session, 'snapshotEvents')
  const readText = message => { let content = message.content; for (let depth = 0; depth < 8; depth++) content = content[0].content; return content[0] }
  const first = await service.preview(agent, request)
  assert.equal(first.applied.length, 32); assert.equal(ownedCopies(), 32, 'eight nested ancestors never copy the child subtree again')
  for (let index = 0; index < messages.length; index++) assert.equal(readText(first.request.messages[index]).text, `PATCHED ${index} ` + 'x'.repeat(512))
  assert.deepEqual(request, before); const nativeReads = native.mock.callCount()
  readText(first.request.messages[0]).text = 'OUTPUT WRITE'
  const second = await service.preview(agent, request)
  assert.equal(second.applied.length, 32); assert.equal(ownedCopies(), 64, 'an independent preview owns a fresh tree, never a mutable-request identity cache')
  assert.match(readText(second.request.messages[0]).text, /^PATCHED 0 /); assert.match(readText(messages[0]).text, /^NESTED 0 /)
  const changed = structuredClone(request); readText(changed.messages[0]).text = 'CHANGED'
  const third = await service.preview(agent, changed)
  assert.equal(third.applied.length, 31); assert.equal(readText(third.request.messages[0]).text, 'CHANGED')
  assert.equal(readText(first.request.messages[0]).text, 'OUTPUT WRITE'); assert.match(readText(second.request.messages[0]).text, /^PATCHED 0 /)
  assert.equal(native.mock.callCount(), nativeReads); assert.equal(snapshots.mock.callCount(), 0); assert.deepEqual(request, before)
  assert.ok(!ensureSessionLog(ctx).cache.report().some(row => row.name === 'request-model-projection' || row.name.startsWith('request-plan-')))
})

test('Workbench v2 records all-token-skipped request decisions in the real dispatch log without spending successful state', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  const previous = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care/requests')
  await previous.fiber.dispose()
  await ctx.loader.create({ name: 'dsh-context-care/requests', config: { maxInjectedTokens: 1 } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) if (entry.options.name === 'dsh-context-care/requests') await entry.fiber.await()
  class RecordingAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) { this.requests.push(request); yield* super.stream(request) }
  }
  const adapter = new RecordingAdapter([{ blocks: [{ type: 'text', text: 'Complete.' }] }]); ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('budget-all-skipped', { provider: 'care-test', model: 'care-test' })
  await ctx.contextCareWorkbench.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'budget-skipped', revision: 1, title: 'Skipped',
    entries: [{ id: 'large', revision: 1, title: 'Large', enabledDefault: true, template: 'THIS INJECTION MUST BE SKIPPED', lifetime: 'session',
      activation: { kind: 'constant' }, select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model' } }] } })
  await completionTurn(ctx, agent, 'Continue the requested work.')
  assert.equal(adapter.requests.length, 1)
  assert.doesNotMatch(JSON.stringify(adapter.requests[0].messages), /THIS INJECTION MUST BE SKIPPED/)
  const audit = agent.session.snapshotEvents().find(event => event.type === 'request/header' && event.data.contextCareWorkbench)?.data.contextCareWorkbench
  assert.ok(audit, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')))
  assert.equal(audit.records.find(record => record.ruleId === 'entry:large').reason, 'injection-token-budget-exceeded')
  assert.equal(audit.injectionBudget.tokens, 0); assert.equal(audit.impact.cacheHitTokens, null)
  assert.equal(ctx.contextCareWorkbench.store.read(agent.id).runtime.state[JSON.stringify(['context-care:document:budget-skipped', 'entry:large', 1, 'inject'])], undefined)
})

test('Workbench cascades preserve original-selected model injection anchors', async t => {
  const owned = await fixture(t, false), ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('cross-view-cascade', { provider: 'care-test', model: 'care-test' })
  const message = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'START_CHAIN' }] })
  agent.session.append('user/message', message, { surfaceOp: 'append' })
  const entry = (id, view, keyword, template, cascade) => ({ id, revision: 1, title: id, enabledDefault: true, template, cascade,
    activation: { kind: 'keywords', keywords: [keyword] }, select: { view, roles: ['user'], blockTypes: ['text'] },
    target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } })
  await ctx.contextCareWorkbench.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'cross-view', revision: 1, title: 'Cross view',
    entries: [entry('first', 'original', 'START_CHAIN', 'SECOND_LINK', false), entry('second', 'model', 'SECOND_LINK', 'FINAL_LINK', true)] } })
  const request = { messages: [message] }, before = structuredClone(request)
  const result = await ctx.contextCareWorkbench.preview(agent, request)
  assert.equal(result.applied.length, 2)
  assert.deepEqual(result.request.messages.slice(1).map(message => message.content[0].text), ['SECOND_LINK', 'FINAL_LINK'])
  assert.deepEqual(request, before)
  assert.ok(!ensureSessionLog(ctx).cache.report().some(row => row.name === 'request-model-projection' || row.name.startsWith('request-plan-')))
})

test('Workbench cascade rule index preserves 64 same-named entries across sources without historical replay', async t => {
  const owned = await fixture(t, false), ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('indexed-cascade-sources', { provider: 'care-test', model: 'care-test' }), service = ctx.contextCareWorkbench
  const message = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'ROOT_INDEX_START' }] })
  agent.session.append('user/message', message, { surfaceOp: 'append' })
  const entry = (id, keyword, template, cascade) => ({ id, revision: 1, title: id, enabledDefault: true, template, cascade,
    activation: { kind: 'keywords', keywords: [keyword] }, select: { view: 'model', roles: ['user'], blockTypes: ['text'] },
    target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } })
  const put = async (id, entries) => service.store.edit(agent.id, { revision: service.store.read(agent.id).revision, operation: 'put-document',
    document: { schemaVersion: 2, id, revision: 1, title: id, entries } })
  await put('index-seed', [entry('seed', 'ROOT_INDEX_START', 'INDEX_CASCADE_MATCH', false),
    entry('not-cascade', 'INDEX_CASCADE_MATCH', 'MUST_NOT_REPLAY', false)])
  for (const source of ['index:left', 'index:right']) await put(source, Array.from({ length: 32 }, (_, index) =>
    entry(`same-${index}`, 'INDEX_CASCADE_MATCH', `FINAL_${source}_${index}`, true)))
  const request = { messages: [message] }, before = structuredClone(request), beforeStore = service.store.read(agent.id)
  const native = t.mock.method(agent.session, 'eventAt'), snapshots = t.mock.method(agent.session, 'snapshotEvents')
  const first = await service.preview(agent, request)
  assert.equal(first.applied.length, 65); assert.equal(first.records.filter(row => row.cascadePass === 1).length, 64)
  for (const source of ['index:left', 'index:right']) for (let index = 0; index < 32; index++) {
    assert.equal(first.applied.filter(item => item.event.sourceId === `context-care:document:${source}` && item.event.ruleId === `entry:same-${index}`).length, 1)
    assert.equal(first.request.messages.filter(message => message.content.some(block => block.type === 'text' && block.text === `FINAL_${source}_${index}`)).length, 1)
  }
  assert.doesNotMatch(JSON.stringify(first.request), /MUST_NOT_REPLAY/)
  const reads = native.mock.callCount(), second = await service.preview(agent, request)
  assert.deepEqual(second.request, first.request); assert.equal(second.applied.length, 65)
  assert.equal(native.mock.callCount(), reads); assert.equal(snapshots.mock.callCount(), 0)
  first.request.messages[0].content[0].text = 'WRITABLE_FIRST'
  assert.equal(second.request.messages[0].content[0].text, 'ROOT_INDEX_START')
  assert.deepEqual(request, before); assert.deepEqual(service.store.read(agent.id), beforeStore)
  assert.ok(!ensureSessionLog(ctx).cache.report().some(row => row.name === 'request-model-projection' || row.name.startsWith('request-plan-')))
})

test('Workbench v2 cascades only explicit entries, previews without writes and rejects stale automatic variable snapshots', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  const adapter = new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Complete.' }] }]); ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-cascade', { provider: 'care-test', model: 'care-test' }); const service = ctx.contextCareWorkbench
  const entry = (id, keyword, template, cascade) => ({ id, revision: 1, title: id, enabledDefault: true, template, cascade,
    activation: { kind: 'keywords', keywords: [keyword] }, select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'cascade', revision: 1, title: 'Cascade',
    variables: [{ name: 'value', scope: 'session', type: 'number', default: 1 }], entries: [entry('baseline', 'START_CHAIN', 'SECOND_LINK', false),
      entry('second', 'SECOND_LINK', 'THIRD_LINK', true), entry('third', 'THIRD_LINK', 'START_CHAIN', true), entry('no-cascade', 'SECOND_LINK', 'MUST_NOT_APPEAR', false)] } })
  const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'START_CHAIN' }] }] }
  const before = service.store.read(agent.id); const planned = await service.preview(agent, request)
  assert.deepEqual(service.store.read(agent.id), before)
  const text = JSON.stringify(planned.request.messages)
  assert.match(text, /SECOND_LINK/); assert.match(text, /THIRD_LINK/); assert.doesNotMatch(text, /MUST_NOT_APPEAR/)
  assert.equal(planned.applied.length, 3)
  assert.equal(planned.records.filter(record => record.cascadePass).length, 2)
  assert.doesNotThrow(() => service.assertCurrent(agent, planned))
  await service.store.automaticVariable(agent.id, before.documents[0].variables[0], 2, 'turn')
  assert.throws(() => service.assertCurrent(agent, planned), { code: 'CONTROL_CHANGED' })
})

test('Workbench action dependency structure builds once per rule across 128 evidence occurrences and keeps paused outcomes separate', { timeout: 120000 }, async t => {
  const owned = await fixture(t, false), ctx = await owned.open(), service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('action-dependency-reuse', { provider: 'care-test', model: 'care-test' })
  const messages = Array.from({ length: 128 }, (_, index) => createMessage({ role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: `DEPENDENCY ${index}` }] }))
  for (const message of messages) agent.session.append('user/message', message, { surfaceOp: 'append' })
  const actions = Array.from({ length: 31 }, (_, index) => { const number = 30 - index; return { id: `step-${number}`, kind: 'notify',
    stage: 'request.assemble', enabledDefault: true, template: `NOTICE ${number}`, dependsOn: number ? [`step-${number - 1}`] : [] } })
  actions.push({ id: 'free', kind: 'notify', stage: 'request.assemble', enabledDefault: true, template: 'FREE', dependsOn: [] })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'dependency-reuse', revision: 1, title: 'Dependencies',
    rules: [{ schemaVersion: 2, id: 'chain', revision: 1, on: ['request.assemble'], select: { view: 'model', roles: ['user'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: '^DEPENDENCY' }, actions }] } })
  const cache = ensureSessionLog(ctx).cache, worked = t.mock.method(cache, 'worked')
  const work = () => worked.mock.calls.filter(call => call.arguments[0].name === 'request-plan-actions').reduce((sum, call) => sum + call.arguments[1], 0)
  const native = t.mock.method(agent.session, 'eventAt'), snapshots = t.mock.method(agent.session, 'snapshotEvents')
  const request = { messages }, before = structuredClone(request), storeBefore = service.store.read(agent.id)
  const first = await service.preview(agent, request)
  assert.equal(first.applied.length, 4096); assert.equal(work(), 32, '128 occurrences share the one 32-action structural projection')
  const expected = [...Array.from({ length: 31 }, (_, index) => `step-${index}`), 'free']
  const occurrences = new Set(first.records.map(row => row.occurrenceId)); assert.equal(occurrences.size, 128)
  for (const occurrence of occurrences) assert.deepEqual(first.records.filter(row => row.occurrenceId === occurrence).map(row => row.actionId), expected)
  assert.equal(first.request, request, 'notification-only planning still borrows the unchanged request')
  assert.deepEqual(service.store.read(agent.id), storeBefore); const nativeReads = native.mock.callCount()
  await ctx.contextCareControls.patch(agent.id, { revision: ctx.contextCareControls.revision(agent.id), sourceId: 'context-care:document:dependency-reuse', ruleId: 'chain', actionId: 'step-0', enabled: false })
  const historical = await service.preview(agent, request)
  assert.equal(historical.applied.length, 0, 'a control toggle never replays old evidence, even for the independent free action')
  assert.equal(historical.records.filter(row => row.actionId === 'free' && row.reason === 'historical-evidence').length, 128)
  assert.equal(native.mock.callCount(), nativeReads); assert.equal(work(), 64)
  const appendFresh = label => {
    const messages = Array.from({ length: 128 }, (_, index) => createMessage({ role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: `DEPENDENCY ${label} ${index}` }] }))
    for (const message of messages) agent.session.append('user/message', message, { surfaceOp: 'append' })
    return { messages }
  }
  const freshPaused = appendFresh('PAUSED'), pausedBefore = structuredClone(freshPaused)
  const paused = await service.preview(agent, freshPaused)
  assert.equal(paused.applied.length, 128); assert.ok(paused.applied.every(item => item.action.id === 'free'))
  assert.equal(paused.records.filter(row => row.reason === 'dependency-disabled').length, 128 * 30, 'live control dependency rejection still precedes per-evidence planner outcomes')
  assert.equal(work(), 96, 'each independent preview builds one structure, never the previous evidence outcomes')
  await ctx.contextCareControls.patch(agent.id, { revision: ctx.contextCareControls.revision(agent.id), sourceId: 'context-care:document:dependency-reuse', ruleId: 'chain', actionId: 'step-0', enabled: true })
  const freshResumed = appendFresh('RESUMED'), resumedBefore = structuredClone(freshResumed)
  const resumed = await service.preview(agent, freshResumed)
  assert.equal(resumed.applied.length, 4096); assert.equal(work(), 128)
  assert.deepEqual(request, before); assert.deepEqual(freshPaused, pausedBefore); assert.deepEqual(freshResumed, resumedBefore)
  assert.equal(native.mock.callCount(), nativeReads + 256, 'only the two newly appended batches are read')
  assert.equal(snapshots.mock.callCount(), 0)
  assert.ok(!cache.report().some(row => row.name.startsWith('request-plan-') || row.name === 'request-model-projection'))
})

test('Workbench planning tokens retain synchronous template and source invalidation and exact restored equality', async t => {
  for (const mutation of ['template-remove', 'source-remove', 'template-restore']) {
    const owned = await fixture(t, false), ctx = await owned.open()
    const service = ctx.contextCareWorkbench
    const agent = await ctx.agentLoop.create(`planning-token-${mutation}`, { provider: 'care-test', model: 'care-test' })
    let renders = 0, removeSource, removeHelper
    removeHelper = service.registerHelper({ name: 'changePolicy', revision: 1, render: () => {
      renders++
      if (renders === 1) {
        if (mutation === 'source-remove') removeSource()
        else {
          removeHelper()
          if (mutation === 'template-restore') removeHelper = service.registerHelper({ name: 'changePolicy', revision: 1, render: () => 'PATCHED' })
        }
      }
      return 'PATCHED'
    } })
    t.after(() => removeHelper())
    removeSource = service.register({ plugin: 'token-invalidation-test', registrationId: `token-${mutation}`, sessionId: agent.id, documents: [{
      schemaVersion: 2, id: 'token', revision: 1, title: 'Token', rules: [{ schemaVersion: 2, id: 'replace', revision: 1, on: ['request.assemble'],
        select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '^TOKEN' },
        actions: [{ id: 'replace', kind: 'replace', stage: 'request.assemble', enabledDefault: true, template: '{{changePolicy}}' }] }],
    }] })
    t.after(() => removeSource())
    const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'TOKEN first' }] },
      { role: 'user', content: [{ type: 'text', text: 'TOKEN second' }] }] }
    const before = structuredClone(request), stored = service.store.read(agent.id)
    if (mutation === 'template-restore') {
      const result = await service.preview(agent, request)
      assert.equal(result.applied.length, 2); assert.equal(renders, 2, 'exact restored versions retain the original equality semantics')
      assert.deepEqual(result.request.messages.map(message => message.content[0].text), ['PATCHED first', 'PATCHED second'])
    } else {
      await assert.rejects(service.preview(agent, request), /workbench-changed-during-planning/)
      assert.equal(renders, 1, 'the next evidence must observe synchronous policy removal before rendering')
    }
    assert.deepEqual(request, before); assert.deepEqual(service.store.read(agent.id), stored)
    assert.ok(!ensureSessionLog(ctx).cache.report().some(row => row.name.startsWith('request-plan-') || row.name === 'request-model-projection'))
  }
})

test('Workbench v2 shares token and cache budgets across real Host cascade passes without consuming skipped entries', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('budget-cascade', { provider: 'care-test', model: 'care-test' })
  await ctx.contextCareWorkbench.close()
  const { openWorkbenchHost } = await pluginModule('workbench-host.js')
  const { requestImpact } = await pluginModule('request-impact.js')
  const price = text => Math.ceil(ctx.tokenMeter.estimateMessage({ role: 'user', content: [{ type: 'text', text }] }))
  const limited = await openWorkbenchHost(ctx, ctx.contextCareControls, { maxInjectedTokens: price('SECOND_LINK') })
  t.after(() => limited.close())
  const entry = (id, keyword, template, cascade = false, priority = 0) => ({ id, revision: 1, title: id, enabledDefault: true, template, cascade, priority,
    activation: { kind: 'keywords', keywords: [keyword] }, select: { view: 'model', roles: ['user'], blockTypes: ['text'] },
    target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } })
  const unregister = limited.register({ plugin: 'budget-test', registrationId: 'budget-test', sessionId: agent.id, documents: [{ schemaVersion: 2, id: 'budget', revision: 1, title: 'Budget',
    entries: [entry('first', 'START', 'SECOND_LINK', false, 10), entry('low', 'START', 'LOW'), entry('second', 'SECOND_LINK', 'THIRD_LINK', true)] }] })
  t.after(unregister)
  const request = { provider: 'care-test', model: 'care-test', messages: [{ id: 'start', role: 'user', content: [{ type: 'text', text: 'START' }] }] }
  const before = limited.store.read(agent.id); const events = agent.session.snapshotEvents()
  const planned = await limited.preview(agent, request)
  assert.deepEqual(planned.applied.map(item => item.event.ruleId), ['entry:first'])
  assert.deepEqual(planned.injectionBudget, { kind: 'estimate', tokens: price('SECOND_LINK'), limit: price('SECOND_LINK') })
  assert.equal(planned.records.find(record => record.ruleId === 'entry:low').reason, 'injection-token-budget-exceeded')
  assert.equal(planned.records.find(record => record.ruleId === 'entry:second').reason, 'injection-token-budget-exceeded')
  assert.deepEqual(planned.impact, requestImpact(request, planned.request))
  assert.deepEqual(limited.store.read(agent.id), before); assert.deepEqual(agent.session.snapshotEvents(), events)
  assert.deepEqual((await limited.preview(agent, request)).request, planned.request)
  await limited.close()
  const cache = await openWorkbenchHost(ctx, ctx.contextCareControls, { maxCacheChangedBytes: planned.impact.changedSuffixBytes })
  t.after(() => cache.close())
  const dispose = cache.register({ plugin: 'budget-test', registrationId: 'budget-test', sessionId: agent.id, documents: [{ schemaVersion: 2, id: 'budget', revision: 1, title: 'Budget',
    entries: [entry('first', 'START', 'SECOND_LINK', false, 10), entry('second', 'SECOND_LINK', 'THIRD_LINK', true)] }] })
  t.after(dispose)
  const capped = await cache.preview(agent, request)
  assert.deepEqual(capped.request, planned.request)
  assert.equal(capped.records.find(record => record.ruleId === 'entry:second').reason, 'request-cache-change-budget-exceeded')
  assert.deepEqual(capped.impact, requestImpact(request, capped.request))
})

test('Workbench v2 character overflow remains an explicit Host planning failure with no dispatch or runtime write', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('budget-characters', { provider: 'care-test', model: 'care-test' })
  await ctx.contextCareWorkbench.close()
  const { openWorkbenchHost } = await pluginModule('workbench-host.js')
  const bounded = await openWorkbenchHost(ctx, ctx.contextCareControls, { maxInjectedChars: 5, maxCacheChangedBytes: 0 })
  t.after(() => bounded.close())
  const dispose = bounded.register({ plugin: 'budget-test', registrationId: 'character-test', sessionId: agent.id, documents: [{ schemaVersion: 2, id: 'characters', revision: 1, title: 'Characters',
    entries: ['one', 'two'].map(id => ({ id, revision: 1, title: id, enabledDefault: true, template: '123', activation: { kind: 'constant' },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } })) }] })
  t.after(dispose)
  const before = bounded.store.read(agent.id); const events = agent.session.snapshotEvents()
  const request = { messages: [{ id: 'original', role: 'user', content: [{ type: 'text', text: 'START' }] }] }
  await assert.rejects(bounded.preview(agent, request), /total-injection-budget-exceeded/)
  await assert.rejects(bounded.assemble(agent, request), /total-injection-budget-exceeded/)
  assert.deepEqual(bounded.store.read(agent.id), before); assert.deepEqual(agent.session.snapshotEvents(), events)
})

test('Workbench v2 isolates registered sources and rejects conflicts against local and pending document identities', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  const agent = await ctx.agentLoop.create('workbench-sources', { provider: 'care-test', model: 'care-test' }); const service = ctx.contextCareWorkbench
  const doc = (id, variables = [], partials = []) => ({ schemaVersion: 2, id, revision: 1, title: id, variables, partials })
  const variable = { name: 'localValue', scope: 'session', type: 'number', default: 0 }
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: doc('local', [variable], [{ name: 'localPartial', revision: 1, template: 'local' }]) })
  assert.throws(() => service.register({ plugin: 'fixture', registrationId: 'duplicate-id', documents: [doc('local')] }), /source-conflict/)
  assert.throws(() => service.register({ plugin: 'fixture', registrationId: 'duplicate-var', documents: [doc('external', [variable])] }), /variables-conflict/)
  assert.throws(() => service.register({ plugin: 'fixture', registrationId: 'duplicate-partial', documents: [doc('external', [], [{ name: 'localPartial', revision: 1, template: 'other' }])] }), /partials-conflict/)
  assert.throws(() => service.registerPartial({ name: 'localPartial', revision: 1, template: 'override' }), /partial-conflict/)
  const release = service.register({ plugin: 'fixture', registrationId: 'external', sessionId: agent.id, documents: [doc('external')] })
  assert.equal(service.sources(agent.id).find(source => source.registration === 'external').readOnly, true)
  assert.equal(service.sources(agent.id).find(source => source.registration === 'local').readOnly, false)
  await assert.rejects(service.store.edit(agent.id, { revision: 1, operation: 'put-document', document: doc('external') }), /read-only/)
  await assert.rejects(service.store.edit(agent.id, { revision: 1, operation: 'delete-document', documentId: 'external' }), /read-only/)
  const other = await ctx.agentLoop.create('workbench-other-source', { provider: 'care-test', model: 'care-test' })
  assert.equal(service.sources(other.id).length, 0)
  await service.store.edit(other.id, { revision: 0, operation: 'put-document', document: doc('external') })
  assert.equal(service.sources(other.id).find(source => source.registration === 'external').plugin, 'dsh-context-care')
  assert.equal(service.sources(agent.id).find(source => source.registration === 'external').plugin, 'fixture')
  release()
  await service.store.edit(agent.id, { revision: 1, operation: 'put-document', document: doc('external') })
  assert.equal(service.sources(agent.id).find(source => source.registration === 'external').readOnly, false)
  await service.close()
  assert.throws(() => service.registerExecutor({}), /workbench-closed/)
  assert.throws(() => service.registerHelper({}), /workbench-closed/)
})

test('Workbench v2 preserves output history windows without replaying pre-registration or restored output', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('workbench-history', { provider: 'care-test', model: 'care-test' })
  const appendOutput = text => agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 1, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' }, content: [{ type: 'text', text }] }) }, { surfaceOp: 'append' })
  const makeRule = (id, pattern) => ({ schemaVersion: 2, sourceId: 'assigned-by-owner', id, revision: 1, title: id, on: ['output.complete'],
    select: { view: 'original', roles: ['assistant'], blockTypes: ['text'], crossBlock: true, separator: '\n', depth: { unit: 'message', limit: 2 } }, match: { kind: 'regex', pattern },
    actions: [{ id: 'notice', kind: 'notify', template: '{{captures.[0]}}', stage: 'output.complete', enabledDefault: true }] })
  const before = appendOutput('PREFIX')
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'history', revision: 1, title: 'History', rules: [makeRule('cross', 'PREFIX\\nNEW')] } })
  const release = service.register({ plugin: 'fixture', registrationId: 'old-output', sessionId: agent.id,
    documents: [{ schemaVersion: 2, id: 'old-output', revision: 1, title: 'Old', rules: [makeRule('old', '^PREFIX$')] }] })
  await service.reconcile(agent)
  assert.equal(service.store.read(agent.id).runtime.runs.length, 0)
  const current = appendOutput('NEW')
  // Re-enabling creates a new evidence seq cutoff; the old PREFIX is still valid context for this fresh trigger.
  const controls = ctx.contextCareControls
  await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:history', ruleId: 'cross', actionId: 'notice', enabled: false })
  await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:history', ruleId: 'cross', actionId: 'notice', enabled: true })
  await service.reconcile(agent)
  assert.equal(service.store.read(agent.id).runtime.runs.length, 0, 'output committed before re-enable must not replay')
  appendOutput('PREFIX'); const fresh = appendOutput('NEW')
  await service.reconcile(agent)
  const runs = service.store.read(agent.id).runtime.runs
  assert.equal(runs.filter(run => run.ruleId === 'cross').length, 1, JSON.stringify(runs))
  assert.equal(runs.find(run => run.ruleId === 'cross').triggerSeq, fresh.seq)
  assert.ok(runs.find(run => run.ruleId === 'cross').sourceSeqs.some(seq => seq < fresh.seq))
  assert.ok(before.seq < current.seq)
  release(); await service.close()
  const { openWorkbenchHost } = await pluginModule('workbench-host.js')
  const reopened = await openWorkbenchHost(ctx, controls)
  try {
    await reopened.reconcile(agent)
    const count = reopened.store.read(agent.id).runtime.runs.length
    appendOutput('UNRELATED'); await reopened.reconcile(agent)
    assert.equal(reopened.store.read(agent.id).runtime.runs.length, count)
    appendOutput('PREFIX'); const afterRestart = appendOutput('NEW'); await reopened.reconcile(agent)
    assert.equal(reopened.store.read(agent.id).runtime.runs.length, count + 1)
    assert.equal(reopened.store.read(agent.id).runtime.runs.at(-1).triggerSeq, afterRestart.seq)
  } finally { await reopened.close() }
})

test('Workbench v2 lets an eligible exclusive sibling run when a higher priority rule was enabled after the output', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('workbench-exclusive-cutoff', { provider: 'care-test', model: 'care-test' })
  const makeRule = (id, priority) => ({ schemaVersion: 2, sourceId: 'owner', id, revision: 1, title: id, priority, exclusiveGroup: 'one', on: ['output.complete'],
    select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'keywords', values: ['CURRENT'] },
    actions: [{ id: 'notice', kind: 'notify', template: 'Current occurrence', stage: 'output.complete', enabledDefault: true }] })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'exclusive', revision: 1, title: 'Exclusive', rules: [makeRule('high', 20), makeRule('low', 10)] } })
  agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 1, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' }, content: [{ type: 'text', text: 'CURRENT' }] }) }, { surfaceOp: 'append' })
  const control = ctx.contextCareControls
  for (const enabled of [false, true]) await control.patch(agent.id, { revision: control.revision(agent.id), sourceId: 'context-care:document:exclusive', ruleId: 'high', actionId: 'notice', enabled })
  await service.reconcile(agent)
  assert.deepEqual(service.store.read(agent.id).runtime.runs.map(run => [run.ruleId, run.status]), [['low', 'queued']])
})

test('Workbench v2 renews variable snapshots only for explicit dependents and delivers their updated templates', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  const adapter = new CompletionAdapter([{ blocks: [{ type: 'text', text: 'SET_COUNT' }] }, { blocks: [{ type: 'text', text: 'Done.' }] }]); ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-variable-actions', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'vars', revision: 1, title: 'Variables',
    variables: [{ name: 'count', scope: 'session', type: 'number', default: 0 }],
    rules: [{ schemaVersion: 2, sourceId: 'context-care:document:vars', id: 'set', revision: 1, title: 'Set and deliver', on: ['output.complete'],
      select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'SET_COUNT' },
      actions: [{ id: 'set', kind: 'set-variable', variable: 'count', value: 7, stage: 'output.complete', enabledDefault: true },
        { id: 'dependent', kind: 'notify', dependsOn: ['set'], template: 'New count: {{vars.count}}, result: {{results.set}}', stage: 'output.complete', enabledDefault: true },
        { id: 'unrelated', kind: 'notify', template: 'Stale count: {{vars.count}}', stage: 'output.complete', enabledDefault: true }] }] } })
  await completionTurn(ctx, agent)
  const runs = service.store.read(agent.id).runtime.runs
  assert.deepEqual(runs.map(run => [run.actionId, run.status]), [['set', 'succeeded'], ['dependent', 'succeeded'], ['unrelated', 'skipped']], JSON.stringify(runs))
  assert.match(JSON.stringify(agent.session.snapshotEvents()), /New count: 7, result: 7/)
  assert.equal(runs[2].reason, 'workbench-changed')
})

test('Workbench v2 HTTP authenticates inspection, isolates cancellation and rejects rule editing', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('workbench-http', { provider: 'care-test', model: 'care-test' })
  const other = await ctx.agentLoop.create('workbench-http-other', { provider: 'care-test', model: 'care-test' })
  const path = `/context-care/workbench?sessionId=${agent.id}`
  assert.equal((await fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`)).status, 503)
  const { base, cookie } = await controlCookie(ctx); const headers = { cookie, 'content-type': 'application/json' }
  assert.equal((await fetch(`${base}${path}`)).status, 401)
  assert.equal((await fetch(`${base}/context-care/workbench?sessionId=missing`, { headers })).status, 404)
  assert.equal((await fetch(`${base}${path}`, { method: 'DELETE', headers })).status, 405)
  const initial = await fetch(`${base}${path}`, { headers }); assert.equal(initial.status, 200)
  assert.equal(initial.headers.get('cache-control'), 'no-store'); const state = await initial.json()
  assert.equal(state.sessionId, agent.id); assert.equal(state.turnId, service.turnId(agent))
  const post = (body, extra = {}, target = path) => fetch(`${base}${target}`, { method: 'POST', headers: { ...headers, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  assert.equal((await post({ operation: 'preview' }, { origin: 'http://foreign.test' })).status, 403)
  assert.equal((await post({ operation: 'preview' }, { origin: '%%%malformed' })).status, 403)
  assert.equal((await post({ operation: 'preview' }, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await post('{')).status, 400)
  assert.equal((await post({ operation: 'preview', unexpected: true })).status, 400)
  assert.equal((await post(' '.repeat(1048577))).status, 413)
  const document = { schemaVersion: 2, id: 'http-doc', revision: 1, title: 'HTTP editable', variables: [{ name: 'count', scope: 'session', type: 'number', default: 0 }],
    entries: [{ id: 'constant', revision: 1, title: 'Constant', enabledDefault: true, template: 'Saved injection', activation: { kind: 'constant' },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } }] }
  const put = { operation: 'edit', revision: 0, change: { operation: 'put-document', document } }
  assert.equal((await post(put, { origin: base })).status, 400)
  assert.equal((await post({ operation: 'edit', revision: 0, change: { operation: 'set-variable', variable: 'count', value: 7 } })).status, 400)
  assert.equal((await post({ operation: 'import', document })).status, 400)
  assert.equal(service.store.read(agent.id).revision, 0)
  // Declarations are contributed by code; HTTP provides no document authoring path.
  const unregister = service.register({ plugin: 'http-test', registrationId: 'http-declarations', sessionId: agent.id, documents: [document] })
  t.after(unregister)
  agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Preview the saved state.' }] }), { surfaceOp: 'append' })
  const before = service.store.read(agent.id); const eventsBefore = agent.session.snapshotEvents()
  const preview = await post({ operation: 'preview' }); assert.equal(preview.status, 200)
  assert.match(JSON.stringify((await preview.json()).diff.after), /Saved injection/)
  assert.deepEqual(service.store.read(agent.id), before); assert.deepEqual(agent.session.snapshotEvents(), eventsBefore)
  assert.equal(service.store.read(other.id).revision, 0)
  await service.store.runtime(agent.id, runtime => runtime.runs.push({ id: 'http-queued', status: 'queued' }))
  assert.equal((await post({ operation: 'cancel', runId: 'http-queued' }, {}, `/context-care/workbench?sessionId=${other.id}`)).status, 404)
  assert.equal(service.store.read(agent.id).runtime.runs[0].status, 'queued')
  const cancelled = await post({ operation: 'cancel', runId: 'http-queued' }); assert.equal(cancelled.status, 200)
  assert.equal((await cancelled.json()).runtime.runs[0].status, 'cancelled')
  assert.equal((await post({ operation: 'edit', revision: 0, change: { operation: 'delete-document', documentId: document.id } })).status, 400)
  assert.equal(service.sources(agent.id).some(source => source.sourceId === 'context-care:document:http-doc'), true)
})

test('Workbench v2 compact actions use native context_rest admission and complete the summary before continuing', async t => {
  // Fix the retained tail so this scenario tests a real summary rather than a valid no-prefix outcome.
  const owned = await fixture(t, false, { retainTokens: 600 }); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  class CompactAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) {
      this.requests.push(request)
      if (request.purpose !== 'compaction') { yield* super.stream(request); return }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Verified earlier work has been summarized. Continue.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new CompactAdapter(['Earlier work accepted.', 'Current work accepted.', 'COMPACT_TRIGGER', 'Continued after the requested summary.']
    .map(text => ({ blocks: [{ type: 'text', text }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-compact', { provider: 'care-test', model: 'care-test', toolMode: 'native' })
  await completionTurn(ctx, agent, 'Earlier verified work. '.repeat(1200))
  await completionTurn(ctx, agent, 'Current verified work. '.repeat(100))
  const note = 'Keep the verified work, paths and remaining tasks; continue after the summary. '.padEnd(1200, '…')
  let admitted = 0
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name === 'context_rest' && exec.callId.startsWith('context-care:')) { admitted++; assert.deepEqual(exec.arguments, { note }) }
    return next()
  })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'compact', revision: 1, title: 'Request summary',
    rules: [{ schemaVersion: 2, sourceId: 'context-care:document:compact', id: 'trigger', revision: 1, on: ['output.complete'],
      select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'COMPACT_TRIGGER' },
      actions: [{ id: 'summary', kind: 'compact', stage: 'output.complete', enabledDefault: true, template: note }] }] } })
  const action = ctx.contextCareControls.snapshot(agent.id).sources.find(source => source.sourceId === 'context-care:document:compact').rules[0].actions[0]
  assert.equal(action.available, true)
  await completionTurn(ctx, agent, 'Request the next work unit.')
  assert.equal(admitted, 1, JSON.stringify(service.store.read(agent.id).runtime.runs))
  const run = service.store.read(agent.id).runtime.runs[0]
  assert.equal(run.status, 'succeeded'); assert.match(run.result.value, /排定/)
  assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 1,
    JSON.stringify({ requests: adapter.requests.map(request => request.purpose),
      reports: agent.session.snapshotEvents().filter(event => event.type === 'user/message' && producedBy(event.data.source, 'dsh-context-care:state')).map(event => event.data.content),
      maintenance: ctx.contextCareRequests.list(agent.id).filter(record => record.kind === 'maintenance').map(record => record.data),
      ends: agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data) }))
  assert.equal(adapter.outputs.length, 0)
  assert.match(JSON.stringify(adapter.requests.at(-1).messages), /Keep the verified work/)
})

test('Workbench v2 action turn and session lifetimes are consumed by successful delivery and isolate later turns', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  const adapter = new CompletionAdapter(Array.from({ length: 4 }, () => ({ blocks: [{ type: 'text', text: 'LIFETIME_TRIGGER' }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-lifetime', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'lifetime', revision: 1, title: 'Lifetimes',
    rules: [{ schemaVersion: 2, sourceId: 'context-care:document:lifetime', id: 'trigger', revision: 1, on: ['output.complete'],
      select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'LIFETIME_TRIGGER' },
      actions: ['turn', 'session'].map(lifetime => ({ id: lifetime, kind: 'notify', stage: 'output.complete', enabledDefault: true,
        target: { view: 'model', lifetime }, template: `Delivered once per ${lifetime}.` })) }] } })
  await completionTurn(ctx, agent)
  let runs = service.store.read(agent.id).runtime.runs
  assert.deepEqual(runs.map(run => run.actionId), ['turn', 'session'], JSON.stringify(runs))
  assert.ok(runs.every(run => run.status === 'succeeded' && run.delivery === 'delivered'))
  const firstTurn = runs[0].turnId
  await completionTurn(ctx, agent)
  runs = service.store.read(agent.id).runtime.runs
  assert.deepEqual(runs.map(run => run.actionId), ['turn', 'session', 'turn'], JSON.stringify(runs))
  assert.notEqual(runs[2].turnId, firstTurn); assert.equal(adapter.outputs.length, 0)
})

test('Workbench v2 materializes frozen entry slices on real tool steps, expires fixed turns and keeps ordinary turn consumption separate', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  class RecordingAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) { this.requests.push(request); yield* super.stream(request) }
  }
  const adapter = new RecordingAdapter([
    { blocks: [{ type: 'tool-call', id: 'entry-change', name: 'entry_variable', arguments: '{}' }] },
    ...Array.from({ length: 3 }, () => ({ blocks: [{ type: 'text', text: 'Continue verified work.' }] })),
  ])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('entry-materialization', { provider: 'care-test', model: 'care-test', toolMode: 'native' })
  ctx.effect(() => ctx.tools.register({ name: 'entry_variable', description: 'Update the deterministic fixture variable',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: value.summary }] },
    async execute() {
      const current = service.store.read(agent.id)
      await service.store.edit(agent.id, { revision: current.revision, operation: 'set-variable', variable: 'label', value: 'UPDATED' })
      await service.store.edit(agent.id, { revision: service.store.read(agent.id).revision, operation: 'set-variable', variable: 'active', value: false })
      return { summary: 'Variable changed.' }
    } }))
  const entry = lifetime => ({ id: lifetime, revision: 1, title: lifetime, enabledDefault: true, template: `${lifetime}:{{vars.label}}`,
    activation: { kind: 'condition', condition: { kind: 'compare', field: 'vars.active', op: 'eq', value: true } }, lifetime, ...(lifetime === 'turns' ? { lifetimeTurns: 2 } : {}),
    select: { view: 'model', roles: ['user', 'assistant', 'tool'], blockTypes: ['text'] }, target: { view: 'model' } })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'materialization', revision: 1, title: 'Materialization',
    variables: [{ name: 'label', scope: 'session', type: 'string', default: 'literal {{unused}}' }, { name: 'active', scope: 'session', type: 'boolean', default: true }],
    entries: ['turn', 'turns', 'session'].map(entry) } })
  await completionTurn(ctx, agent, 'ACTIVATE the entries.')
  assert.equal(adapter.requests.length, 2, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')))
  const injected = request => request.messages.filter(message => message.source?.contextCareWorkbench).map(message => message.content[0].text).sort()
  assert.deepEqual(injected(adapter.requests[0]), ['session:literal {{unused}}', 'turn:literal {{unused}}', 'turns:literal {{unused}}'])
  assert.deepEqual(injected(adapter.requests[1]), injected(adapter.requests[0]))
  await completionTurn(ctx, agent, 'No matching word on the next turn.')
  assert.deepEqual(injected(adapter.requests[2]), ['session:literal {{unused}}', 'turns:literal {{unused}}'])
  await completionTurn(ctx, agent, 'No matching word on the third turn.')
  assert.deepEqual(injected(adapter.requests[3]), ['session:literal {{unused}}'])
  assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length, 3)
  assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin:dsh-context-care:workbench').length, 0)
  const state = service.store.read(agent.id).runtime.state
  assert.equal(state[JSON.stringify(['context-care:document:materialization', 'entry:turns', 1, 'inject'])].materialization, undefined)
})

test('Workbench v2 acknowledges inactive entry transitions, blocks reactivation during cooldown and leaves preview state untouched', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  class RecordingAdapter extends CompletionAdapter { requests = []; async *stream(request) { this.requests.push(request); yield* super.stream(request) } }
  const adapter = new RecordingAdapter(Array.from({ length: 3 }, () => ({ blocks: [{ type: 'text', text: 'Work continues.' }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('entry-inactive', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'inactive', revision: 1, title: 'Inactive',
    variables: [{ name: 'active', scope: 'session', type: 'boolean', default: true }], entries: [{ id: 'held', revision: 1, title: 'Held', enabledDefault: true,
      template: 'UNTIL_INACTIVE_TEXT', lifetime: 'until-inactive', activationCooldownMs: 86400000,
      activation: { kind: 'condition', condition: { kind: 'compare', field: 'vars.active', op: 'eq', value: true } },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model' } }] } })
  await completionTurn(ctx, agent)
  assert.match(JSON.stringify(adapter.requests[0].messages), /UNTIL_INACTIVE_TEXT/)
  const variable = async value => service.store.edit(agent.id, { revision: service.store.read(agent.id).revision, operation: 'set-variable', variable: 'active', value })
  await variable(false)
  const before = service.store.read(agent.id)
  const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Preview' }] }] }
  const preview = await service.preview(agent, request)
  assert.equal(preview.entryTransitions.length, 1)
  assert.deepEqual(service.store.read(agent.id), before)
  await completionTurn(ctx, agent)
  assert.doesNotMatch(JSON.stringify(adapter.requests[1].messages), /UNTIL_INACTIVE_TEXT/)
  const key = JSON.stringify(['context-care:document:inactive', 'entry:held', 1, 'inject'])
  const inactive = service.store.read(agent.id).runtime.state[key]
  assert.equal(inactive.materialization, undefined); assert.ok(inactive.lastInactiveAt > 0)
  await variable(true)
  await completionTurn(ctx, agent)
  assert.doesNotMatch(JSON.stringify(adapter.requests[2].messages), /UNTIL_INACTIVE_TEXT/)
  const audit = agent.session.snapshotEvents().findLast(event => event.type === 'request/header' && event.data.contextCareWorkbench).data.contextCareWorkbench
  assert.equal(audit.records.find(record => record.ruleId === 'entry:held').reason, 'entry-inactive-cooldown')
  assert.deepEqual(service.store.read(agent.id).runtime.state[key], inactive)
})

test('Workbench v2 surface replacement removes strict activation evidence without resetting the durable fixed-turn lifetime', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  class RecordingAdapter extends CompletionAdapter { requests = []; async *stream(request) { this.requests.push(request); yield* super.stream(request) } }
  const adapter = new RecordingAdapter(Array.from({ length: 3 }, () => ({ blocks: [{ type: 'text', text: 'Continue.' }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('entry-surface', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'surface', revision: 1, title: 'Surface',
    entries: ['request', 'turns'].map(lifetime => ({ id: lifetime, revision: 1, title: lifetime, enabledDefault: true, template: `${lifetime.toUpperCase()}_SURFACE_SLICE`,
      lifetime, ...(lifetime === 'turns' ? { lifetimeTurns: 2 } : {}), activation: { kind: 'keywords', keywords: ['ACTIVATION_MARKER'] },
      select: { view: 'original', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model' } })) } })
  await completionTurn(ctx, agent, 'ACTIVATION_MARKER')
  assert.match(JSON.stringify(adapter.requests[0].messages), /REQUEST_SURFACE_SLICE/)
  const source = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.content.some(block => block.text === 'ACTIVATION_MARKER'))
  agent.session.append('user/message', createUserMessage({ source: { kind: 'plugin:entry-surface-fixture' }, content: [{ type: 'text', text: 'Replacement without activation evidence.' }] }),
    { surfaceOp: { op: 'replace', startSeq: source.seq, endSeq: source.seq }, sourceEventSeqs: [source.seq] })
  assert.equal(agent.session.surface.nodes.includes(source.seq), false)
  assert.equal(agent.session.snapshotEvents().findLast(event => event.type === 'turn/start').data.turn, 1)
  const sameTurn = await service.preview(agent, { messages: agent.session.deriveMessages() })
  assert.match(JSON.stringify(sameTurn.request.messages), /TURNS_SURFACE_SLICE/)
  assert.doesNotMatch(JSON.stringify(sameTurn.request.messages), /REQUEST_SURFACE_SLICE|ACTIVATION_MARKER/)
  await completionTurn(ctx, agent)
  assert.match(JSON.stringify(adapter.requests[1].messages), /TURNS_SURFACE_SLICE/)
  await completionTurn(ctx, agent)
  assert.doesNotMatch(JSON.stringify(adapter.requests[2].messages), /SURFACE_SLICE/)
  assert.ok(agent.session.snapshotEvents().some(event => event.seq === source.seq), 'Replacement leaves the original facts in the log')
})

test('Workbench v2 cooling entries release their exclusive group while keeping the skip reason visible', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  class RecordingAdapter extends CompletionAdapter { requests = []; async *stream(request) { this.requests.push(request); yield* super.stream(request) } }
  const adapter = new RecordingAdapter(Array.from({ length: 2 }, () => ({ blocks: [{ type: 'text', text: 'Continue.' }] })))
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('entry-exclusive', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'exclusive', revision: 1, title: 'Exclusive',
    entries: ['high', 'low'].map(id => ({ id, revision: 1, title: id, enabledDefault: true, template: `${id.toUpperCase()}_SLICE`,
      activation: { kind: 'constant' }, priority: id === 'high' ? 10 : 0, exclusiveGroup: 'slice', cooldownMs: id === 'high' ? 86400000 : 0,
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model' } })) } })
  await completionTurn(ctx, agent); await completionTurn(ctx, agent)
  assert.match(JSON.stringify(adapter.requests[0].messages), /HIGH_SLICE/)
  assert.doesNotMatch(JSON.stringify(adapter.requests[0].messages), /LOW_SLICE/)
  assert.match(JSON.stringify(adapter.requests[1].messages), /LOW_SLICE/)
  assert.doesNotMatch(JSON.stringify(adapter.requests[1].messages), /HIGH_SLICE/)
  const audit = agent.session.snapshotEvents().findLast(event => event.type === 'request/header' && event.data.contextCareWorkbench).data.contextCareWorkbench
  assert.equal(audit.records.find(record => record.ruleId === 'entry:high').reason, 'entry-activation-interval')
})

test('Workbench v2 inactive reservations roll back, reject stale state and retain held text after a failed durable ACK', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('entry-reservations', { provider: 'care-test', model: 'care-test' })
  const key = JSON.stringify(['context-care:document:reservation', 'entry:held', 1, 'inject'])
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'reservation', revision: 1, title: 'Reservation',
    variables: [{ name: 'active', scope: 'session', type: 'boolean', default: true }], entries: [{ id: 'held', revision: 1, title: 'Held', enabledDefault: true,
      template: 'RESERVATION_TEXT', lifetime: 'until-inactive', activation: { kind: 'condition', condition: { kind: 'compare', field: 'vars.active', op: 'eq', value: true } },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model' } }] } })
  const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Preview' }] }] }
  const activate = await service.preview(agent, request)
  const competing = await service.preview(agent, request)
  await service.reserve(agent, activate, 'activate'); await service.dispatched(agent, activate, 'activate')
  assert.equal(service.store.read(agent.id).runtime.state[key].materialization.turn, 0, 'Seed activation uses ordinal zero')
  await assert.rejects(service.reserve(agent, competing, 'competing'), /entry-state-changed-before-dispatch/)
  await service.store.edit(agent.id, { revision: 1, operation: 'set-variable', variable: 'active', value: false })
  const inactive = await service.preview(agent, request)
  const before = service.store.read(agent.id).runtime.state[key]
  assert.equal(inactive.applied.length, 0); assert.equal(inactive.entryTransitions.length, 1)
  await service.reserve(agent, inactive, 'rollback'); await service.rollback(agent, 'rollback')
  assert.deepEqual(service.store.read(agent.id).runtime.state[key], before)
  assert.equal(service.store.read(agent.id).runtime.state[`$dispatch:${key}`], undefined)
  await service.reserve(agent, inactive, 'failed-ack')
  const table = ctx.storageDomain.get('context_care_workbench').table('sessions'); const put = table.put
  table.put = async () => { throw new Error('fixture-durable-ack-failed') }
  try { await assert.rejects(service.dispatched(agent, inactive, 'failed-ack'), /workbench-storage-unavailable/) }
  finally { table.put = put }
  assert.deepEqual(service.store.read(agent.id).runtime.state[key], before, 'Unconfirmed deactivation leaves the held slice intact')
  await service.unknown(agent, 'failed-ack')
  assert.equal(service.store.read(agent.id).runtime.state[`$dispatch:${key}`].status, 'unknown')
  assert.equal((await service.preview(agent, request)).entryTransitions.length, 0)
  assert.deepEqual(service.store.read(agent.id).runtime.state[key], before)
})

test('Workbench v2 restores session slices, isolates real fork seeds and refuses plans from an earlier turn', async t => {
  const owned = await fixture(t, false); let ctx = await owned.open(); let service = ctx.contextCareWorkbench
  class RecordingAdapter extends CompletionAdapter { requests = []; async *stream(request) { this.requests.push(request); yield* super.stream(request) } }
  const config = { provider: 'care-test', model: 'care-test' }
  const first = new RecordingAdapter([{ blocks: [{ type: 'text', text: 'Continue.' }] }]); ctx.llm.registerAdapter(['care-test'], first)
  let agent = await ctx.agentLoop.create('entry-restore', config)
  const document = { schemaVersion: 2, id: 'restore', revision: 1, title: 'Restore', variables: [{ name: 'active', scope: 'session', type: 'boolean', default: true }],
    entries: [{ id: 'held', revision: 1, title: 'Held', enabledDefault: true, template: 'RESTORED_SLICE', lifetime: 'session',
      activation: { kind: 'condition', condition: { kind: 'compare', field: 'vars.active', op: 'eq', value: true } },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model' } }] }
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document })
  await completionTurn(ctx, agent)
  await service.store.edit(agent.id, { revision: 1, operation: 'set-variable', variable: 'active', value: false })
  const log = agent.session.snapshotEvents(); const key = JSON.stringify(['context-care:document:restore', 'entry:held', 1, 'inject'])
  const saved = service.store.read(agent.id).runtime.state[key].materialization
  await owned.close(ctx); ctx = await owned.open(); service = ctx.contextCareWorkbench
  const adapter = new RecordingAdapter(Array.from({ length: 3 }, () => ({ blocks: [{ type: 'text', text: 'Continue.' }] }))); ctx.llm.registerAdapter(['care-test'], adapter)
  agent = (await ctx.agents.create({ sessionId: 'entry-restore', seed: log, agentOptions: config })).agent
  assert.deepEqual(service.store.read(agent.id).runtime.state[key].materialization, saved)
  const preview = await service.preview(agent, { messages: [{ role: 'user', content: [{ type: 'text', text: 'Next' }] }] })
  await completionTurn(ctx, agent)
  assert.match(JSON.stringify(adapter.requests[0].messages), /RESTORED_SLICE/)
  await assert.rejects(service.reserve(agent, preview, 'earlier-turn'), /workbench-turn-changed-before-dispatch/)
  const parentLog = agent.session.snapshotEvents()
  const child = (await ctx.agents.create({ sessionId: 'entry-fork', seed: buildForkSeed(parentLog, parentLog.at(-1).seq),
    inheritedEventCount: parentLog.length, meta: { isSeeded: true, parentSession: agent.id }, agentOptions: config })).agent
  assert.equal(child.session.header.parentSession, agent.id)
  await service.store.edit(child.id, { revision: 0, operation: 'put-document', document })
  await service.store.edit(child.id, { revision: 1, operation: 'set-variable', variable: 'active', value: false })
  await completionTurn(ctx, child)
  assert.doesNotMatch(JSON.stringify(adapter.requests[1].messages), /RESTORED_SLICE/, 'Fork history does not copy producer-owned held state')
  assert.equal(service.store.read(child.id).runtime.state[key], undefined)
  await completionTurn(ctx, agent)
  assert.match(JSON.stringify(adapter.requests[2].messages), /RESTORED_SLICE/)
})

test('Workbench v2 executes a final-output program through native tools before the turn closes and resolves dependent partial templates', async t => {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  let invoked = 0
  ctx.effect(() => ctx.tools.register({ name: 'workbench_fixture', description: 'Deterministic test program', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      invoked++
      assert.ok(exec.agent.session.snapshotEvents().findLast(event => event.type === 'turn/start').seq > (exec.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.seq ?? -1))
      assert.equal(args.text, 'OUTPUT_TRIGGER')
      return { summary: 'program result', answer: 7 }
    } }))
  const service = ctx.contextCareWorkbench
  service.registerExecutor({ executorRef: 'fixture-program', plugin: 'test-fixture', toolName: 'workbench_fixture', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, requiresApproval: false })
  const adapter = new CompletionAdapter([{ blocks: [{ type: 'text', text: 'OUTPUT_TRIGGER' }] }, { blocks: [{ type: 'text', text: 'Finished processing the result.' }] }])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-output', { provider: 'care-test', model: 'care-test', toolMode: 'native' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'output', revision: 1, title: 'Output actions',
    partials: [{ name: 'delivered', revision: 1, template: 'Result: {{results.run.answer}}' }],
    rules: [{ schemaVersion: 2, sourceId: 'context-care:document:output', id: 'trigger', revision: 1, title: 'Program on final output', on: ['output.complete'],
      select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'OUTPUT_TRIGGER' },
      actions: [{ id: 'run', kind: 'program', executorRef: 'fixture-program', inputs: { text: { bind: 'captures.0' } }, stage: 'output.complete', enabledDefault: true },
        { id: 'deliver', kind: 'notify', dependsOn: ['run'], template: '{{> delivered}}', stage: 'output.complete', enabledDefault: true }] }] } })
  await completionTurn(ctx, agent)
  const runs = service.store.read(agent.id).runtime.runs
  assert.equal(invoked, 1, JSON.stringify(runs))
  assert.deepEqual(runs.map(run => run.status), ['succeeded', 'succeeded'], JSON.stringify(runs))
  assert.equal(runs[1].delivery, 'delivered')
  assert.match(JSON.stringify(agent.session.snapshotEvents()), /Result: 7/)
  assert.equal(adapter.outputs.length, 0, 'Dependent result input runs in the same turn without a new human request')
})

test('Workbench v2 rule files publish validated revisions atomically, report failures and recover without an editor', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('file-rules', { provider: 'care-test', model: 'care-test' })
  const root = await mkdtemp(resolve(tmpdir(), 'care-rule-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = resolve(root, 'rules.json'); const second = resolve(root, 'second.json')
  const document = { schemaVersion: 2, id: 'file', revision: 1, title: 'File declaration',
    entries: [{ id: 'constant', revision: 1, title: 'File entry', enabledDefault: true, template: 'FILE_VERSION_ONE', activation: { kind: 'constant' },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } }] }
  await writeFile(file, JSON.stringify(document)); await writeFile(second, JSON.stringify({ schemaVersion: 2, id: 'second', revision: 1, title: 'Second file' }))
  await ctx.contextCareWorkbench.close()
  const { openWorkbenchHost } = await pluginModule('workbench-host.js')
  const service = await openWorkbenchHost(ctx, ctx.contextCareControls, { ruleFiles: [file, second] })
  t.after(() => service.close())
  const request = { messages: [createUserMessage({ content: [{ type: 'text', text: 'Actual request' }], source: { kind: 'user' } })], purpose: 'conversation' }
  const plan = await service.assemble(agent, request)
  assert.match(JSON.stringify(plan.request), /FILE_VERSION_ONE/)
  assert.equal(service.sources(agent.id).find(source => source.sourceId === 'context-care:document:file').registration, file)
  const unchanged = service.token(agent); await service.reloadFiles(); assert.equal(service.token(agent), unchanged)
  await writeFile(file, JSON.stringify(document, null, 2)); await service.reloadFiles(); assert.equal(service.token(agent), unchanged, 'Formatting preserves admission and running snapshots')
  const changed = structuredClone(document); changed.revision = 2; changed.entries[0].revision = 2; changed.entries[0].template = 'FILE_VERSION_TWO'
  await writeFile(file, JSON.stringify(changed)); await writeFile(second, '{')
  await assert.rejects(service.reloadFiles(), /invalid-json/)
  assert.match(service.sources(agent.id)[0].rules[0].actions[0].reason, /rule-file-load-failed/)
  assert.match(service.sources(agent.id)[0].rules[0].definition.actions[0].template, /VERSION_ONE/)
  assert.throws(() => service.assertCurrent(agent, plan), /changed-before-dispatch/)
  await writeFile(second, JSON.stringify({ schemaVersion: 2, id: 'second', revision: 1, title: 'Second file' }))
  await service.reloadFiles()
  assert.match(JSON.stringify((await service.assemble(agent, request)).request), /FILE_VERSION_TWO/)
  const illegal = structuredClone(changed); illegal.entries[0].template = 'WITHOUT_NEW_REVISION'
  await writeFile(file, JSON.stringify(illegal))
  await assert.rejects(service.reloadFiles(), /needs-new-revision/)
  await writeFile(file, JSON.stringify(changed)); await service.reloadFiles()
  assert.equal(service.sources(agent.id)[0].rules[0].actions[0].available, true)
  await rm(file); await assert.rejects(service.reloadFiles(), /ENOENT/)
  await writeFile(file, JSON.stringify(changed)); await service.reloadFiles()
  await service.close()
  assert.equal(ctx.contextCareControls.catalog(agent.id).some(source => source.sourceId === 'context-care:document:file'), false)
})

test('Workbench v2 management HTTP validates pages, projects external values, previews without writes and isolates cancellation', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('runtime-http', { provider: 'care-test', model: 'care-test' })
  const other = await ctx.agentLoop.create('runtime-private', { provider: 'care-test', model: 'care-test' })
  const path = `/context-care/rule-runtime?sessionId=${agent.id}`
  const plainBase = `http://127.0.0.1:${ctx.webServer.port}`
  assert.equal((await fetch(`${plainBase}${path}`)).status, 503)
  const { base, cookie } = await controlCookie(ctx); const headers = { cookie, 'content-type': 'application/json' }
  assert.equal((await fetch(`${base}${path}`)).status, 401)
  const get = suffix => fetch(`${base}${path}${suffix ?? ''}`, { headers })
  const post = (body, target = path, extra = {}) => fetch(`${base}${target}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
  for (const suffix of ['&limit=0', '&limit=101', '&offset=-1', '&offset=100001', '&status=invalid']) assert.equal((await get(suffix)).status, 400)
  assert.equal((await post({ operation: 'preview' }, path, { origin: 'http://foreign.test' })).status, 403)
  assert.equal((await post({ operation: 'edit', document: {} })).status, 400)
  assert.equal((await post({ operation: 'import', document: {} })).status, 400)
  const variable = { name: 'mood', scope: 'session', type: 'string', default: 'initial', description: 'External current value' }
  const unregister = service.register({ plugin: 'memory-plugin', registrationId: 'memory/decl', sessionId: agent.id, documents: [{ schemaVersion: 2, id: 'foreign', revision: 1, title: 'Foreign declaration',
    variables: [variable], partials: [{ name: 'greeting', revision: 1, template: 'Hello {{vars.mood}}' }],
    rules: [{ schemaVersion: 2, id: 'entry:legal-prefix', revision: 1, title: 'Legal prefixed rule', on: ['request.assemble'],
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'always' }, actions: [{ id: 'notify', kind: 'notify', stage: 'request.assemble', enabledDefault: true, template: 'queued {{vars.mood}}' }] }],
    entries: [{ id: 'constant', revision: 1, title: 'Constant entry', enabledDefault: true, template: '{{> greeting}}', activation: { kind: 'constant' },
      select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model', role: 'user', anchor: 'end', position: 'after' } }] }] })
  t.after(unregister)
  await service.store.automaticVariable(agent.id, variable, 'current', service.turnId(agent))
  agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Actual context' }] }), { surfaceOp: 'append' })
  // Owned run records are data fixtures in the real durable store, not mock services.
  const record = index => ({ id: `run-${index}`, sourceId: 'context-care:document:foreign', ruleId: 'rule', actionId: `action-${index}`, kind: 'notify', status: index % 2 ? 'failed' : 'queued', reason: index % 2 ? 'fixture-failure' : null,
    delivery: 'not-delivered', createdAt: index + 1, updatedAt: index + 1, inputs: { index }, sourceSeqs: [0] })
  await service.store.runtime(agent.id, runtime => runtime.runs.push(...Array.from({ length: 25 }, (_, index) => record(index))))
  const response = await get('&limit=20'); assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const state = await response.json()
  assert.equal(state.documents[0].registration, 'memory/decl'); assert.equal(state.documents[0].plugin, 'memory-plugin')
  assert.equal(state.documents[0].variables[0].value, 'current'); assert.equal(state.documents[0].rules[0].id, 'entry:legal-prefix')
  assert.equal(state.runs.length, 20); assert.equal(state.runs[0].id, 'run-24'); assert.equal(state.nextOffset, 20)
  assert.deepEqual(state.counts, { queued: 13, failed: 12 })
  const final = await (await get('&offset=20&limit=20')).json(); assert.equal(final.runs.length, 5); assert.equal(final.nextOffset, null)
  const filtered = await (await get('&status=failed&search=action-1')).json()
  assert.equal(filtered.total, 6); assert.ok(filtered.runs.every(run => run.status === 'failed'))
  const foreign = await (await fetch(`${base}/context-care/rule-runtime?sessionId=${other.id}`, { headers })).json()
  assert.equal(foreign.documents.length, 0); assert.equal(foreign.runs.length, 0)
  const before = service.store.read(agent.id); const eventsBefore = agent.session.snapshotEvents()
  const previewResponse = await post({ operation: 'preview' }); assert.equal(previewResponse.status, 200)
  const planned = await previewResponse.json(); assert.equal(planned.snapshotId, state.snapshotId)
  assert.match(JSON.stringify(planned.diff.after), /Hello current/); assert.equal(planned.scheduled.length, 1)
  assert.equal(planned.injectionBudget.kind, 'estimate'); assert.ok(planned.injectionBudget.tokens > 0)
  assert.equal(planned.injectionBudget.limit, 65536)
  assert.equal(planned.impact.basis, 'public-request-json-estimate'); assert.equal(planned.impact.providerSerialization, 'unknown')
  assert.equal(planned.impact.cacheHitTokens, null); assert.ok(planned.impact.changedSuffixBytes > 0)
  assert.deepEqual(service.store.read(agent.id), before); assert.deepEqual(agent.session.snapshotEvents(), eventsBefore)
  assert.equal((await post({ operation: 'cancel', runId: 'run-24' }, `/context-care/rule-runtime?sessionId=${other.id}`)).status, 404)
  const cancelled = await post({ operation: 'cancel', runId: 'run-24' }); assert.equal(cancelled.status, 200)
  assert.deepEqual(await cancelled.json(), { sessionId: agent.id, acknowledged: true })
  const afterCancel = await (await get()).json(); assert.equal(afterCancel.runs[0].status, 'cancelled'); assert.notEqual(afterCancel.snapshotId, state.snapshotId)
  await service.store.automaticVariable(agent.id, variable, 'updated', service.turnId(agent))
  const afterVariable = await (await get()).json()
  assert.notEqual(afterVariable.snapshotId, afterCancel.snapshotId); assert.equal(afterVariable.documents[0].variables[0].value, 'updated')
  const controls = ctx.contextCareControls
  await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:foreign', ruleId: 'entry:legal-prefix', actionId: 'notify', enabled: false })
  const afterControls = await (await get()).json(); assert.notEqual(afterControls.snapshotId, afterVariable.snapshotId)
  const beforeContext = afterControls.snapshotId
  agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'New context' }] }), { surfaceOp: 'append' })
  assert.notEqual((await (await get()).json()).snapshotId, beforeContext)
  // A server-side response schema failure must not be blamed on request input.
  const inspect = service.inspect
  service.inspect = () => ({ ...inspect(agent), sessionId: '' })
  assert.equal((await get()).status, 503); service.inspect = inspect
  const previewMethod = service.preview
  service.preview = async (...args) => {
    const planned = await previewMethod(...args)
    agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Concurrent context' }] }), { surfaceOp: 'append' })
    return planned
  }
  assert.equal((await post({ operation: 'preview' })).status, 409); service.preview = previewMethod
  const row = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care/runtime')
  await row.fiber.dispose(); assert.equal((await get()).status, 404)
})

test('Workbench v2 detects real streamed chunks across boundaries once and delivers a next-step notice without rewriting output', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  class DeltaAdapter extends CompletionAdapter {
    calls = 0
    async *stream() {
      if (this.calls++ > 0) { yield* super.stream(); return }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      for (const text of ['ARCH', 'IVE', ' more', ' more']) yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ARCHIVE more more' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new DeltaAdapter([{ blocks: [{ type: 'text', text: 'Ordinary next-step response.' }] }]))
  const agent = await ctx.agentLoop.create('workbench-delta', { provider: 'care-test', model: 'care-test' })
  const service = ctx.contextCareWorkbench
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'delta', revision: 1, title: 'Delta',
    rules: [{ schemaVersion: 2, sourceId: 'context-care:document:delta', id: 'archive', revision: 1, on: ['output.delta'],
      select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'ARCHIVE.*' },
      actions: [{ id: 'notice', kind: 'notify', stage: 'output.delta', enabledDefault: true, template: 'Observed archive marker.', dedupe: { mode: 'none' } }] }] } })
  await completionTurn(ctx, agent)
  const runs = service.store.read(agent.id).runtime.runs.filter(run => run.ruleId === 'archive')
  assert.equal(runs.length, 1, JSON.stringify(runs)); assert.equal(runs[0].status, 'succeeded')
  assert.equal(runs[0].delivery, 'delivered')
  assert.match(runs[0].occurrenceId, /output.delta/)
  const output = agent.session.snapshotEvents().find(event => event.type === 'assistant/message')
  assert.equal(output.data.message.content[0].text, 'ARCHIVE more more')
})

test('Workbench v2 streamed abort stops provider consumption and dependent resume starts a fresh native turn', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open()
  class AbortAdapter extends CompletionAdapter {
    calls = 0; afterMarker = false; cleaned = false
    async *stream(options) {
      if (this.calls++ > 0) { yield* super.stream(options); return }
      try {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'HALT_STREAM' }
        // The native turn signal must stop consumption before another chunk is requested.
        this.afterMarker = true
        yield { type: 'text-delta', index: 0, text: ' SHOULD_NOT_BE_READ' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } finally { this.cleaned = true }
    }
  }
  const adapter = new AbortAdapter([{ blocks: [{ type: 'text', text: 'Resumed safely in a fresh attempt.' }] }])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-delta-abort', { provider: 'care-test', model: 'care-test' })
  const service = ctx.contextCareWorkbench
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'delta-abort', revision: 1, title: 'Abort and resume',
    rules: [{ schemaVersion: 2, id: 'halt', revision: 1, on: ['output.delta'],
      select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'HALT_STREAM' },
      actions: [{ id: 'abort', kind: 'abort', stage: 'output.delta', enabledDefault: true },
        { id: 'resume', kind: 'resume', stage: 'output.delta', enabledDefault: true, dependsOn: ['abort'], template: 'Continue from the verified safe boundary.' }] }] } })
  await completionTurn(ctx, agent)
  const runs = service.store.read(agent.id).runtime.runs
  assert.deepEqual(runs.map(run => [run.actionId, run.status, run.result?.value]), [['abort', 'succeeded', 'abort-requested'], ['resume', 'succeeded', 'resume-queued']], JSON.stringify(runs))
  assert.equal(adapter.afterMarker, false); assert.equal(adapter.cleaned, true); assert.equal(adapter.calls, 2)
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter(event => event.type === 'turn/start').length, 2)
  assert.ok(events.some(event => event.type === 'user/message' && producedBy(event.data.source, 'dsh-context-care:workbench')))
  assert.ok(events.some(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.text === 'Resumed safely in a fresh attempt.')))
})

test('Workbench v2 streamed preferences start a fresh text boundary and auxiliary requests never trigger output rules', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('workbench-delta-policy', { provider: 'care-test', model: 'care-test' })
  const controls = ctx.contextCareControls
  const change = enabled => controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:delta-policy', ruleId: 'marker', actionId: 'notice', enabled })
  class PolicyAdapter extends CompletionAdapter {
    async *stream(options) {
      if (options.purpose === 'compaction') {
        yield { type: 'text-delta', index: 0, text: 'ARCHIVE' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ARCHIVE' } }
        yield { type: 'finish', reason: { kind: 'stop' } }; return
      }
      // Off/on transitions are real durable preference ACKs between provider chunks.
      yield { type: 'text-delta', index: 0, text: 'ARCH' }
      await change(false)
      yield { type: 'text-delta', index: 0, text: 'IVE' }
      await change(true)
      yield { type: 'text-delta', index: 0, text: 'IVE' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ARCHIVEIVE' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new PolicyAdapter([]))
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'delta-policy', revision: 1, title: 'Preference boundary',
    rules: [{ schemaVersion: 2, id: 'marker', revision: 1, on: ['output.delta'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: 'ARCHIVE' }, actions: [{ id: 'notice', kind: 'notify', stage: 'output.delta', enabledDefault: true, template: 'Marker observed.' }] }] } })
  const prepared = await ctx.contextCareRequests.prepareCall({ provider: 'care-test', model: 'care-test' }, new AbortController().signal)
  for await (const _chunk of prepared.stream({ ...prepared.config, sessionId: agent.id, purpose: 'compaction',
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Auxiliary summary.' }] })] })) { /* consume the actual middleware */ }
  assert.equal(service.store.read(agent.id).runtime.runs.length, 0)
  await completionTurn(ctx, agent)
  assert.equal(service.store.read(agent.id).runtime.runs.length, 0, 'Closed-interval text cannot finish a marker after reopening')
  assert.equal(agent.session.snapshotEvents().find(event => event.type === 'assistant/message').data.message.content[0].text, 'ARCHIVEIVE')
})

test('Workbench v2 streamed text budget stops and cleans the real request only while delta detection is enabled', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  class BudgetAdapter extends CompletionAdapter {
    cleaned = 0; afterLimit = 0
    async *stream() {
      try {
        yield { type: 'text-delta', index: 0, text: 'x'.repeat(32768) }
        yield { type: 'text-delta', index: 0, text: 'x' }
        this.afterLimit++
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'x'.repeat(32769) } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } finally { this.cleaned++ }
    }
  }
  const adapter = new BudgetAdapter([]); ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('workbench-delta-budget', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'delta-budget', revision: 1, title: 'Bounded stream',
    rules: [{ schemaVersion: 2, id: 'missing', revision: 1, on: ['output.delta'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: 'NEVER_MATCH' }, actions: [{ id: 'notice', kind: 'notify', stage: 'output.delta', enabledDefault: true, template: 'Unused.' }] }] } })
  await completionTurn(ctx, agent)
  assert.equal(adapter.cleaned, 1); assert.equal(adapter.afterLimit, 0)
  assert.match(JSON.stringify(agent.session.snapshotEvents().filter(event => ['assistant/attempt', 'turn/end'].includes(event.type))), /delta-text-budget-exceeded/)
  const controls = ctx.contextCareControls
  await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:delta-budget', ruleId: 'missing', actionId: 'notice', enabled: false })
  await completionTurn(ctx, agent)
  assert.equal(adapter.cleaned, 2); assert.equal(adapter.afterLimit, 1)
  const committed = agent.session.snapshotEvents().filter(event => event.type === 'assistant/message' && !event.data.interrupted)
  assert.equal(committed.at(-1).data.message.content[0].text.length, 32769)
  assert.equal(service.store.read(agent.id).runtime.runs.length, 0)
})

test('Workbench v2 display compares pure copies and re-renders history with current preferences without consuming actions', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('display-copy', { provider: 'care-test', model: 'care-test' })
  const event = agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 1, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' },
      content: [{ type: 'text', text: 'ARCHIVE' }, { type: 'text', text: 'REMOVE' }] }) }, { surfaceOp: 'append' })
  const action = (id, kind, extra = {}) => ({ id, kind, stage: 'display.render', enabledDefault: true, ...extra })
  const rule = (id, pattern, actions, extra = {}) => ({ schemaVersion: 2, id, revision: 1, on: ['display.render'],
    select: { view: 'display', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'regex', pattern }, actions, ...extra })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'display', revision: 1, title: 'Display', rules: [
    rule('high', '^ARCHIVE$', [action('replace', 'replace', { template: 'CLEAN' }), action('caption', 'inject', { dependsOn: ['replace'], template: 'Copy of {{captures.[0]}}', target: { view: 'display', anchor: 'matched', position: 'after' } })], { priority: 20, exclusiveGroup: 'caption' }),
    rule('low', '^ARCHIVE$', [action('replace', 'replace', { template: 'FALLBACK' })], { priority: 10, exclusiveGroup: 'caption' }),
    rule('hide', '^REMOVE$', [action('filter', 'filter')]),
  ] } })
  const before = structuredClone(agent.session.snapshotEvents()); const runtime = service.store.read(agent.id)
  const request = { messages: agent.session.deriveMessages().filter(message => message.role !== 'system') }
  const originalPlan = await service.preview(agent, request)
  const copy = await service.display(agent, event.seq)
  assert.equal(copy.changed, true)
  assert.deepEqual(copy.before.map(block => block.text), ['ARCHIVE', 'REMOVE'])
  assert.deepEqual(copy.after.map(block => block.text), ['CLEAN', 'Copy of ARCHIVE'])
  assert.equal(copy.after[1].seq, undefined, 'Display insertions cannot impersonate committed evidence')
  assert.deepEqual(await service.display(agent, event.seq), copy, 'Repeated renders cannot consume cooldown or lifetime')
  assert.deepEqual(service.store.read(agent.id), runtime)
  assert.deepEqual(agent.session.snapshotEvents(), before)
  assert.deepEqual((await service.preview(agent, request)).request, originalPlan.request)
  const controls = ctx.contextCareControls
  await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:display', ruleId: 'high', paused: true })
  assert.deepEqual((await service.display(agent, event.seq)).after.map(block => block.text), ['FALLBACK'])
  assert.deepEqual(agent.session.snapshotEvents(), before)
  const plain = `http://127.0.0.1:${ctx.webServer.port}/context-care/display?sessionId=${agent.id}&seq=${event.seq}`
  assert.equal((await fetch(plain)).status, 503)
  const { base, cookie } = await controlCookie(ctx); const url = `${base}/context-care/display?sessionId=${agent.id}&seq=${event.seq}`
  assert.equal((await fetch(url)).status, 401)
  const headers = { cookie }
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 405)
  assert.equal((await fetch(`${base}/context-care/display?sessionId=${agent.id}`, { headers })).status, 400)
  assert.equal((await fetch(`${base}/context-care/display?sessionId=${agent.id}&seq=-1`, { headers })).status, 400)
  assert.equal((await fetch(`${base}/context-care/display?sessionId=missing&seq=0`, { headers })).status, 404)
  assert.equal((await fetch(url, { headers: { ...headers, origin: 'http://foreign.test' } })).status, 403)
  const response = await fetch(url, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual((await response.json()).projections[0].after.map(block => block.text), ['FALLBACK'])
  assert.deepEqual(agent.session.snapshotEvents(), before)
})


test('actual display template failure stays visible while two conversation turns complete', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('broken-display-template', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'broken-template', revision: 1, title: 'Broken display', rules: [
    { schemaVersion: 2, id: 'broken', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: 'SECRET_MESSAGE_BODY' }, actions: [{ id: 'copy', kind: 'replace', stage: 'display.render', enabledDefault: true, template: '{{vars.missing}}' }] },
  ] } })
  for (let index = 0; index < 2; index++) {
    agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'SECRET_MESSAGE_BODY' }] }), { surfaceOp: 'append' })
    await completionTurn(ctx, agent)
    const ended = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason
    assert.equal(ended.kind, 'completed', JSON.stringify(ended))
  }
  await service.reconcile(agent)
  const failures = service.store.read(agent.id).runtime.runs.filter(run => run.kind === 'display')
  assert.equal(failures.length, 1)
  assert.equal(failures[0].status, 'failed'); assert.equal(failures[0].count, 2)
  assert.equal(failures[0].reason, 'display-planning-failed')
  assert.equal(failures[0].result.phase, 'planning')
  assert.equal(JSON.stringify(failures).includes('SECRET_MESSAGE_BODY'), false)
  const { base, cookie } = await controlCookie(ctx)
  const response = await fetch(`${base}/context-care/actions?sessionId=${agent.id}&limit=20`, { headers: { cookie } })
  assert.equal(response.status, 200)
  const wire = await response.json()
  assert.equal(wire.matchingFailures[0].kind, 'display')
  assert.equal(wire.matchingFailures[0].reason, 'display-planning-failed')
  assert.deepEqual(wire.displayMarkers, [])
})

test('real display markers exclude unmatched and same-text replacements', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('display-marker-change-only', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'markers', revision: 1, title: 'Markers', rules: [
    { schemaVersion: 2, id: 'noop', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: 'KEEP' }, actions: [{ id: 'replace', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'KEEP' }] },
    { schemaVersion: 2, id: 'change', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: 'CHANGE' }, actions: [{ id: 'replace', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'CHANGED' }] },
  ] } })
  const messages = ['PLAIN', 'KEEP', 'CHANGE'].map(text => agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' }))
  await service.reconcile(agent)
  const { base, cookie } = await controlCookie(ctx)
  const response = await fetch(`${base}/context-care/actions?sessionId=${agent.id}&limit=20`, { headers: { cookie } })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).displayMarkers, [messages[2].seq])
  for (const event of messages.slice(0, 2)) {
    const detail = await fetch(`${base}/context-care/display?sessionId=${agent.id}&seq=${event.seq}`, { headers: { cookie } })
    assert.equal(detail.status, 200)
    assert.deepEqual((await detail.json()).projections, [])
  }
  assert.deepEqual(agent.session.deriveMessages().map(message => message.content[0].text), ['PLAIN', 'KEEP', 'CHANGE'])
  const controls = ctx.contextCareControls
  await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:markers', ruleId: 'change', paused: true })
  const afterDisable = await fetch(`${base}/context-care/actions?sessionId=${agent.id}&limit=20`, { headers: { cookie } })
  assert.equal(afterDisable.status, 200)
  assert.deepEqual((await afterDisable.json()).displayMarkers, [], 'A previously changed result cannot mark an unchanged current projection')
})

test('Workbench v2 display refuses signed text patches and cancels matching without a state write', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('display-signed', { provider: 'care-test', model: 'care-test' })
  const event = agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: 1, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-test', model: 'care-test' }, content: [{ type: 'reasoning', text: 'SEALED', signature: 'sig' }] }) }, { surfaceOp: 'append' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'signed', revision: 1, title: 'Signed', rules: [
    { schemaVersion: 2, id: 'patch', revision: 1, on: ['display.render'], select: { view: 'original', roles: ['assistant'], blockTypes: ['reasoning'] },
      match: { kind: 'regex', pattern: 'SEALED' }, actions: [{ id: 'replace', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'OPEN' }] },
  ] } })
  const before = structuredClone(agent.session.snapshotEvents())
  await assert.rejects(service.display(agent, event.seq), error => error.code === 'CONTEXT_CARE_DISPLAY_FAILED' && /block cannot be text-patched/.test(error.message))
  const runtime = service.store.read(agent.id)
  assert.equal(runtime.runtime.runs.filter(run => run.kind === 'display' && run.status === 'failed').length, 1)
  const controller = new AbortController(); controller.abort(new Error('test-display-abort'))
  await assert.rejects(service.display(agent, event.seq, controller.signal), /test-display-abort/)
  assert.deepEqual(agent.session.snapshotEvents(), before)
  assert.deepEqual(service.store.read(agent.id), runtime, 'Cancellation must not create another failed assessment or consume action state')
})

test('Workbench v2 display budgets the complete response and refuses a configuration race before publication', async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('display-budget-race', { provider: 'care-test', model: 'care-test' })
  const event = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'KEEP' }] }), { surfaceOp: 'append' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'budget', revision: 1, title: 'Budget', rules: [
    { schemaVersion: 2, id: 'patch', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: 'KEEP' }, actions: [{ id: 'replace', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'COPY' }] },
  ] } })
  const projection = await service.display(agent, event.seq)
  const fullBytes = Buffer.byteLength(JSON.stringify({ projections: [projection] }))
  const { seq, changed, ...inner } = projection
  assert.ok(Buffer.byteLength(JSON.stringify(inner)) < fullBytes - 1)
  const before = structuredClone(agent.session.snapshotEvents())
  await service.close()
  const { openWorkbenchHost } = await pluginModule('workbench-host.js')
  const bounded = await openWorkbenchHost(ctx, ctx.contextCareControls, { maxRequestBytes: fullBytes - 1 })
  t.after(() => bounded.close())
  await assert.rejects(bounded.display(agent, event.seq), /display-result-budget-exceeded/)
  assert.deepEqual(agent.session.snapshotEvents(), before)
  await bounded.close()
  // Race validation has its own sufficient budget and a warm worker. A synchronous
  // template registration changes the captured token before any worker reply can publish;
  // this does not depend on cold startup taking longer than a durable preference ACK.
  const racing = await openWorkbenchHost(ctx, ctx.contextCareControls)
  t.after(() => racing.close())
  assert.equal((await racing.display(agent, event.seq)).changed, true)
  const pending = assert.rejects(racing.display(agent, event.seq), /workbench-changed-during-display/)
  const disposePartial = racing.registerPartial({ name: 'display-race-partial', revision: 1, template: 'RACE' })
  await pending
  disposePartial()
  const controls = ctx.contextCareControls
  await controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:budget', ruleId: 'patch', paused: true })
  assert.equal((await racing.display(agent, event.seq)).changed, false)
  assert.deepEqual(agent.session.snapshotEvents(), before)
})

test('Workbench v2 external detector finalizes a real stream once and exposes owned availability after disposal', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  class DetectorAdapter extends CompletionAdapter {
    calls = 0
    async *stream(options) {
      if (this.calls++ > 0) { yield* super.stream(options); return }
      yield { type: 'text-delta', index: 0, text: 'ARCH' }
      yield { type: 'text-delta', index: 0, text: 'IVE' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ARCHIVE' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new DetectorAdapter([{ blocks: [{ type: 'text', text: 'Next step.' }] }]))
  const agent = await ctx.agentLoop.create('external-detector', { provider: 'care-test', model: 'care-test' })
  const dispose = service.registerDetector({ plugin: 'test-plugin', ref: 'test:final', revision: 1, sessionId: agent.id, on: ['output.delta'],
    paramsSchema: {}, stateSchema: { type: 'string' }, resultSchema: {}, callbacks: {
      initialize() { return '' },
      feed({ state, delta }) { return { state: state + delta, result: { ok: false, ranges: [], captures: {} } } },
      finalize({ state }) { return { state, result: { ok: state === 'ARCHIVE', ranges: [], captures: { text: state } } } },
      reset() { return '' },
    } })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'detector', revision: 1, title: 'External detector', rules: [
    { schemaVersion: 2, id: 'final', revision: 1, on: ['output.delta'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
      match: { kind: 'detector', ref: 'test:final', revision: 1 }, actions: [{ id: 'notice', kind: 'notify', stage: 'output.delta', enabledDefault: true, template: 'Finalized {{captures.text}}.' }] },
  ] } })
  await completionTurn(ctx, agent)
  const runs = service.store.read(agent.id).runtime.runs.filter(run => run.ruleId === 'final')
  assert.equal(runs.length, 1); assert.equal(runs[0].status, 'succeeded')
  assert.ok(agent.session.snapshotEvents().some(event => event.type === 'user/message' && JSON.stringify(event.data).includes('Finalized ARCHIVE.')))
  assert.ok(agent.session.snapshotEvents().some(event => event.type === 'assistant/message' && event.data.message.content[0].text === 'ARCHIVE'))
  assert.equal(service.sources(agent.id).find(source => source.sourceId === 'context-care:document:detector').rules[0].actions[0].available, true)
  await dispose()
  const missing = service.sources(agent.id).find(source => source.sourceId === 'context-care:document:detector').rules[0].actions[0]
  assert.equal(missing.available, false); assert.equal(missing.reason, 'detector-unavailable')
})

const pathologicalDocument = stage => ({ schemaVersion: 2, id: 'slow', revision: 1, title: 'Real pathological regex', rules: [
  { schemaVersion: 2, id: 'slow', revision: 1, on: [stage], select: { view: stage === 'request.assemble' ? 'model' : 'original', roles: [stage === 'request.assemble' ? 'user' : 'assistant'], blockTypes: ['text'] },
    match: { kind: 'regex', pattern: '(a+)+$' }, actions: [{ id: 'notify', kind: 'notify', stage, enabledDefault: true, template: 'MUST NOT DELIVER' }] },
] })

test('real output matcher failure is durable and visible over HTTP while two turns continue', async t => {
  const owned = await fixture(t, false, {}, {}, { matcher: { timeoutMs: 100 } }); const ctx = await owned.open()
  const text = 'a'.repeat(1000) + '!'
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text }] }, { blocks: [{ type: 'text', text: 'Second turn completes.' }] }]))
  const agent = await ctx.agentLoop.create('matcher-output-fault', { provider: 'care-test', model: 'care-test' })
  const service = ctx.contextCareWorkbench
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: pathologicalDocument('output.complete') })
  await completionTurn(ctx, agent)
  await completionTurn(ctx, agent)
  assert.deepEqual(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data.reason.kind), ['completed', 'completed'])
  const failures = service.store.read(agent.id).runtime.runs.filter(run => run.kind === 'matching')
  assert.equal(failures.length, 1)
  assert.equal(failures[0].status, 'failed')
  assert.equal(failures[0].result.stage, 'output.complete')
  assert.equal(failures[0].reason, 'matcher-work-timeout')
  assert.ok(failures[0].sourceSeqs.length)
  assert.doesNotMatch(JSON.stringify(agent.session.deriveMessages()), /MUST NOT DELIVER/)
  const { base, cookie } = await controlCookie(ctx)
  const response = await fetch(`${base}/context-care/rule-runtime?sessionId=${agent.id}`, { headers: { cookie } })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.runs.find(run => run.kind === 'matching').result.stage, 'output.complete')
  await owned.close(ctx)
  const restored = await owned.open()
  assert.equal(restored.contextCareWorkbench.store.read(agent.id).runtime.runs.find(run => run.kind === 'matching').reason, 'matcher-work-timeout')
})

test('real concurrent display timeouts cannot consume request matching admission', async t => {
  const owned = await fixture(t, false, {}, {}, { matcher: { timeoutMs: 200, maxPending: 2 } }); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agents = await Promise.all(['load-one', 'load-two', 'load-three'].map(name => ctx.agentLoop.create(name, { provider: 'care-test', model: 'care-test' })))
  for (const agent of agents) await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'load', revision: 1, title: 'Load', rules: [
    { schemaVersion: 2, id: 'slow', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '(a+)+$' },
      actions: [{ id: 'copy', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'COPY' }] },
    { schemaVersion: 2, id: 'fast', revision: 1, on: ['request.assemble'], select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: 'ACTUAL' },
      actions: [{ id: 'replace', kind: 'replace', stage: 'request.assemble', enabledDefault: true, template: 'PLANNED' }] },
  ] } })
  const events = agents.map(agent => agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'a'.repeat(1000) + '!' }] }), { surfaceOp: 'append' }))
  const reads = Promise.allSettled(agents.map((agent, index) => service.display(agent, events[index].seq)))
  const plan = await service.assemble(agents[2], { messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'ACTUAL' }] })], purpose: 'conversation' })
  assert.match(JSON.stringify(plan.request.messages), /PLANNED/)
  assert.notEqual(plan.matchStatus, 'failed')
  const outcomes = await reads
  assert.deepEqual(outcomes.map(value => value.status), ['rejected', 'rejected', 'rejected'])
  assert.deepEqual(outcomes.map(value => value.reason.message).sort(), ['matcher-capacity-exceeded', 'matcher-work-timeout', 'matcher-work-timeout'])
  assert.equal(service.matcherStats().display.active, 0)
  assert.equal(service.matcherStats().processing.active, 0)
  for (const agent of agents) assert.equal(service.store.read(agent.id).runtime.runs.find(run => run.kind === 'matching').status, 'failed')
})

test('real tool matcher timeout rejects only that tool assessment and the conversation continues', async t => {
  const owned = await fixture(t, false, {}, {}, { matcher: { timeoutMs: 100 } }); const ctx = await owned.open()
  let executions = 0
  ctx.effect(() => ctx.tools.register({ name: 'matcher_fixture', description: 'Count actual execution',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute() { executions++; return { summary: 'Executed' } } }))
  const adapter = new CompletionAdapter([{ blocks: [{ type: 'tool-call', id: 'matcher-call', name: 'matcher_fixture', arguments: JSON.stringify({ text: 'a'.repeat(1000) + '!' }) }] },
    { blocks: [{ type: 'text', text: 'Conversation continued after tool assessment failure.' }] }])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('matcher-tool-fault', { provider: 'care-test', model: 'care-test' })
  await ctx.contextCareWorkbench.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'tool-fault', revision: 1, title: 'Tool fault', rules: [
    { schemaVersion: 2, id: 'slow', revision: 1, on: ['tool.before-execute'], select: { view: 'original', roles: ['assistant'], blockTypes: ['tool-call'] },
      match: { kind: 'regex', pattern: '(a+)+$', field: 'block.arguments.text' }, actions: [{ id: 'deny', kind: 'filter', stage: 'tool.before-execute', enabledDefault: true }] },
  ] } })
  await completionTurn(ctx, agent)
  assert.equal(executions, 0)
  assert.equal(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'completed')
  assert.match(JSON.stringify(agent.session.snapshotEvents().find(event => event.type === 'tool/result').data), /assessment failed.*matcher-work-timeout/)
  assert.equal(ctx.contextCareWorkbench.store.read(agent.id).runtime.runs.find(run => run.kind === 'matching').result.stage, 'tool.before-execute')
})

test('explicit required request matching reports failure and does not dispatch the unresolved request', async t => {
  const owned = await fixture(t, false, {}, {}, { matcher: { timeoutMs: 100 }, requiredStages: ['request.assemble'] }); const ctx = await owned.open()
  const adapter = new ScriptedAdapter(); ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('matcher-required-fault', { provider: 'care-test', model: 'care-test' })
  const service = ctx.contextCareWorkbench
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: pathologicalDocument('request.assemble') })
  await completionTurn(ctx, agent, 'a'.repeat(1000) + '!')
  assert.equal(adapter.requests.length, 0)
  assert.match(JSON.stringify(agent.session.snapshotEvents()), /CONTEXT_CARE_MATCH_FAILED/)
  assert.equal(service.store.read(agent.id).runtime.runs.find(run => run.kind === 'matching').result.stage, 'request.assemble')
})

test('Workbench v2 builtin incremental detector excludes closed-interval text in the real Host pipeline', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  const agent = await ctx.agentLoop.create('builtin-detector-policy', { provider: 'care-test', model: 'care-test' })
  const controls = ctx.contextCareControls
  const change = enabled => controls.patch(agent.id, { revision: controls.revision(agent.id), sourceId: 'context-care:document:builtin-policy', ruleId: 'marker', actionId: 'notice', enabled })
  class DetectorPolicyAdapter extends CompletionAdapter {
    async *stream() {
      yield { type: 'text-delta', index: 0, text: 'ARCH' }
      await change(false)
      yield { type: 'text-delta', index: 0, text: 'IVE' }
      await change(true)
      yield { type: 'text-delta', index: 0, text: 'IVE' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ARCHIVEIVE' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['care-test'], new DetectorPolicyAdapter([]))
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'builtin-policy', revision: 1, title: 'Builtin policy', rules: [
    { schemaVersion: 2, id: 'marker', revision: 1, on: ['output.delta'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
      match: { kind: 'detector', ref: 'context-care:marker', revision: 1, params: { token: 'ARCHIVE' } },
      actions: [{ id: 'notice', kind: 'notify', stage: 'output.delta', enabledDefault: true, template: 'Marker observed.' }] },
  ] } })
  await completionTurn(ctx, agent)
  assert.equal(service.store.read(agent.id).runtime.runs.length, 0)
  assert.equal(agent.session.snapshotEvents().find(event => event.type === 'assistant/message').data.message.content[0].text, 'ARCHIVEIVE')
})
