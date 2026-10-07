import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'

if (!process.env.DSH_TEST_RUNTIME_ROOT) throw new Error('DSH_TEST_RUNTIME_ROOT is required')
const root = resolve(process.env.DSH_TEST_RUNTIME_ROOT)
const require = createRequire(pathToFileURL(resolve(root, 'package.json')))
const host = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const { default: Meter } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-token-meter')).href)
const { default: Llm } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
assert.equal(typeof Meter.prototype.measureInput, 'undefined')
assert.equal(typeof Meter.prototype.priceMessages, 'undefined')
assert.equal(typeof Meter.prototype.estimateMessage, 'function')
assert.equal(typeof Llm.prototype.prepareCall, 'function')
console.log(JSON.stringify({ version: host.version, electron: process.versions.electron, node: process.versions.node,
  measureInput: typeof Meter.prototype.measureInput, priceMessages: typeof Meter.prototype.priceMessages,
  estimateMessage: typeof Meter.prototype.estimateMessage, prepareCall: typeof Llm.prototype.prepareCall }, null, 2))
