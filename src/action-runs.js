import { createActionRuns as createEngineRuns, createExecutorRegistry as createEngineExecutors } from '@leolee9086/dsh-rule-engine'
import { createUserMessage } from './message.js'
import { recordSecondaryFailure } from './secondary-failure.js'


/** 原生工具接口继续通过 DSH tools 执行，保留其权限、沙箱和审批链。 */
export function createExecutorRegistry({ tools }) {
  return createEngineExecutors({
    available: toolName => tools.get(toolName) !== undefined,
    async execute({ agent, inputs, signal, runId, toolName }) {
      const result = await tools.execute({ callId: `context-care:${runId}`, name: toolName, arguments: inputs, agent, signal })
      if (result.isError) throw Object.assign(new Error(result.error?.message ?? result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')), { code: result.error?.code ?? 'EXECUTOR_FAILED' })
      return result
    },
    result: raw => ({ value: raw.value ?? null, content: raw.content }),
  })
}
/** 连接原生 Agent 操作；动作依赖、状态转换和队列由共享引擎执行。 */
export function createActionRuns({ approvalFor, ...options }) {
  return createEngineRuns({ ...options, secondaryFailure: recordSecondaryFailure, ports: {
    sessionId: agent => String(agent.session.id),
    approve(agent, request) {
      const approval = approvalFor(agent)
      if (!approval) throw new Error('approval-unavailable')
      return approval.request({ ...request, agent })
    },
    abort(agent, reason) { agent.cancel({ kind: 'hook', reason }, { keepInbox: true }) },
    resume(agent, text) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-context-care:workbench' } }))
    },
    deliver(agent, text) {
      agent.send(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-context-care:workbench' } }), 'next-step', false)
    },
  } })
}
