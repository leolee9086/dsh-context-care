import type { selectScopedPrompts } from '@leolee9086/dsh-rule-engine'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmFailure, LlmAttemptId, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { installContextCare } from './index.js'
import type { captureInputPricing } from './input-pricing.js'
import type { contextBudget } from './context-budget.js'
import type { openWorkbenchHost } from './workbench-host.js'

import type { openOutputFeedback } from './output-feedback.js'
import type { createSessionCompletions } from './session-completions.js'

// These are the plugin's operation state, derived from the actual owners. Host
// identities, requests, model metadata and streams retain their public types.
export type Pricing = ReturnType<typeof captureInputPricing>
export type Workbench = Awaited<ReturnType<typeof openWorkbenchHost>>
export type WorkbenchPlan = Awaited<ReturnType<Workbench['assemble']>>
export type PromptSegments = (ReturnType<typeof selectScopedPrompts>[number]
  | ReturnType<Awaited<ReturnType<typeof openOutputFeedback>>['collect']>[number]
  | ReturnType<ReturnType<typeof createSessionCompletions>['collect']>[number])[]
export type RequestOwner = NonNullable<ReturnType<typeof installContextCare>>['requestOwner'] & {
  dispatched?: (call: RequestCall) => void
}
export type ReadyRequest = {
  request: GenerateOptions
  model: Awaited<ReturnType<Context['llm']['resolveModelInfo']>>
  imageRequestPricing: ReturnType<Context['llm']['imageRequestPricing']>
}
export type RequestCall = {
  callId: string
  owner: RequestOwner
  agent: Agent
  session: Session
  logRevision: Session['seq']
  generation: Session['surface']['replaceGeneration']
  sourceSeqs: Session['surface']['nodes'][number][]
  sourceMessages: Readonly<ReturnType<Session['deriveMessages']>>
  original: GenerateOptions
  measurement: ReturnType<Pricing['measure']>
  dispatched: boolean
  attemptId?: LlmAttemptId
  settled?: boolean
  failure?: LlmFailure
  record?: Record<string, unknown>
  workbenchPlan?: WorkbenchPlan
  workbenchDecision?: Pick<WorkbenchPlan, 'records' | 'documents'> & { seq: number }
  promptDecision?: { seq: number; segments: PromptSegments; message: GenerateOptions['messages'][number] | undefined }
  ready?: ReadyRequest
  dispatchBudget?: ReturnType<typeof contextBudget>
  dispatchPricing?: Pricing
}
export type RequestIterator = AsyncIterator<StreamChunk>
