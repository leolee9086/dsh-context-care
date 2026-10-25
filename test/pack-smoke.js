import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, symlink } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Inspect the closed publication payload, not the source working tree's imports.
const archive = process.argv[2]
if (!archive) throw new Error('Pass the packed tgz path')
const cache = resolve('node_modules/.cache/context-care-pack')
await mkdir(cache, { recursive: true })
const root = await mkdtemp(join(cache, 'smoke-'))
const extracted = spawnSync('tar', ['-xzf', resolve(archive), '-C', root], { stdio: 'inherit' })
if (extracted.error) throw extracted.error
assert.equal(extracted.status, 0)
const pkgRoot = join(root, 'package')
await symlink(resolve('node_modules'), join(pkgRoot, 'node_modules'), 'junction')
const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'))
const expected = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
assert.equal(pkg.name, expected.name)
assert.equal(pkg.version, expected.version)
assert.equal(pkg.type, 'module')
assert.notEqual(pkg.private, true, 'The delivered package must not carry an invented publication prohibition')
for (const name of Object.keys(pkg.dependencies ?? {})) assert.ok(!name.startsWith('@deepseek-ai/dsh-'), name)
for (const [name, target] of Object.entries(pkg.exports)) {
  if (name === './client' || name === './package.json') continue
  const entryPath = typeof target === 'string' ? target : target.default
  const entry = await import(pathToFileURL(join(pkgRoot, entryPath)).href)
  if (name === './reminders') assert.equal(typeof entry.createReminderRuntime, 'function', name)
  else if (name === './declarations') assert.equal(typeof entry.validateDocument, 'function', name)
  else assert.equal(typeof entry.apply, 'function', name)
}
const require = createRequire(import.meta.url)
let client
runInNewContext(await readFile(join(pkgRoot, pkg.exports['./client']), 'utf8'), {
  window: { __ModuleLoader__: { load(row) {
    assert.equal(row.id, pkg.name)
    client = row.factory(name => { assert.equal(name, 'react'); return require(name) })
  } } }, fetch, setInterval, clearInterval, AbortController,
})
assert.equal(typeof client.apply, 'function')
assert.deepEqual([...client.inject], ['slots', 'locale', 'uiConversation', 'sessions', 'sidebarRightTabs', 'sidebarRight', 'layout'])
async function checkImports(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, file.name)
    if (file.isDirectory()) await checkImports(path)
    else if (file.name.endsWith('.js')) {
      // JSDoc @import is compile-time only. Match the source dependency gate
      // by inspecting executable code, not comment text.
      const source = ts.transpileModule(await readFile(path, 'utf8'), { fileName: file.name, compilerOptions: {
        target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
      } }).outputText
      for (const [, target] of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
        assert.ok(!target.startsWith('@deepseek-ai/dsh-'), `${file.name}: ${target}`)
        if (target.startsWith('.')) await readFile(resolve(dirname(path), target))
      }
    }
  }
}
await checkImports(join(pkgRoot, 'src'))
await checkImports(join(pkgRoot, 'lib'))
console.log(`Packed ${pkg.name}@${pkg.version}: ESM entries, client module factory and source/built relative imports verified`)
console.log(`Extracted payload: ${pkgRoot}`)
