import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// Keep the plugin install independent from the Host; composition names are service
// wiring metadata, not npm dependencies or module imports.
test('manifest and runtime source have no DSH dependency or checkout path', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      assert.doesNotMatch(name, /^@deepseek-ai\/dsh(?:-|$)/)
      assert.doesNotMatch(version, /^(?:link|file):|deepseek-harness/)
    }
  }
  for (const entry of await readdir(new URL('../src/', import.meta.url))) {
    if (!entry.endsWith('.js')) continue
    const source = await readFile(new URL(`../src/${entry}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /@deepseek-ai\/dsh|deepseek-harness|DSH_TEST_CHECKOUT/, entry)
  }
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.doesNotMatch(lock, /@deepseek-ai\/dsh|link:.*deepseek-harness/)
})
