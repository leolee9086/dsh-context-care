import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import ts from 'typescript'

// Public development packages check Host contracts. Installed runtime code must
// still obtain those services through Cordis, without loading another Host.
test('runtime stays independent from DSH implementation and local checkouts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      if (group !== 'devDependencies') assert.doesNotMatch(name, /^@deepseek-ai\/dsh(?:-|$)/)
      assert.doesNotMatch(version, /^(?:link|file|workspace):|^(?:[A-Za-z]:[\\/]|\/)|deepseek-harness/)
    }
  }
  for (const directory of ['src', 'lib']) {
    for (const entry of await readdir(new URL(`../${directory}/`, import.meta.url), { recursive: true })) {
      if (!/\.(?:[cm]?js|tsx?)$/.test(entry) || entry.endsWith('.d.ts')) continue
      const source = await readFile(new URL(`../${directory}/${entry.replaceAll('\\', '/')}`, import.meta.url), 'utf8')
      assert.doesNotMatch(source, /deepseek-harness|DSH_TEST_CHECKOUT/, entry)
      // Erase type-only imports and JSDoc exactly as compilation does, then
      // inspect executable code, including dynamic imports in nested modules.
      const runtime = ts.transpileModule(source, { fileName: entry, compilerOptions: {
        target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
      } }).outputText
      assert.doesNotMatch(runtime, /@deepseek-ai\/dsh(?:-|[/'"])/, entry)
    }
  }
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.doesNotMatch(lock, /(?:link:|file:).*deepseek-harness/)
})

// Git packages with these lifecycle hooks require build approval in pnpm 12.
// Consumers receive committed artifacts; only the author runs release:pack.
test('release has no install-time preparation or exotic dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
    assert.equal(manifest.scripts?.[hook], undefined, hook)
  }
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const version of Object.values(manifest[group] ?? {})) {
      assert.doesNotMatch(version, /^(?:github:|git(?:\+|:)|https?:|link:|file:)/)
    }
  }
  assert.match(manifest.scripts['release:pack'], /pnpm release:check && pnpm pack/)
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.doesNotMatch(lock, /gitHosted:|codeload\.github\.com/)
})
