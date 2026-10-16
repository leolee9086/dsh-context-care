// The published JS engine has no declaration files. Describe only the validated
// normalization entry used here; external optional conditions are JSON inputs.
declare module '@leolee9086/dsh-rule-engine' {
  import type { z } from 'zod'
  type JsonValue = z.infer<ReturnType<typeof z.json>>
  export function normalizeRuleV2(input: {
    schemaVersion: 2
    sourceId: string
    id: string
    revision: number
    on: ['tool.result']
    select: { view: 'original'; roles: ['tool']; blockTypes: ['tool-result'] }
    match: { kind: 'all'; conditions: JsonValue[] }
    priority: number
    actions: { id: string; kind: 'notify'; stage: 'tool.result'; enabledDefault: boolean; template: string }[]
  }): { match: JsonValue }
}
