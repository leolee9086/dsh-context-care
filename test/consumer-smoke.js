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
console.log(`Independently installed ${manifest.name}@${manifest.version}: public Host entries, declarations, Client factory and relative imports passed`)
console.log(root)
