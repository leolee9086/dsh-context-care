import type { createReminderRuntime } from './reminder-runtime/runtime.js'
import type { openRequestHost } from './request-host.js'
import type { openCompletionHost } from './completion-host.js'
import type { openRuleControls } from './rule-controls.js'
import type { openWorkbenchHost } from './workbench-host.js'
import type {} from '@deepseek-ai/cordis'
import type { createCareChanges } from './care-changes.js'

// Plugin-owned services derive from their implementations; DSH services retain
// the declarations supplied by their own packages.
declare module '@deepseek-ai/cordis' {
  interface Context {
    contextCareChanges: ReturnType<typeof createCareChanges>
    reminderRules: ReturnType<typeof createReminderRuntime>
    contextCareRequests: Awaited<ReturnType<typeof openRequestHost>>
    contextCareCompletion: Awaited<ReturnType<typeof openCompletionHost>>
    contextCareControls: Awaited<ReturnType<typeof openRuleControls>>
    contextCareWorkbench: Awaited<ReturnType<typeof openWorkbenchHost>>
  }
}
