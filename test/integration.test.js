import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as plugin from '../src/index.js'
import * as hostPlugin from '../src/host.js'
import * as completionPlugin from '../src/completion-host.js'
import * as requestPlugin from '../src/request-host.js'
import { completionStateKey, createCompletionObserver, createCompletionStateStore } from '../src/completion-observer.js'
import { producedBy } from '../src/producer-source.js'
import { captureInputPricing } from '../src/input-pricing.js'
import { createSummaryExecutor } from '../src/summary-executor.js'
import { buildSummaryRequest, frameSummary } from '../src/summary-request.js'
import { resolveConfig } from '../src/policy.js'
import { detectorFixture } from './fixtures/detector.js'

// This explicitly selected test acts as an external Host. The plugin itself never
// locates or imports a Harness checkout, and the default test suite is standalone.
if (!process.env.DSH_TEST_CHECKOUT) throw new Error('test:integration requires DSH_TEST_CHECKOUT pointing to a built Harness checkout')
const checkout = resolve(process.env.DSH_TEST_CHECKOUT)
const source = process.env.DSH_TEST_SOURCE === '1'
const load = async path => import(pathToFileURL(resolve(checkout, source ? path.replace('/lib/index.js', '/src/index.ts') : path)).href)
const { Context } = await load('vendor/cordis/lib/index.js')
const { LlmAdapter, createUserMessage, createMessage } = await load('packages/llm/llm/lib/index.js')
const { Session } = await load('packages/core/session/lib/index.js')
const { default: Loader } = await load('vendor/loader/lib/index.js')
const { default: Include } = await load('vendor/include/lib/index.js')
const paths = {
  llm: 'llm/llm', session: 'core/session', 'session-projection': 'session/session-projection',
  'system-prompt': 'core/system-prompt', tools: 'core/tools', agent: 'core/agent',
  'agent-loop': 'core/agent-loop', 'token-meter': 'llm/token-meter', 'compaction-basic': 'compaction/compaction-basic',
  storage: 'storage/storage', 'storage-json': 'storage/storage-json', 'storage-domain': 'storage/storage-domain', 'host-webserver': 'host/webserver', 'compaction-image-offload': 'compaction/compaction-image-offload',
}
const modules = new Map(await Promise.all(Object.entries(paths).map(async ([name, path]) => {
  const module = await load(`packages/${path}/lib/index.js`)
  return [`@deepseek-ai/dsh-${name}`, module.default ?? module]
})))
modules.set('dsh-context-care', hostPlugin)
modules.set('dsh-context-care/agent', plugin)
modules.set('dsh-context-care/completion', completionPlugin)
modules.set('dsh-context-care/requests', requestPlugin)

class ScriptedAdapter extends LlmAdapter {
  constructor(deep = false) { super(); this.deep = deep }
  requests = []
  calls = 0
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
  async *stream(options) {
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

async function boot(root, completion = true, config = {}, completionConfig = {}) {
  const ctx = new Context()
  ctx.provide('contextCareTestRoot', root)
  ctx.provide('contextCareTestCompletion', completion)
  ctx.provide('contextCareTestConfig', config)
  ctx.provide('contextCareTestCompletionConfig', completionConfig)
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
  const url = `http://127.0.0.1:${ctx.webServer.port}/context-care/rewrite-journal`
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).records, [])
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
  const row = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care')
  await row.fiber.dispose()
  assert.equal((await fetch(actionsUrl + '?sessionId=s1&limit=2')).status, 404)
  assert.equal((await fetch(url)).status, 404)
  assert.equal(ctx.tools.get('context_rest'), undefined)
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
async function fixture(t, completion = true, config = {}, completionConfig = {}) {
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
    async open(completionEnabled = completion) { const ctx = await boot(root, completionEnabled, config, completionConfig); contexts.add(ctx); return ctx },
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
  const row = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care')
  await row.fiber.dispose()
  await turn
  assert.equal(summarySignal.aborted, true)
  assert.equal(ctx.tools.get('context_rest'), undefined)
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 0)
  assert.equal(events.filter(event => event.type === 'compaction/start').length, events.filter(event => event.type === 'compaction/end').length)
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
  const raw = ctx.tokenMeter.measureInput(session, header).inputTokens
  function usageCall(inputTokens, step) {
    session.append('step/start', { turn: 1, step })
    session.append('request/header', { header, reason: 'initial' })
    session.append('assistant/message', { turn: 1, step, stream: [], usage: { inputTokens, outputTokens: 99999 },
      message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-pricing', model: 'vision' }, content: [{ type: 'text', text: 'A saved answer.' }] }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step })
  }
  usageCall((raw - 200) * 3 + 200, 1)
  const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session })
  assert.equal(pricing.pricingBasis.textScale, 3)
  assert.deepEqual(pricing.measure(), ctx.tokenMeter.measureInput(session))
  const request = { messages: [message], tools: header.tools, system: 'One-shot system' }
  const before = pricing.priceRequest(request)
  assert.equal(before, ctx.tokenMeter.priceRequest(request, pricing.pricingBasis))
  adapter.pricing = nextPricing
  usageCall(50000, 2)
  assert.notEqual(ctx.tokenMeter.measureInput(session).pricingBasis.textScale, 3)
  assert.notEqual(ctx.tokenMeter.priceRequest(request, ctx.tokenMeter.measureInput(session).pricingBasis), before)
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
  const raw = ctx.tokenMeter.measureInput(agent.session, header).inputTokens
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('request/header', { header, reason: 'initial' })
  agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], usage: { inputTokens: (raw - 300) * 4 + 300, outputTokens: 1 },
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'care-vision', model: 'vision' }, content: [{ type: 'text', text: 'Recent tail' }] }),
  }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: 1, step: 1 })
  const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session })
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

test('completion preferences retain observation while disabling notices, and oversized text is unavailable', async t => {
  for (const config of [{ notifications: false }, { maxObservedChars: 16 }]) {
    const owned = await fixture(t, true, {}, config)
    const ctx = await owned.open()
    const text = config.notifications === false ? 'DONE' : `DONE\n${'Verified evidence. '.repeat(20)}`
    ctx.llm.registerAdapter(['care-test'], new CompletionAdapter([{ blocks: [{ type: 'text', text }] }]))
    const agent = await ctx.agentLoop.create(`completion-preferences-${Object.keys(config)[0]}`, { provider: 'care-test', model: 'care-test' })
    await completionTurn(ctx, agent)
    const state = ctx.storageDomain.get('context_care_completion').table('observations').get(completionStateKey(String(agent.session.id), 'assistant'))
    if (config.notifications === false) assert.ok(state.cooldownUntil > Date.now())
    else assert.equal(state, undefined)
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
  const careEntry = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care')
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
  const actions = await (await fetch(`http://127.0.0.1:${ctx.webServer.port}/context-care/actions?sessionId=${agent.session.id}&limit=20`)).json()
  const deepActions = actions.actions.filter(action => action.action === 'deep-rest')
  assert.equal(deepActions.length, 1)
  assert.equal(deepActions[0].phase, 'completed')
  assert.equal(deepActions[0].journalPersisted, true)
  assert.ok(deepActions[0].replacements.some(item => item.newSeq === replacement.seq))
  const restored = Session.create('care-deep-replay', events, undefined, undefined, ctx.sessions.messageProjections)
  const { logRevision: restoredRevision, ...restoredInput } = ctx.tokenMeter.measureInput(restored)
  const { logRevision: liveRevision, ...liveInput } = ctx.tokenMeter.measureInput(agent.session)
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
  const careEntry = [...ctx.loader.entries()].find(entry => entry.options.name === 'dsh-context-care')
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
