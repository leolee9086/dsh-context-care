import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

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

// Pin copied bytes, including the distinct upstream licenses. No checkout alias
// can replace the modules being validated by the standalone release tests.
test('fixed upstream modules retain their recorded SHA-256', async () => {
  const provenance = JSON.parse(await readFile(new URL('../src/vendor/provenance.json', import.meta.url), 'utf8'))
  for (const [directory, upstream] of Object.entries(provenance)) {
    assert.match(upstream.commit, /^[a-f0-9]{40}$/)
    for (const [file, expected] of Object.entries(upstream.sha256)) {
      const bytes = await readFile(new URL(`../src/vendor/${directory}/${file}`, import.meta.url))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${directory}/${file}`)
    }
  }
})
