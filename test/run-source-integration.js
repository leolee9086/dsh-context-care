import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

// An explicit external test Host supplies the checkout. Neither installation
// nor runtime imports locate a Harness implementation on the reader's machine.
if (!process.env.DSH_TEST_CHECKOUT) throw new Error('test:integration:source requires DSH_TEST_CHECKOUT')
const checkout = resolve(process.env.DSH_TEST_CHECKOUT)
const hostRequire = createRequire(pathToFileURL(resolve(checkout, 'package.json')))
const hook = pathToFileURL(hostRequire.resolve('tsx/esm')).href
const child = spawnSync(process.execPath, ['--import', hook, '--test', ...process.argv.slice(2), 'test/integration.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, DSH_TEST_SOURCE: '1', TSX_TSCONFIG_PATH: resolve(checkout, 'tsconfig.base.json') },
})
if (child.error) throw child.error
process.exitCode = child.status ?? 1
