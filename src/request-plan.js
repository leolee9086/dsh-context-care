import { setRequestBlock, requestImpact, indexRequestPairs, planRequest, planRequestAsync } from '@leolee9086/dsh-rule-engine'

import { createHash } from 'node:crypto'




/** DSH 请求适配：提供原生正文写入、公开计量和插件来源消息。 */
function nativePlanInput({ estimateMessage = undefined, ...input }) {
  const prepared = { ...input, ports: {
    writeBlock: setRequestBlock,
    impact: requestImpact,
    pairs: indexRequestPairs,
    estimateMessage,
    insertionMessage(insertion) {
      const id = createHash('sha256').update(JSON.stringify([insertion.key, insertion.at, insertion.origin, insertion.event.block.path,
        insertion.event.ranges, insertion.text])).digest('hex')
      return { id: `context-care:${id}`, role: insertion.role, content: [{ type: 'text', text: insertion.text }],
        source: { kind: 'plugin:dsh-context-care:workbench', contextCareWorkbench: { sourceId: insertion.event.sourceId,
          ruleId: insertion.event.ruleId, actionId: insertion.action.id } } }
    },
  } }
  return prepared
}
export function planRequestV2(input) { return planRequest(nativePlanInput(input)) }
export function planRequestV2Async({ executeText, signal, ...input }) { return planRequestAsync(nativePlanInput(input), executeText, signal) }
