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
const names = await readdir(resolve(root, 'src'))
assert.equal(names.includes('vendor'), false)
for (const file of names.filter(name => name.endsWith('.js'))) {
  const source = await readFile(resolve(root, 'src', file), 'utf8')
  for (const [, target] of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) if (target.startsWith('.')) await readFile(resolve(root, 'src', target))
}
const engine = await import(pathToFileURL(packageRequire.resolve('@leolee9086/dsh-rule-engine')).href)
const { originalSessionBlocks, modelRequestBlocks, setRequestBlock } = await import(pathToFileURL(resolve(root, 'src/request-blocks.js')).href)
// Exercise the consumer's real traversal and patch path, including nested tool output.
const message = { id: 'm7', role: 'assistant', content: [
  { type: 'text', text: '  ORIGINAL\n' },
  { type: 'tool-result', callId: 'call-1', content: [{ type: 'text', text: 'nested original' }] },
] }
const event = { seq: 7, type: 'assistant/message', time: 1, data: { message } }
const session = { id: 'public-consumer', snapshotEvents: () => [event], surface: { nodes: [7] }, deriveEventMessage: () => message }
const [block] = originalSessionBlocks(session)
const request = { messages: [structuredClone(message)] }
const nested = modelRequestBlocks(session, request, 'request-1').find(block => block.text === 'nested original')
setRequestBlock(request, nested, { type: 'text', text: 'nested replacement' })
assert.equal(request.messages[0].content[1].content[0].text, 'nested replacement')
assert.equal(message.content[1].content[0].text, 'nested original')
assert.equal(block.text, '  ORIGINAL\n')
assert.throws(() => { block.raw.text = 'changed' }, TypeError)
const { createBoundedMatcher } = await import(pathToFileURL(resolve(root, 'src/bounded-matcher.js')).href)
const matcher = createBoundedMatcher()
try {
  const rule = engine.normalizeRuleV2({ schemaVersion: 2, sourceId: 'public-consumer', id: 'match', revision: 1,
    on: ['output.complete'], select: { view: 'original', roles: ['assistant'], blockTypes: ['text'] },
    match: { kind: 'regex', pattern: 'ORIGINAL' }, actions: [{ id: 'notice', kind: 'notify', stage: 'output.complete', enabledDefault: true, template: 'matched' }] })
  assert.equal((await matcher.detect({ stage: 'output.complete', rules: [rule], blocks: [{ ...block, view: 'original' }] })).length, 1)
} finally { await matcher.close() }
console.log(`Consumer ${manifest.name}@${manifest.version}: public entries, Client factory, nested request rewrite, raw blocks and matching worker passed`)
console.log(root)
