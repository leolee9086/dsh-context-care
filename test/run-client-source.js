import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

// Resolve test machinery from an explicitly supplied external Host, never install it.
if (!process.env.DSH_TEST_CHECKOUT) throw new Error('test:client:source requires DSH_TEST_CHECKOUT')
const checkout = resolve(process.env.DSH_TEST_CHECKOUT)
const hostRequire = createRequire(pathToFileURL(resolve(checkout, 'package.json')))
const cli = resolve(dirname(hostRequire.resolve('vitest/package.json')), 'vitest.mjs')
const child = spawnSync(process.execPath, [cli, 'run', '--config', 'test/client-source.config.mjs', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })
if (child.error) throw child.error
process.exitCode = child.status ?? 1
