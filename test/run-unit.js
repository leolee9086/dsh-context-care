// Discover all unit suites so new v2 coverage cannot silently disappear from pnpm test.
// Shared-package checkouts are optional, explicit test-only inputs; installed packages remain the default.
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const directory = dirname(fileURLToPath(import.meta.url))
// Real Host suites require the source loader and are discovered by test:integration:source.
const suites = readdirSync(directory).filter(name => /\.test\.(?:js|ts)$/.test(name)
  && name !== 'integration.test.js' && !name.endsWith('-real.test.ts')).sort()
const result = spawnSync(process.execPath, ['--import', pathToFileURL(resolve(directory, 'shared-packages.js')).href, '--test', '--test-concurrency=2', ...suites.map(name => resolve(directory, name))],
  { cwd: resolve(directory, '..'), stdio: 'inherit', env: process.env })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
