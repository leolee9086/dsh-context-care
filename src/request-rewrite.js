import { createRequestRewriter as createEngineRewriter } from '@leolee9086/dsh-rule-engine'
import { changedBlocks } from './rewrite-journal.js'


/** 网络协议的块呈现证据：Chat/Messages 使用 messages，Responses 使用 input。 */
function blocksChangedBetween(before, after) {
  const messagesOf = text => {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
      if (Array.isArray(parsed.messages)) return parsed.messages
      return Array.isArray(parsed.input) ? parsed.input : undefined
    } catch { return undefined }
  }
  const beforeMessages = messagesOf(before), afterMessages = messagesOf(after)
  return beforeMessages === undefined || afterMessages === undefined ? [] : changedBlocks(beforeMessages, afterMessages)
}

/** Host 只提供改写证据与实际持久 ACK；规则准入、冷却、清理和提交归引擎。 */
export function createRequestRewriter(options) {
  return createEngineRewriter({ ...options, blocksChanged: blocksChangedBetween })
}
