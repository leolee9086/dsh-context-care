import test, { type TestContext } from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import type { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'

type Runtime = ReturnType<typeof createReminderRuntime>
interface ToolCall { name: string; id: string }
interface LoggedEvent { type: string; data: unknown }
interface OwnedHost {
  ctx: Context
  runtime: Runtime
  turn(calls: ToolCall[]): Promise<readonly LoggedEvent[]>
}
interface Harness { open(t: TestContext, ruleTimeoutMs: number): Promise<OwnedHost> }
const ruleTimeoutMs = 250
const formerTicketTtlMs = ruleTimeoutMs * 4
const blockedReason = 'DENIAL_LIFETIME_BLOCKED'
const LoggedResult = z.object({ message: z.object({ source: z.object({ callId: z.string() }),
  isError: z.boolean().optional(), content: z.array(z.object({ text: z.string().optional() }).passthrough()) }) })
const notice = (on: 'tool.succeeded' | 'tool.before-execute') => eventRule(on, { event: { tool: 'lifetime_probe' } }, { template: 'DENIAL_LIFETIME_NOTICE' })
const denial = (tool: string) => eventRule('tool.before-execute', { id: 'deny', event: { tool } }, { template: blockedReason, deny: { dangerous: true, reason: blockedReason } })

/** A real Loader provides the pre-execute hook, synchronous guard, worker and durable storage. */
export function registerDenialLifetimeHostCases(harness: Harness): void {
  for (const scenario of ['empty-delay', 'remind-delay', 'unmatched-denial-delay', 'matched-denial-delay',
    'unrelated-refresh', 'denial-added'] as const) {
    test(`real reminder ticket lifetime: ${scenario}`, { timeout: 30000 }, async t => {
      const { ctx, runtime, turn } = await harness.open(t, ruleTimeoutMs)
      const rules = scenario === 'remind-delay' ? [notice('tool.before-execute')]
        : scenario === 'unmatched-denial-delay' || scenario === 'unrelated-refresh' ? [denial('other_tool')]
          : scenario === 'matched-denial-delay' ? [denial('lifetime_probe')] : []
      runtime.registerSource({ sourceId: 'lifetime-policy', plugin: 'test', revision: 1, rules })
      const unrelated = runtime.registerSource({ sourceId: 'unrelated-notice', plugin: 'test', revision: 1,
        rules: [notice('tool.succeeded')] })
      const executed: string[] = []
      ctx.effect(() => ctx.tools.register({ name: 'lifetime_probe', description: 'Record whether the guarded tool body ran',
        parameters: { type: 'object' }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: z.string().parse(value) }] },
        async execute() { executed.push('lifetime_probe'); return 'LIFETIME_BODY_RAN' } }))
      let observedPreparation = false
      let elapsedMs = 0
      ctx.on('tools/pre-execute', async (exec, next) => {
        if (exec.name !== 'lifetime_probe') return next()
        // Registered after the real reminder hook: policy has completed, but the
        // registry has not reached its guard yet. Waiting here is ordinary hook work.
        const initial = runtime.decideToolExecution(exec.token)
        assert.deepEqual(initial, scenario === 'matched-denial-delay'
          ? { kind: 'deny', reason: blockedReason } : { kind: 'allow' })
        observedPreparation = true
        if (scenario.endsWith('-delay')) {
          const began = performance.now()
          await delay(formerTicketTtlMs + 100, undefined, { signal: exec.signal })
          elapsedMs = performance.now() - began
          assert.ok(elapsedMs > formerTicketTtlMs)
        } else if (scenario === 'unrelated-refresh') {
          unrelated.replace({ sourceId: 'unrelated-notice', plugin: 'test', revision: 2,
            rules: [eventRule('tool.succeeded', { event: { tool: 'lifetime_probe' } }, { template: 'REFRESHED_NOTICE' })] })
        } else {
          // A newly introduced deny-tool rule really changes authorization.
          runtime.registerSource({ sourceId: 'new-denial', plugin: 'test', revision: 1,
            rules: [denial('lifetime_probe')] })
        }
        return next()
      })
      const events = await turn([{ name: 'lifetime_probe', id: scenario }])
      const results = events.filter(event => event.type === 'tool/result').map(event => LoggedResult.parse(event.data))
      const result = results.find(item => item.message.source.callId === scenario)
      assert.ok(result !== undefined, 'the actual agent log must contain this tool result')
      const text = result.message.content.map(block => block.text ?? '').join('')
      t.diagnostic(JSON.stringify({ scenario, elapsedMs, executed, isError: result.message.isError ?? false, text }))
      assert.equal(observedPreparation, true)
      if (scenario === 'matched-denial-delay' || scenario === 'denial-added') {
        assert.deepEqual(executed, [])
        assert.equal(result.message.isError, true)
        assert.match(text, scenario === 'denial-added' ? /提醒策略已变更/ : /DENIAL_LIFETIME_BLOCKED/)
      } else {
        assert.deepEqual(executed, ['lifetime_probe'], 'completed unchanged policy must not manufacture a tool denial')
        assert.notEqual(result.message.isError, true)
        assert.match(text, /LIFETIME_BODY_RAN/)
      }
      assert.doesNotMatch(text, /提醒策略评估已过期/)
    })
  }
}
