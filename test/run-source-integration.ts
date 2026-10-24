import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

// A source Host is an explicit test input, never a runtime or install dependency.
const selectedCheckout = process.env.DSH_TEST_CHECKOUT
if (!selectedCheckout) throw new Error('test:integration:source requires DSH_TEST_CHECKOUT')
const checkout = resolve(selectedCheckout)
const directory = dirname(fileURLToPath(import.meta.url))
const hostRequire = createRequire(pathToFileURL(resolve(checkout, 'package.json')))
const hook = pathToFileURL(hostRequire.resolve('tsx/esm')).href

// These suites import real Host services. Keep discovery automatic: a newly
// added *-real.test.ts belongs here rather than in the installed-package runner.
const realSuites = readdirSync(directory).filter(name => name.endsWith('-real.test.ts')).sort()
if (realSuites.length === 0) throw new Error('source integration discovered no real Host suites')
const suites = ['integration.test.js', ...realSuites].map(name => resolve(directory, name))
console.log('Source integration suites:', ['integration.test.js', ...realSuites].join(', '))
const child = spawnSync(process.execPath, [
  '--import', hook,
  '--import', pathToFileURL(resolve(directory, 'shared-packages.js')).href,
  '--test', '--test-concurrency=1', ...process.argv.slice(2), ...suites,
], {
  cwd: resolve(directory, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    DSH_TEST_SOURCE: '1',
    TSX_TSCONFIG_PATH: resolve(checkout, 'tsconfig.base.json'),
    // The pressure fixture queues real filesystem I/O behind a real PBKDF2.
    // Set the pool size before Node starts; changing it inside a test is too late.
    UV_THREADPOOL_SIZE: '1',
  },
})
if (child.error) throw child.error
process.exitCode = child.status ?? 1
