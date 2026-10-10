import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

// The caller supplies an independently installed consumer; never symlink the development dependencies.
const consumer = resolve(process.argv[2])
const require = createRequire(pathToFileURL(resolve(consumer, 'package.json')))
const manifestPath = require.resolve('dsh-context-care/package.json')
const root = dirname(manifestPath)
const packageRequire = createRequire(pathToFileURL(manifestPath))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(manifest.version, expected.version)
for (const name of ['.', './runtime', './agent', './completion', './requests', './activate']) {
  const module = await import(pathToFileURL(require.resolve(name === '.' ? 'dsh-context-care' : `dsh-context-care/${name.slice(2)}`)).href)
  assert.equal(typeof module.apply, 'function', name)
}
const declarations = await import(pathToFileURL(require.resolve('dsh-context-care/declarations')).href)
assert.equal(declarations.validateDocument({ schemaVersion: 2, id: 'installed', revision: 1, title: 'Installed' }).id, 'installed')
let client
runInNewContext(await readFile(resolve(root, 'lib/client.js'), 'utf8'), {
  window: { __ModuleLoader__: { load(row) { client = row.factory(name => packageRequire(name)) } } },
  fetch, setInterval, clearInterval, setTimeout, clearTimeout, AbortController,
})
assert.equal(typeof client.apply, 'function')
assert.equal(manifest.dependencies['@leolee9086/dsh-rule-engine'], '0.3.0')
assert.equal(manifest.dependencies['dsh-better-session-query'], '0.1.1')
const names = await readdir(resolve(root, 'src'))
assert.equal(names.includes('vendor'), false)
for (const file of names.filter(name => name.endsWith('.js'))) {
  const source = await readFile(resolve(root, 'src', file), 'utf8')
  for (const [, target] of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) if (target.startsWith('.')) await readFile(resolve(root, 'src', target))
}
for (const name of ['@leolee9086/dsh-rule-engine', 'dsh-better-session-query']) {
  const installed = JSON.parse(await readFile(packageRequire.resolve(`${name}/package.json`), 'utf8'))
  assert.equal(installed.version, manifest.dependencies[name], name)
}
const engine = await import(pathToFileURL(packageRequire.resolve('@leolee9086/dsh-rule-engine')).href)
const query = await import(pathToFileURL(packageRequire.resolve('dsh-better-session-query/blocks')).href)
const event = { seq: 7, type: 'assistant/message', time: 1, data: { content: [{ type: 'text', text: '  ORIGINAL\n' }] } }
const [block] = query.extractRawBlocks(event, { sessionId: 'public-consumer' })
assert.equal(block.text, '  ORIGINAL\n')
assert.equal(Object.isFrozen(block), true)
const { createBoundedMatcher } = await import(pathToFileURL(resolve(root, 'src/bounded-matcher.js')).href)
const matcher = createBoundedMatcher()
try {
  const rule = engine.normalizeRuleV2({ schemaVersion: 2, sourceId: 'public-consumer', id: 'match', revision: 1,
    on: ['output.complete'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
    match: { kind: 'regex', pattern: 'ORIGINAL' }, actions: [{ id: 'notice', kind: 'notify', stage: 'output.complete', enabledDefault: true, template: 'matched' }] })
  assert.equal((await matcher.detect({ stage: 'output.complete', rules: [rule], blocks: [{ ...block, view: 'original' }] })).length, 1)
} finally { await matcher.close() }
console.log(`Independently installed ${manifest.name}@${manifest.version}: public entries, Client factory, exact dependencies, raw blocks and matching worker passed`)
console.log(root)
