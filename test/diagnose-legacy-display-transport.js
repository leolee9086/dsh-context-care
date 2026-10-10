import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'

// Read only the installed historical plugin and the actual deployed Host.
// This fixture owns a random port, fresh storage and a test-only authorization.
for (const name of ['DSH_TEST_RUNTIME_ROOT', 'DSH_TEST_LEGACY_ROOT', 'DSH_TEST_CHECKOUT']) {
  if (!process.env[name]) throw new Error(`Legacy transport diagnostics require ${name}`)
}
const runtime = resolve(process.env.DSH_TEST_RUNTIME_ROOT)
const legacy = resolve(process.env.DSH_TEST_LEGACY_ROOT)
const reader = process.env.DSH_TEST_READER_ROOT ? resolve(process.env.DSH_TEST_READER_ROOT) : legacy
const candidateReader = reader !== legacy
const clientArtifact = process.env.DSH_TEST_CLIENT_ARTIFACT === '1'
assert.ok(!process.env.DSH_TEST_CLIENT_ARTIFACT || clientArtifact, 'Client artifact flag must be 1')
const compression = process.env.DSH_TEST_WEB_COMPRESSION ?? 'none'
assert.ok(['none', 'gzip'].includes(compression), 'Web compression must be none or gzip')
assert.equal(JSON.parse(await readFile(resolve(legacy, 'package.json'), 'utf8')).version, '0.8.1')
if (candidateReader) assert.equal(JSON.parse(await readFile(resolve(reader, 'package.json'), 'utf8')).version, '0.8.2')
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
let desktop
try {
  ctx.provide('contextCareTestRoot', root)
  ctx.provide('contextCareTestCompletion', false)
  ctx.provide('contextCareTestConfig', {})
  ctx.provide('contextCareTestCompletionConfig', {})
  ctx.provide('contextCareTestRequestConfig', {})
  const composition = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
  assert.equal(composition.split('    port: 0').length, 2)
  // Own the temporary composition; do not edit either the checked-in fixture or live profile.
  await writeFile(resolve(root, 'cordis.yml'), composition.replace('    port: 0',
    `    port: 0\n    compression: ${compression}\n    compressionLevel: 1\n    compressionThresholdBytes: 1024`))
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
  const count = Number(process.env.DSH_TEST_DISPLAY_COUNT ?? 8)
  assert.ok(Number.isSafeInteger(count) && count >= 8 && count <= 256, 'Display count must be 8..256')
  const seqs = Array.from({ length: count }, () => agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'a'.repeat(1000) + '!' }] }), { surfaceOp: 'append' }).seq)
  let activeSeqs = seqs
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  let cookie
  ctx.connection.authorizeIndex({ method: 'GET', url: ctx.connection.authenticatedUrl(base + '/'), headers: { host: new URL(base).host } }, {
    writeHead(status, headers) { assert.equal(status, 303); cookie = headers['set-cookie'].split(';')[0] }, end() {},
  })
  for (const file of ['display-records.js', 'http-failure.js', ...(candidateReader ? ['display-response.js'] : ['action-records.js'])]) {
    const source = await readFile(resolve(reader, 'src', file), 'utf8')
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/care-test/legacy/' + file, handler(_req, res) {
      res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(source)
    } }))
  }
  if (clientArtifact) {
    // pnpm's package dependencies live beside the real package, not the consumer junction.
    const readerRequire = createRequire(pathToFileURL(await realpath(resolve(reader, 'package.json'))))
    const reactRoot = dirname(readerRequire.resolve('react/package.json'))
    for (const [route, file] of [
      ['react.js', resolve(reactRoot, 'cjs/react.production.min.js')],
      ['client.js', resolve(reader, 'lib/client.js')],
      ['artifact-reader.js', new URL('./fixtures/artifact-display-reader.js', import.meta.url)],
    ]) {
      const source = await readFile(file, 'utf8')
      // React's published CJS factory is wrapped for this browser; the actual Client stays untouched.
      const content = route === 'react.js' ? `window.React = (() => { const exports = {}; ${source}; return exports })();` : source
      ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/care-test/legacy/' + route, handler(_req, res) {
        res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(content)
      } }))
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/care-test/legacy/page', handler(_req, res) {
    res.writeHead(200, { 'content-type': 'text/html' })
    const setup = clientArtifact
      ? `import { loadArtifactReader } from './artifact-reader.js'; window.records = await loadArtifactReader(${JSON.stringify(candidateReader)});`
      : `import { createDisplayRecords } from './display-records.js'; window.records = createDisplayRecords();`
    res.end(`<!doctype html><script type="module">${setup} for(const seq of ${JSON.stringify(activeSeqs)})window.records.watch(${JSON.stringify(String(agent.id))},0,seq); window.readerReady=true;</script>`)
  } }))
  console.log(JSON.stringify({ case: 'legacy-diagnostic-reader', reader: candidateReader ? 'candidate' : 'legacy', artifact: clientArtifact, compression }))
  if (process.env.DSH_TEST_DESKTOP_EXE) {
    const { createDesktopProtocolDriver } = await import('./desktop-protocol-driver.js')
    desktop = await createDesktopProtocolDriver(root)
    const result = await desktop.run({ base, cookie, status: 'ready', count, holdMs: count > 8 ? 4200 : 0 })
    console.log(JSON.stringify({ case: 'legacy-desktop-no-rules', reader: candidateReader ? 'candidate' : 'legacy', engine: desktop.versions, count, ...result }))
    const responseCount = result.evidence.filter(row => row.surface === 'renderer-response' && row.status === 200).length
    assert.ok(responseCount >= count)
    if (candidateReader) assert.equal(responseCount, count, 'The on-demand reader does not poll')
    assert.equal(result.evidence.filter(row => row.surface === 'protocol' || row.surface === 'renderer-network').length, 0)
  }
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
  await page.waitForFunction(count => window.readerReady && window.records.source.getSnapshot().size === count && [...window.records.source.getSnapshot().values()].every(row => row.status === 'ready'), count)
  assert.equal(responses.length, count); assert.deepEqual(responses, Array(count).fill(200)); assert.equal(failed.length, 0)
  await page.evaluate(() => window.records.dispose())
  console.log(JSON.stringify({ case: 'legacy-no-display-rules', engine: process.version, responses, transportFailures: failed }))
  // A successful transformed result is large enough to exercise the real compression middleware.
  // One open detail avoids mixing transport validation with the legacy matcher's admission limit.
  await ctx.contextCareWorkbench.store.edit(agent.id, { revision: 0, operation: 'put-document', document: { schemaVersion: 2, id: 'legacy-timeout', revision: 1, title: 'Legacy display transport', rules: [
    { schemaVersion: 2, id: 'slow', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '^a+!$' }, actions: [{ id: 'replace', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'COPY' }] },
  ] } })
  activeSeqs = [seqs[0]]
  const route = `/context-care/display?sessionId=${String(agent.id)}&seq=${seqs[0]}`
  const response = await fetch(base + route, { headers: { cookie, 'accept-encoding': 'gzip' } })
  assert.equal(response.status, 200)
  const encoding = response.headers.get('content-encoding')
  assert.equal(encoding, compression === 'gzip' ? 'gzip' : null)
  const detail = await response.json()
  const validCopy = row => row.projections?.length === 1
    && row.projections[0].before[0].text === 'a'.repeat(1000) + '!'
    && row.projections[0].after[0].text === 'COPY'
  assert.ok(validCopy(detail))
  responses.length = 0
  await page.reload()
  await page.waitForFunction(() => window.readerReady && window.records.source.getSnapshot().size === 1 && [...window.records.source.getSnapshot().values()].every(row => row.status === 'ready'))
  const success = await page.evaluate(() => { const rows = [...window.records.source.getSnapshot().values()]; window.records.dispose(); return rows })
  assert.ok(success.every(validCopy)); assert.equal(failed.length, 0)
  console.log(JSON.stringify({ case: 'legacy-valid-display', compression, encoding, responses, transportFailures: failed, resultBytes: Buffer.byteLength(JSON.stringify(detail)) }))
  if (desktop) {
    const result = await desktop.run({ base, cookie, status: 'ready', count: 1 })
    assert.ok(result.snapshots.every(validCopy))
    assert.equal(result.evidence.filter(row => row.surface === 'protocol' || row.surface === 'renderer-network').length, 0)
    console.log(JSON.stringify({ case: 'legacy-desktop-valid-display', reader: candidateReader ? 'candidate' : 'legacy', compression, encoding, ...result }))
  }
  activeSeqs = seqs
  await ctx.contextCareWorkbench.store.edit(agent.id, { revision: 1, operation: 'put-document', document: { schemaVersion: 2, id: 'legacy-timeout', revision: 2, title: 'Legacy display transport', rules: [
    { schemaVersion: 2, id: 'slow', revision: 2, on: ['display.render'], select: { view: 'display', roles: ['user'], blockTypes: ['text'] }, match: { kind: 'regex', pattern: '(a+)+$' }, actions: [{ id: 'replace', kind: 'replace', stage: 'display.render', enabledDefault: true, template: 'COPY' }] },
  ] } })
  responses.length = 0
  await page.reload()
  await page.waitForFunction(count => window.readerReady && window.records.source.getSnapshot().size === count && [...window.records.source.getSnapshot().values()].every(row => row.status === 'error'), count, { timeout: 30000 })
  const errors = await page.evaluate(() => { const rows = [...window.records.source.getSnapshot().values()].map(row => row.error); window.records.dispose(); return rows })
  assert.ok(responses.length >= count); assert.ok(responses.every(status => status === 503)); assert.equal(failed.length, 0)
  const matcherHttpFailure = /HTTP 503: matcher-(work-timeout|capacity-exceeded)/
  assert.ok(errors.every(error => matcherHttpFailure.test(error)))
  assert.ok(errors.some(error => error.includes('matcher-work-timeout')))
  console.log(JSON.stringify({ case: 'legacy-real-display-timeouts', engine: process.version, responses, transportFailures: failed, errors }))
  if (desktop) {
    const result = await desktop.run({ base, cookie, status: 'error', count, holdMs: count > 8 ? 4200 : 0 })
    console.log(JSON.stringify({ case: 'legacy-desktop-real-timeouts', reader: candidateReader ? 'candidate' : 'legacy', count, ...result }))
    assert.ok(result.snapshots.every(row => matcherHttpFailure.test(row.error)))
    if (candidateReader) assert.ok(result.snapshots.every(row => row.phase === 'http' && row.httpStatus === 503))
    assert.equal(result.evidence.filter(row => row.surface === 'protocol' || row.surface === 'renderer-network').length, 0)
    // Real TCP peers exercise rejection before headers and failure while consuming a Response body.
    // These controlled faults identify the error path; they do not establish the historical trigger.
    for (const phase of ['before-headers', 'during-body', 'refused']) {
      const sockets = new Set()
      let requests = 0
      const fault = createServer(socket => {
        sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket))
        socket.once('data', () => {
          requests++
          if (phase === 'during-body') {
            socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n{"projections":[')
            setTimeout(() => socket.destroy(), 100)
          } else socket.destroy()
        })
      })
      await new Promise(resolve => fault.listen(0, '127.0.0.1', resolve))
      const displayBase = `http://127.0.0.1:${fault.address().port}`
      try {
        if (phase === 'refused') await new Promise(resolve => fault.close(resolve))
        const failure = await desktop.run({ base, cookie, displayBase, status: 'error', count })
        console.log(JSON.stringify({ case: `legacy-desktop-socket-${phase}`, reader: candidateReader ? 'candidate' : 'legacy', requests, ...failure }))
        assert.ok(failure.snapshots.every(row => row.error === 'TypeError: Failed to fetch'))
        if (candidateReader) {
          const expectedPhase = phase === 'during-body' ? 'body' : 'fetch'
          const expectedStatus = phase === 'during-body' ? 200 : undefined
          assert.ok(failure.snapshots.every(row => row.phase === expectedPhase && row.httpStatus === expectedStatus))
        }
        assert.ok(failure.evidence.some(row => row.surface === 'renderer-network'))
        if (phase !== 'during-body') assert.ok(failure.evidence.some(row => row.surface === 'protocol' && row.error.name === 'TypeError'))
      } finally {
        for (const socket of sockets) socket.destroy()
        if (fault.listening) await new Promise(resolve => fault.close(resolve))
      }
    }
  }
} finally {
  // Each owner still releases its resources if a preceding cleanup rejects.
  console.log(JSON.stringify({ case: 'legacy-cleanup-start', owner: 'browser' }))
  try { await browser?.close() }
  finally {
    console.log(JSON.stringify({ case: 'legacy-cleanup-start', owner: 'desktop' }))
    try { await desktop?.close() }
    finally {
      console.log(JSON.stringify({ case: 'legacy-cleanup-start', owner: 'host' }))
      try { await ctx.fiber.dispose() }
      finally {
        console.log(JSON.stringify({ case: 'legacy-cleanup-start', owner: 'temp' }))
        await rm(root, { recursive: true, force: true })
      }
    }
  }
  console.log(JSON.stringify({ case: 'legacy-cleanup-finished' }))
}
