import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Read only the installed historical plugin and the actual deployed Host.
// This fixture owns a random port, fresh storage and a test-only authorization.
for (const name of ['DSH_TEST_RUNTIME_ROOT', 'DSH_TEST_LEGACY_ROOT', 'DSH_TEST_CHECKOUT']) {
  if (!process.env[name]) throw new Error(`Legacy transport diagnostics require ${name}`)
}
const runtime = resolve(process.env.DSH_TEST_RUNTIME_ROOT)
const legacy = resolve(process.env.DSH_TEST_LEGACY_ROOT)
assert.equal(JSON.parse(await readFile(resolve(legacy, 'package.json'), 'utf8')).version, '0.8.1')
const runtimeRequire = createRequire(pathToFileURL(resolve(runtime, 'package.json')))
const hostModule = name => import(pathToFileURL(runtimeRequire.resolve(name)).href)
const legacyModule = name => import(pathToFileURL(resolve(legacy, 'src', name)).href)
const { Context } = await hostModule('@deepseek-ai/cordis')
const { default: Loader } = await hostModule('@deepseek-ai/cordis-plugin-loader')
const { default: Include } = await hostModule('@deepseek-ai/cordis-plugin-include')
const { LlmAdapter, createUserMessage } = await hostModule('@deepseek-ai/dsh-llm')
const names = ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'agent-loop', 'compaction-image-offload', 'token-meter', 'compaction-basic', 'storage', 'storage-json', 'storage-domain', 'host-webserver', 'client-connection']
const modules = new Map(await Promise.all(names.map(async name => {
  const module = await hostModule('@deepseek-ai/dsh-' + name)
  return ['@deepseek-ai/dsh-' + name, module.default ?? module]
})))
for (const [specifier, file] of [['dsh-context-care', 'display-host.js'], ['dsh-context-care/runtime', 'host.js'], ['dsh-context-care/agent', 'index.js'], ['dsh-context-care/completion', 'completion-host.js'], ['dsh-context-care/requests', 'request-host.js']]) modules.set(specifier, await legacyModule(file))
modules.set('@care-test/credentials', { name: 'care-test-credentials', apply(ctx) {
  const records = new Map()
  ctx.provide('credentials', { async modifyRecord(key, update) {
    const value = await update(records.get(key)); if (value !== undefined) records.set(key, value); return records.get(key)
  } })
} })
class FixtureAdapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
  async *stream() { throw new Error('This read-only diagnostic never dispatches a model request') }
}
const root = await mkdtemp(resolve(tmpdir(), 'care-legacy-display-transport-'))
const ctx = new Context()
let browser
try {
  ctx.provide('contextCareTestRoot', root)
  ctx.provide('contextCareTestCompletion', false)
  ctx.provide('contextCareTestConfig', {})
  ctx.provide('contextCareTestCompletionConfig', {})
  ctx.provide('contextCareTestRequestConfig', {})
  await copyFile(new URL('./fixtures/cordis.yml', import.meta.url), resolve(root, 'cordis.yml'))
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name) {
    assert.ok(modules.has(name), 'Unregistered diagnostic module: ' + name); return modules.get(name)
  } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(resolve(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  for (const row of ctx.loader.entries()) if (!row.disabled && row.fiber) await row.fiber.await()
  for (const name of ['@care-test/credentials', '@deepseek-ai/dsh-client-connection']) {
    await ctx.loader.create({ name }); await ctx.loader.await()
    await [...ctx.loader.entries()].find(row => row.options.name === name).fiber.await()
  }
  ctx.llm.registerAdapter(['care-test'], new FixtureAdapter())
  const agent = await ctx.agentLoop.create('legacy-display-transport', { provider: 'care-test', model: 'care-test' })
  const seqs = Array.from({ length: 8 }, () => agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'a'.repeat(1000) + '!' }] }), { surfaceOp: 'append' }).seq)
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  let cookie
  ctx.connection.authorizeIndex({ method: 'GET', url: ctx.connection.authenticatedUrl(base + '/'), headers: { host: new URL(base).host } }, {
    writeHead(status, headers) { assert.equal(status, 303); cookie = headers['set-cookie'].split(';')[0] }, end() {},
  })
  for (const file of ['display-records.js', 'action-records.js', 'http-failure.js']) {
    const source = await readFile(resolve(legacy, 'src', file), 'utf8')
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/care-test/legacy/' + file, handler(_req, res) {
      res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(source)
    } }))
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/care-test/legacy/page', handler(_req, res) {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><script type="module">import {createDisplayRecords} from './display-records.js'; window.records=createDisplayRecords(); for(const seq of ${JSON.stringify(seqs)})window.records.watch(${JSON.stringify(String(agent.id))},0,seq); window.readerReady=true;</script>`)
  } }))
  const browserRequire = createRequire(pathToFileURL(resolve(process.env.DSH_TEST_CHECKOUT, 'apps/web/package.json')))
  browser = await browserRequire('playwright').chromium.launch({ headless: true, channel: 'msedge' })
  const context = await browser.newContext()
  const [name, value] = cookie.split('=')
  await context.addCookies([{ name, value, url: base }])
  const page = await context.newPage()
  const responses = []; const failed = []
  page.on('response', response => { if (response.url().includes('/context-care/display?')) responses.push(response.status()) })
  page.on('requestfailed', request => { if (request.url().includes('/context-care/display?')) failed.push(request.failure()?.errorText) })
  await page.goto(base + '/care-test/legacy/page')
  await page.waitForFunction(() => window.readerReady && window.records.source.getSnapshot().size === 8 && [...window.records.source.getSnapshot().values()].every(row => row.status === 'ready'))
  assert.equal(responses.length, 8); assert.deepEqual(responses, Array(8).fill(200)); assert.equal(failed.length, 0)
  await page.evaluate(() => window.records.dispose())
  console.log(JSON.stringify({ case: 'legacy-no-display-rules', engine: process.version, responses, transportFailures: failed }))
  await ctx.contextCareWorkbench.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'legacy-timeout', revision: 1, title: 'Legacy real timeout', rules: [
    { schemaVersion: 2, id: 'slow', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '(a+)+$' }, actions: [{ id: 'replace', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'COPY' }] },
  ] } })
  responses.length = 0
  await page.reload()
  await page.waitForFunction(() => window.readerReady && window.records.source.getSnapshot().size === 8 && [...window.records.source.getSnapshot().values()].every(row => row.status === 'error'), undefined, { timeout: 30000 })
  const errors = await page.evaluate(() => { const rows = [...window.records.source.getSnapshot().values()].map(row => row.error); window.records.dispose(); return rows })
  assert.ok(responses.length >= 8); assert.ok(responses.every(status => status === 503)); assert.equal(failed.length, 0)
  assert.ok(errors.every(error => /HTTP 503: matcher-work-timeout/.test(error)))
  console.log(JSON.stringify({ case: 'legacy-real-display-timeouts', engine: process.version, responses, transportFailures: failed, errors }))
} finally {
  // Each owner still releases its resources if a preceding cleanup rejects.
  try { await browser?.close() }
  finally {
    try { await ctx.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  }
}
