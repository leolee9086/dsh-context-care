import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises'
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
import { buildSummaryRequest, frameSummary } from '../src/summary-request.js'
import { resolveConfig } from '../src/policy.js'
import { detectorFixture } from './fixtures/detector.js'

// This explicitly selected test acts as an external Host. The plugin itself never
// locates or imports a Harness checkout, and the default test suite is standalone.
const runtimeRoot = process.env.DSH_TEST_RUNTIME_ROOT
if (!runtimeRoot && !process.env.DSH_TEST_CHECKOUT) throw new Error('test:integration requires an explicit DSH_TEST_CHECKOUT or DSH_TEST_RUNTIME_ROOT')
const checkout = resolve(runtimeRoot ?? process.env.DSH_TEST_CHECKOUT)
const source = !runtimeRoot && process.env.DSH_TEST_SOURCE === '1'
const runtimeRequire = runtimeRoot ? createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) : undefined
const vendorNames = { cordis: '@deepseek-ai/cordis', loader: '@deepseek-ai/cordis-plugin-loader', include: '@deepseek-ai/cordis-plugin-include' }
const load = async path => {
  // Desktop artifacts live inside ASAR, resolved by Electron's official loader.
  // The test consumes them read-only; runtime plugin imports remain independent.
  const parts = path.split('/')
  const target = runtimeRequire ? runtimeRequire.resolve(parts[0] === 'vendor' ? vendorNames[parts[1]]
    : `@deepseek-ai/dsh-${parts[2] === 'webserver' ? 'host-webserver' : parts[2]}`)
    : resolve(checkout, source ? path.replace('/lib/index.js', '/src/index.ts') : path)
  return import(pathToFileURL(target).href)
}
const { Context } = await load('vendor/cordis/lib/index.js')
const { LlmAdapter, createUserMessage, createMessage } = await load('packages/llm/llm/lib/index.js')
const { Session, buildForkSeed } = await load('packages/core/session/lib/index.js')
const { default: Loader } = await load('vendor/loader/lib/index.js')
const { default: Include } = await load('vendor/include/lib/index.js')
const paths = {
  llm: 'llm/llm', session: 'core/session', 'session-projection': 'session/session-projection',
  'system-prompt': 'core/system-prompt', tools: 'core/tools', agent: 'core/agent',
  'client-connection': 'client/connection',
  'agent-loop': 'core/agent-loop', 'token-meter': 'llm/token-meter', 'compaction-basic': 'compaction/compaction-basic',
  storage: 'storage/storage', 'storage-json': 'storage/storage-json', 'storage-domain': 'storage/storage-domain', 'host-webserver': 'host/webserver', 'compaction-image-offload': 'compaction/compaction-image-offload',
}
const modules = new Map(await Promise.all(Object.entries(paths).map(async ([name, path]) => {
  const module = await load(`packages/${path}/lib/index.js`)
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
  assert.equal((await fetch(actionsUrl)).status, 400)
  assert.equal((await fetch(`${actionsUrl}?sessionId=s1&limit=999`)).status, 400)
  for (let index = 0; index < 3; index++) await ctx.contextCareRequests.recordAction({ id: 's1', seq: index }, { action: 'prune', phase: 'completed', operationId: `s1-${index}` })
  await ctx.contextCareRequests.recordAction({ id: 's2', seq: 0 }, { action: 'summary', phase: 'committed', compactionId: 'private-s2' })
  const page = await (await fetch(`${actionsUrl}?sessionId=s1&limit=2&offset=0`)).json()
  assert.equal(page.total, 3)
  assert.equal(page.actions.length, 2)
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
  const missingSelection = await (await fetch(`${promptsUrl}?sessionId=prompt-history&limit=20&seq=999999`)).json()
  assert.equal(missingSelection.selectedFound, false)
  assert.equal(missingSelection.offset, 0, 'A missing selection must not fabricate a matching historical page')
  const originalFlush = ctx.contextCareRequests.flush
  ctx.contextCareRequests.flush = async () => { throw new Error('Persistent journal write failed') }
  const diagnostics = []
  t.mock.method(ctx.logger, 'warn', message => diagnostics.push(message))
  const failedPage = await fetch(`${actionsUrl}?sessionId=s1&limit=2`)
  assert.equal(failedPage.status, 500, 'A stale readable table must not hide a retained write failure')
  assert.deepEqual(await failedPage.json(), { error: 'journal-unavailable', message: 'Persistent journal write failed' })
  assert.match(diagnostics.at(-1), /Persistent journal write failed/)
  ctx.contextCareRequests.flush = originalFlush
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
  const firstPricing = { priceImages: images => images.map(() => ({ visualTokens: 100, text: 'Captured image handle' })) }
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
  const rawPricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session, header })
  const raw = rawPricing.priceRequest({ messages: [message], tools: header.tools })
  const calibrationRecords = []
  const calibration = { calibration: (_session, selectedHeader, basis) => journalCalibration(calibrationRecords, selectedHeader, basis) }
  function usageCall(inputTokens, step) {
    const rawInput = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session, header }).decomposeRequest({ messages: session.deriveMessages(), tools: header.tools })
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
  const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session, requests: calibration })
  assert.equal(pricing.pricingBasis.textScale, 3)
  assert.equal(pricing.measure().inputTokens, pricing.priceRequest({ messages: session.deriveMessages(), tools: header.tools }))
  const request = { messages: [message], tools: header.tools, system: 'One-shot system' }
  const before = pricing.priceRequest(request)
  const parts = pricing.decomposeRequest(request)
  assert.equal(before, parts.textTokens * 3 + parts.visualTokens)
  adapter.pricing = nextPricing
  usageCall(50000, 2)
  const repriced = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session, requests: calibration })
  assert.notEqual(repriced.pricingBasis.textScale, 3)
  assert.notEqual(repriced.priceRequest(request), before)
  assert.equal(pricing.priceRequest(request), before)
  assert.equal(pricing.measure().pricingBasis, pricing.pricingBasis)
  assert.equal(pricing.measure().logRevision, session.seq)
  // Dispatch can explicitly bind absence, even if the route currently declares images.
  const absent = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session, imageRequestPricing: undefined })
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
  const compact = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests, spec: resolveConfig() })
  let sources = agent.session.surface.nodes.slice(1)
  await compact(ctx.compaction, { start: sources[0], end: sources.at(-1) }, agent, new AbortController().signal,
    captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }))
  const correction = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Correction: exclude the obsolete conclusion. Pending job: verify D:/dev/work.md. '.repeat(400) }] }), { surfaceOp: 'append' })
  await compact(ctx.compaction, { start: correction.seq, end: correction.seq }, agent, new AbortController().signal,
    captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }))
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
  const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const proposed = { provider: 'care-summary', model: 'small', maxTokens: 128 }
  // Enough space for exactly the shorter prefix, including the system, schemas
  // and directive. The full selected prefix is deliberately larger.
  const shorter = selected.slice(0, -1)
  const summaryPrice = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session,
    header: { config: proposed, tools: agent.session.requestHeader().tools } })
  const capacity = Math.ceil(summaryPrice.priceRequest(ctx.contextCareRequests.preview(agent.session, buildSummaryRequest(agent.session, shorter, proposed, new AbortController().signal)).request)) + 128
  class SmallAdapter extends ScriptedAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: capacity } } }
  }
  const small = new SmallAdapter()
  ctx.llm.registerAdapter(['care-summary'], small)
  const compact = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
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
  const compact = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm,
    requests: { ...ctx.contextCareRequests, async recordAction(...args) {
      await ctx.contextCareRequests.recordAction(...args)
      active = false
    } }, spec: resolveConfig({}), eligible: () => active })
  const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
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
  const compact = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
    spec: resolveConfig({ summary: { provider: 'care-summary', model: 'summary', maxTokens: 100, maxRetries: 1 } }) })
  let seqs = agent.session.surface.nodes.slice(1, -1)
  let pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
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
  pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
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
    const compact = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm, requests,
      spec: resolveConfig({ minFreshTokens: 100, summary: { provider: 'repair-summary', model: 'summary', maxTokens: 100, maxRetries: 0 },
        ...(mode === 'repair-cap' ? { maxSummaryRepairRetries: 0 } : {}), ...(mode === 'call-cap' ? { maxSummaryCallsPerAction: 1 } : {}) }),
      recover: payload => ctx.waterfall('compaction/summary-error', payload, () => false) })
    const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
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
  const raw = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, header }).priceMessages([image])
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('request/header', { header, reason: 'initial' })
  agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: (raw - 300) * 4 + 300, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-vision', model: 'vision' }, content: [{ type: 'text', text: 'Recent tail' }] }),
  }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: 1, step: 1 })
  const rawInput = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, header }).decomposeRequest({ messages: [image] })
  const calibrationRecords = [{ kind: 'request', data: { purpose: 'conversation', dispatched: true, outcome: 'completed',
    eventType: 'assistant/message', eventSeq: agent.session.seq - 2, rawInput, usage: { inputTokens: (raw - 300) * 4 + 300 }, calibrationHeaderKey: calibrationHeaderKey(header) } }]
  const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session,
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
  const compact = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
    spec: resolveConfig({ summary: { provider: 'care-summary', model: 'summary', maxTokens: 1000 }, minFreshTokens: 1 }) })
  const seq = agent.session.surface.nodes[0]
  await assert.rejects(compact(ctx.compaction, { start: seq, end: seq }, agent, new AbortController().signal, pricing), { code: 'SUMMARY_NOT_SMALLER' })
  assert.ok(agent.session.surface.nodes.includes(seq))
  assert.equal(agent.session.snapshotEvents().some(event => event.surfaceOp?.op === 'replace'), false)
  assert.equal(agent.session.snapshotEvents().at(-1).type, 'compaction/end')
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

async function completionTurn(ctx, agent, text = 'Continue the requested task.') {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
  // The emit subscriber has its own write queue; Agent idle alone is no ACK.
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

test('real stream persists pending before settlement, excludes reasoning and quotes, and scopes cooldown by session/source', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const changes = []
  const off = ctx.on('domain/changed', change => {
    if (change.domain === 'context_care_completion') changes.push(change)
  })
  t.after(off)
  const adapter = new CompletionAdapter([
    { blocks: [{ type: 'reasoning', text: 'DONE' }, { type: 'text', text: '> completed\n```\n搞定\n```\nNot done.' }] },
    { blocks: [{ type: 'text', text: '任务完成了。' }] },
    { blocks: [{ type: 'text', text: 'DONE' }] },
    { blocks: [{ type: 'text', text: 'DONE' }] },
  ])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const first = await ctx.agentLoop.create('completion-one', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, first)
  assert.equal(changes.length, 0)
  await completionTurn(ctx, first)
  assert.equal(changes.length, 2, 'One pending ACK followed by one settlement ACK; block-end must not duplicate deltas')
  assert.equal(changes[0].value.pending.line, '任务完成了。')
  assert.equal(typeof changes[0].value.pending.occurrenceId, 'string')
  assert.equal(changes[1].value.pending, undefined)
  assert.ok(changes[1].value.cooldownUntil > Date.now())
  assert.equal(changes[0].key, completionStateKey(String(first.session.id), 'assistant'))
  await completionTurn(ctx, first)
  assert.equal(changes.length, 2, 'A new attempt must not evade source cooldown')
  const second = await ctx.agentLoop.create('completion-two', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, second)
  assert.equal(changes.length, 4)
  assert.notEqual(changes[2].key, changes[0].key)
  const saved = changes[1].value
  await owned.close(ctx)
  const resumed = await owned.open()
  const table = resumed.storageDomain.get('context_care_completion').table('observations')
  assert.deepEqual(table.get(changes[0].key), { version: 1, cooldownUntil: saved.cooldownUntil, completedOccurrenceId: saved.completedOccurrenceId })
})

test('disabled completion notices do not consume observation cooldown, and oversized text is unavailable', async t => {
  for (const config of [{ notifications: false }, { maxObservedChars: 16 }]) {
    const owned = await fixture(t, true, {}, config)
    const ctx = await owned.open()
    const text = config.notifications === false ? 'DONE' : `DONE\n${'Verified evidence. '.repeat(20)}`
    ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text }] }]))
    const agent = await ctx.agentLoop.create(`completion-preferences-${Object.keys(config)[0]}`, { provider: 'care-test', model: 'care-test' })
    await completionTurn(ctx, agent)
    const state = ctx.storageDomain.get('context_care_completion').table('observations').get(completionStateKey(String(agent.session.id), 'assistant'))
    assert.equal(state, undefined)
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
      const raw = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, header: { config: options, tools: options.tools } }).decomposeRequest(options)
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
  const frozen = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, requests: ctx.contextCareRequests })
  const before = frozen.measure().inputTokens
  for (let index = 0; index < 10; index++) agent.session.append('request/header', { header: agent.session.requestHeader(), reason: 'series' })
  assert.equal(frozen.measure().inputTokens, before, 'Log-only records add no phantom input')
  for (let index = 0; index < 10; index++) await completionTurn(ctx, agent, `New verified unit ${index}. ${'Small progress. '.repeat(100)}`)
  assert.equal(summaries().length, 1, 'Real new input remains below the release threshold without artificial action caps')
  assert.equal(adapter.requests.filter(request => request.purpose === 'compaction').length, 1)
  assert.deepEqual(agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt').map(event => event.data), [])
})

test('real failed model attempt clears pending without marking successful completion', async t => {
  const owned = await fixture(t)
  const ctx = await owned.open()
  const adapter = new CompletionAdapter([{ blocks: [{ type: 'text', text: 'DONE' }], reason: {
    kind: 'error', failure: { code: 'TEST_FAILURE', message: 'Original provider failure' },
  } }])
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('completion-failed', { provider: 'care-test', model: 'care-test' })
  const values = []
  const off = ctx.on('domain/changed', change => { if (change.domain === 'context_care_completion') values.push(change.value) })
  t.after(off)
  await completionTurn(ctx, agent)
  assert.ok(agent.session.snapshotEvents().some(event => event.type === 'assistant/attempt'))
  assert.equal(values.length, 2)
  assert.equal(values[0].pending.line, 'DONE')
  assert.deepEqual(values[1], { version: 1, pending: undefined, cooldownUntil: 0 })
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
  assert.equal(deepActions[0].journalPersisted, true)
  assert.ok(deepActions[0].replacements.some(item => item.newSeq === replacement.seq))
  const restored = Session.create('care-deep-replay', events, undefined, undefined, ctx.sessions.messageProjections)
  const { logRevision: restoredRevision, ...restoredInput } = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: restored }).measure()
  const { logRevision: liveRevision, ...liveInput } = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }).measure()
  // Session.create owns an additional constructor-seed event, with no input cost.
  assert.equal(restoredRevision, liveRevision + 1)
  assert.deepEqual(restoredInput, liveInput)
})

test('real request journal retains dispatch calibration facts and summary actions across Loader restart', async t => {
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
  assert.ok(conversation.every(record => record.data.dispatched && record.data.phase === 'settled'))
  assert.ok(conversation.some(record => record.data.outcome === 'failed'))
  assert.equal(summary.data.outcome, 'completed')
  assert.equal(summary.data.route.provider, 'care-test')
  assert.equal(summary.data.route.model, 'care-test')
  assert.match(summary.data.inputHash, /^[a-f0-9]{64}$/u)
  assert.ok(summary.data.budget.inputTokens > 0)
  assert.equal(typeof summary.data.pricingBasis.textScale, 'number')
  const action = records.find(record => record.kind === 'maintenance' && record.data.phase === 'committed')
  assert.ok(action.data.afterInput < action.data.beforeInput)
  assert.equal(agent.session.eventAt(action.data.summarySeq).type, 'compaction/summary')
  await owned.close(ctx)
  ctx = await owned.open()
  assert.deepEqual(ctx.contextCareRequests.list(agent.session.id), records)
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
  const operation = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
  const compact = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests,
    spec: resolveConfig({ summary: { provider: 'care-other', model: 'care-other', maxTokens: 128 }, minFreshTokens: 100 }) })
  const selected = agent.session.surface.nodes.slice(1, -1)
  await compact(ctx.compaction, { start: selected[0], end: selected.at(-1) }, agent, new AbortController().signal, operation)
  assert.equal(hasReminder(other.requests.at(-1)).length, 0)
  await ctx.contextCareRequests.flush(agent.session.id)
  const records = ctx.contextCareRequests.list(agent.session.id).filter(record => record.kind === 'request' && record.data.promptDecision)
  assert.equal(records.length, 2)
  for (const record of records) {
    assert.equal(record.data.promptDecision.segments.length, 1)
    assert.ok(record.data.budget.inputTokens > 0)
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
      const raw = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session }).decomposeRequest(options)
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
  assert.ok(records[0].data.rawInput.textTokens > records[1].data.rawInput.textTokens)
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

test('a control edit during durable notice reservation refuses handoff and restores both delivery allowances', async t => {
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
  // Preserve the real Cordis outbox write, then exercise the asynchronous ACK
  // boundary before Request Host can hand the prepared request to the adapter.
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
  assert.deepEqual(completion.list(), beforeCompletion)
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

test('completion outbox restores a bounded notice and delivers it on the next natural request', async t => {
  const owned = await fixture(t)
  let ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: '任务完成了。' }] }]))
  let agent = await ctx.agentLoop.create('completion-outbox', { provider: 'care-test', model: 'care-test' })
  await completionTurn(ctx, agent)
  const log = agent.session.snapshotEvents()
  assert.equal(ctx.get('contextCareCompletion').list()[0].status, 'pending')
  await owned.close(ctx)
  ctx = await owned.open()
  assert.equal(ctx.get('contextCareCompletion').list()[0].status, 'pending')
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

test('cold completion reconciliation finishes a missed outbox write without bypassing source cooldown', async t => {
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
  // Reproduce a crash boundary: settlement was durable, publication was absent.
  const store = createCompletionStateStore({ storageDomain: ctx.storageDomain })
  await store.ready
  const observer = createCompletionObserver({ ...store })
  const input = { sessionId: String(agent.session.id), sourceId: 'assistant', occurrenceId: records[0].data.attemptId, text: 'DONE' }
  await observer.observe(input)
  await observer.settle(input)
  await store.close()
  const log = agent.session.snapshotEvents()
  await owned.close(ctx)
  ctx = await owned.open()
  ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text: 'Continue verifying evidence.' }] }]))
  agent = (await ctx.agents.create({ sessionId: 'cold-completion', seed: log, agentOptions: { provider: 'care-test', model: 'care-test' } })).agent
  assert.equal(agent.session.eventAt(records[0].data.eventSeq).type, 'assistant/message')
  await completionTurn(ctx, agent)
  const notices = ctx.contextCareCompletion.list(agent.session.id)
  assert.equal(notices.length, 1, JSON.stringify({ state: ctx.storageDomain.get('context_care_completion').table('observations').get(completionStateKey('cold-completion', 'assistant')), records: ctx.contextCareRequests.list('cold-completion').map(record => ({ attempt: record.data.attemptId, seq: record.data.eventSeq, outcome: record.data.outcome, dispatched: record.data.dispatched, purpose: record.data.purpose })) }))
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

test('Workbench v2 edits request copies, renders strict entry templates, logs the diff and preserves committed source text', async t => {
  const owned = await fixture(t, false)
  const ctx = await owned.open()
  class WorkbenchAdapter extends CompletionAdapter {
    requests = []
    async *stream(request) { this.requests.push(request); yield* super.stream(request) }
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

test('browser on-demand reader reaches authenticated real Host and shows disconnect as failure', { timeout: 30000 }, async t => {
  const owned = await fixture(t, false); const ctx = await owned.open(); const service = ctx.contextCareWorkbench
  ctx.llm.registerAdapter(['care-test'], new ScriptedAdapter())
  const agent = await ctx.agentLoop.create('browser-display-real-host', { provider: 'care-test', model: 'care-test' })
  await service.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'browser', revision: 1, title: 'Browser', rules: [
    { schemaVersion: 2, id: 'replace', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] },
      match: { kind: 'regex', pattern: 'ORIGINAL' }, actions: [{ id: 'copy', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'TRANSFORMED' }] },
  ] } })
  const event = agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'ORIGINAL' }] }), { surfaceOp: 'append' })
  await service.reconcile(agent)
  const { base, cookie } = await controlCookie(ctx)
  const { build } = await import('tsdown')
  const out = await mkdtemp(resolve(tmpdir(), 'care-browser-production-ui-'))
  t.after(() => rm(out, { recursive: true, force: true }))
  await build({ config: false, entry: { fixture: 'test/browser-display-entry.js' }, outDir: out, platform: 'browser', format: 'esm',
    target: 'es2022', dts: false, sourcemap: false, deps: { alwaysBundle: () => true }, define: { 'process.env.NODE_ENV': JSON.stringify('production') } })
  const script = await readFile(resolve(out, 'fixture.js'), 'utf8')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/care-test/fixture.js', handler(_req, res) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(script) } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/care-test/page', handler(_req, res) {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><div id="root"></div><script>window.testIdentity = ${JSON.stringify({ sessionId: String(agent.id), seq: event.seq })}</script><script type="module" src="./fixture.js"></script>`)
  } }))
  const browserRequire = createRequire(pathToFileURL(resolve(checkout, 'apps/web/package.json')))
  const { chromium } = browserRequire('playwright')
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  t.after(() => browser.close())
  const context = await browser.newContext()
  const [name, value] = cookie.split('=')
  await context.addCookies([{ name, value, url: base }])
  const page = await context.newPage(); const requests = []
  page.on('request', request => { if (request.url().includes('/context-care/display?')) requests.push(request.url()) })
  await page.goto(`${base}/care-test/page`)
  await page.waitForFunction(() => window.readerReady === true)
  assert.equal(requests.length, 0, 'Mounting the actual marker performs no display HTTP read')
  assert.equal(await page.locator('aside').count(), 0)
  assert.equal(await page.locator('[data-context-care-marker]').textContent(), '显示已处理 →')
  await page.locator('[data-context-care-marker]').click()
  await page.locator('aside pre').filter({ hasText: 'TRANSFORMED' }).waitFor()
  assert.equal(await page.locator('aside pre').first().textContent(), 'ORIGINAL')
  assert.equal(await page.locator('aside pre').last().textContent(), 'TRANSFORMED')
  assert.equal(await page.locator('[data-original]').textContent(), 'ORIGINAL')
  assert.equal(requests.length, 1)
  assert.equal(agent.session.deriveMessages()[0].content[0].text, 'ORIGINAL')
  await page.screenshot({ path: resolve('artifacts/browser-real-host-sidebar.png') })
  await owned.close(ctx)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.locator('aside [role="alert"]').waitFor()
  assert.match(await page.locator('aside [role="alert"]').textContent(), /Failed to fetch/)
  assert.equal(requests.length, 2, 'Disconnect produces one explicit attempt, without background retry')
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
