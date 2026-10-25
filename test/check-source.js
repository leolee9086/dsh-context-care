// Check every shipped source file, including worker and display entry points.
import { readdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceFiles = readdirSync(resolve(root, 'src'), { recursive: true }).filter(name => /\.(?:js|ts)$/.test(name)).sort()
const deprecatedSnapshot = /\bsnapshotEvents\b/
// Test-only assertions may inspect native emitted events; shipped readers cannot.
assert.equal(deprecatedSnapshot.test('session.snapshotEvents()'), true)
assert.equal(deprecatedSnapshot.test("session['snapshotEvents']()"), true)
assert.equal(deprecatedSnapshot.test('await history.all()'), false)
const directNativeRead = /\b(?:eventAt|deriveMessages|deriveEventMessage|toolHistory)\s*(?:\(|['"]\s*\]\s*\()/
for (const file of sourceFiles) {
  const source = readFileSync(resolve(root, 'src', file), 'utf8')
  if (deprecatedSnapshot.test(source)) throw new Error(`Deprecated Session snapshot reader in src/${file}`)
  // Native event access and interpretation have one Host owner; consumers use
  // shared indexes and content-version projections rather than private readers.
  if (file !== 'session-log.ts' && directNativeRead.test(source)) {
    throw new Error(`SessionLog bypass in src/${file}`)
  }
}
const files = sourceFiles.filter(name => name.endsWith('.js'))
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, 'src', file)], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
}
if (!process.exitCode) console.log(`Syntax checked ${files.length} source files.`)
