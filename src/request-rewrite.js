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

/** Host 识别会话请求并提供改写证据与持久 ACK；规则准入、冷却、清理和提交归引擎。 */
export function createRequestRewriter(options) {
  const rewrite = createEngineRewriter({ ...options, blocksChanged: blocksChangedBetween })
  return async request => {
    // fetch-router 同时转发思源等普通 HTTP 请求；没有会话身份就没有可查询的会话规则与偏好。
    const sessionId = request.scope?.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    return rewrite(request)
  }
}
