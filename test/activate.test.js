import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/activate.js'

async function activate() {
  let listener
  let disposed = false
  let cleanup
  let totalTokens = 4000
  const events = []
  const agent = {
    ctx: { async plugin(definition) {
      definition.apply({
        on(_event, callback) { listener = callback },
        llm: { async resolveModelInfo() { return { context: { contextWindow: 10000 } } } },
        tokenMeter: { measure: () => ({ totalTokens, surfaceTokens: 1000 }), estimateMessage: () => 0 },
      })
      return { dispose() { disposed = true } }
    } },
    session: { surface: { nodes: [] }, eventAt: seq => events[seq], requestHeader: () => ({ config: { provider: 'test', model: 'test' } }) },
  }
  await apply({ agents: { get: () => agent }, tools: { get: () => ({}) }, effect(register) { cleanup = register() } }, { sessionId: 'current' })
  return {
    run: decision => listener({ agent, signal: new AbortController().signal }, async () => decision),
    retain(message) { agent.session.surface.nodes.push(events.length); events.push({ type: 'user/message', data: message }) },
    setTokens(value) { totalTokens = value },
    dispose: () => { cleanup(); return disposed },
  }
}

test('existing-session numeric upgrade preserves outcomes, admission fields and cleanup', async () => {
  const active = await activate()
  const message = { content: [{ type: 'text', text: 'Rest outcome: failed; history retained.' }], source: { kind: 'plugin', plugin: 'dsh-context-care:state', form: 'notice', summary: 'Context state' } }
  const result = await active.run({ kind: 'enter', startsRequestSeries: true, messages: [message] })
  assert.equal(result.startsRequestSeries, true)
  assert.deepEqual(result.messages[0].content, message.content)
  assert.deepEqual(result.messages[0].source.contextCare, { fatigueValue: 35.4, wakefulnessValue: 54.8 })
  assert.equal(message.source.contextCare, undefined)
  const alreadyNumeric = await active.run(result)
  assert.equal(alreadyNumeric, result)
  assert.equal(active.dispose(), true)
})

test('numeric-only changes do not notify until the model-visible grade changes', async () => {
  const active = await activate()
  const first = await active.run({ kind: 'enter', messages: [] })
  active.retain(first.messages[0])
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)
  active.setTokens(4030) // The measured value changes, but the model-visible grade is unchanged.
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)
  active.setTokens(4060)
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)

  active.setTokens(6000) // Cross the fatigue grade boundary; this changes the guidance.
  const changed = await active.run({ kind: 'enter', messages: [] })
  assert.equal(changed.messages.length, 1)
  assert.match(changed.messages[0].content[0].text, /疲劳：高；唤醒值：正常/)
  active.retain(changed.messages[0])
  assert.equal((await active.run({ kind: 'enter', messages: [] })).messages.length, 0)
  active.dispose()
})

test('existing-session numeric upgrade samples when old grade is unchanged and respects rejection', async () => {
  const active = await activate()
  const rejected = { kind: 'reject', messages: [] }
  assert.equal(await active.run(rejected), rejected)
  const result = await active.run({ kind: 'enter', messages: [] })
  assert.equal(result.messages[0].role, 'user')
  assert.equal(result.messages[0].source.contextCare.fatigueValue, 35.4)
  assert.match(result.messages[0].content[0].text, /疲劳：升高；唤醒值：正常/)
  assert.doesNotMatch(result.messages[0].content[0].text, /35.4|54.8|%/)
  active.dispose()
})
