import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import * as plugin from '../src/index.js'

// This explicitly selected test acts as an external Host. The plugin itself never
// locates or imports a Harness checkout, and the default test suite is standalone.
if (!process.env.DSH_TEST_CHECKOUT) throw new Error('test:integration requires DSH_TEST_CHECKOUT pointing to a built Harness checkout')
const checkout = resolve(process.env.DSH_TEST_CHECKOUT)
const load = async path => import(pathToFileURL(resolve(checkout, path)).href)
const { Context } = await load('vendor/cordis/lib/index.js')
const { LlmAdapter, createUserMessage } = await load('packages/llm/llm/lib/index.js')
const { default: Loader } = await load('vendor/loader/lib/index.js')
const { default: Include } = await load('vendor/include/lib/index.js')
const paths = {
  llm: 'llm/llm', session: 'core/session', 'session-projection': 'session/session-projection',
  'system-prompt': 'core/system-prompt', tools: 'core/tools', agent: 'core/agent',
  'agent-loop': 'core/agent-loop', 'token-meter': 'llm/token-meter', 'compaction-basic': 'compaction/compaction-basic',
}
const modules = new Map(await Promise.all(Object.entries(paths).map(async ([name, path]) => [
  `@deepseek-ai/dsh-${name}`, (await load(`packages/${path}/lib/index.js`)).default,
])))
modules.set('dsh-context-care', plugin)

class ScriptedAdapter extends LlmAdapter {
  requests = []
  calls = 0
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 100000 } } }
  async *stream(options) {
    this.requests.push(options)
    let block
    if (options.purpose === 'compaction') {
      block = { type: 'text', text: 'Verified earlier progress. Continue the pending task.' }
    } else {
      this.calls++
      if (this.calls === 1 || this.calls === 2) block = { type: 'text', text: `Answer ${this.calls}.` }
      // 交接笔记的默认下限是 1000 字（宜细不宜粗），这里凑够。
      else if (this.calls === 3) block = { type: 'tool-call', id: 'rest-one', name: 'context_rest', arguments: JSON.stringify({ note: 'Verify output and finish the requested task.'.padEnd(1200, '…') }) }
      else block = { type: 'text', text: 'Continued after context care.' }
    }
    yield { type: 'block-start', index: 0, blockType: block.type }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
  }
}

async function boot() {
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier) {
    if (!modules.has(specifier)) throw new Error(`Unknown fixture module ${specifier}`)
    return modules.get(specifier)
  } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: new URL('./fixtures/cordis.yml', import.meta.url).href } })
  await ctx.loader.await()
  assert.deepEqual([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled).map(entry => entry.options.name), [])
  return ctx
}

test('real Loader/loop preserves request prefix and compacts after tool result, then continues', async t => {
  const ctx = await boot(); t.after(() => ctx.fiber.dispose())
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['care-test'], adapter)
  const agent = await ctx.agentLoop.create('care-integration', { provider: 'care-test', model: 'care-test' })
  const turn = async text => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  await turn('Earlier verified work. '.repeat(1200))
  await turn('Continue the next work unit. '.repeat(100))
  assert.equal(adapter.calls, 2)
  const first = adapter.requests[0]
  const second = adapter.requests[1]
  assert.equal(first.system, second.system)
  assert.doesNotMatch(first.system ?? '', /Fatigue:|wakefulness:/)
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages)
  for (const request of [first, second]) {
    for (const message of request.messages) {
      if (message.content.some(block => block.type === 'text' && block.text.includes('<context-care>'))) assert.equal(message.role, 'user')
    }
  }
  await turn('Checkpoint now, then continue working.')
  const events = agent.session.snapshotEvents()
  const summaries = events.filter(event => event.type === 'compaction/summary')
  assert.equal(summaries.length, 1, `Expected one committed compaction; events: ${events.map(e => e.type).join(', ')}`)
  const result = events.find(event => event.type === 'tool/result')
  const start = events.find(event => event.type === 'compaction/start')
  assert.ok(result.seq < start.seq)
  const statuses = events.filter(event => event.type === 'user/message' && event.data.source.plugin === 'dsh-context-care:state')
  assert.match(statuses.at(-1).data.content[0].text, /completed: older history summarized/)
  assert.equal(adapter.calls, 4)
  const final = adapter.requests.at(-1)
  assert.ok(final.messages.some(message => message.content.some(block => block.text?.includes('Verify output and finish'))))
  const ui = ctx.sessionProjections.stateOf(agent.session, 'contextCareNumeric')
   assert.equal(typeof ui.fatigueValue, 'number')
   assert.equal(typeof ui.wakefulnessValue, 'number')
   assert.equal(ui.fatigueValue, statuses.at(-1).data.source.contextCare.fatigueValue)
   // Numeric provenance is persisted, but never inserted into model text.
   assert.ok(final.messages.every(message => message.content.every(block => !block.text?.includes('fatigueValue'))))
  assert.equal(ui.sampledSeq, statuses.at(-1).seq)
  const projection = (await import('../src/projection.js')).contextCareProjection
  assert.deepEqual(events.reduce((state, event) => projection.apply(state, event), projection.init()), ui)
  const observed = statuses.map(event => event.data.content[0].text)
  const expected = JSON.parse(await readFile(new URL('./fixtures/statuses.json', import.meta.url), 'utf8'))
  assert.deepEqual(observed, expected)
})
