import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { createCompletionFeedback, type CompletionFact, type CompletionFactRead, type CompletionFeedbackOptions } from '@leolee9086/dsh-rule-engine'
import { requestDecision } from './request-replay.js'
import { completionNoticeText } from '../src/completion-copy.js'
import type { SessionLog } from './session-log.js'

interface Options extends Omit<CompletionFeedbackOptions<Session>, 'cache' | 'facts' | 'render' | 'sessions'> {
  logs: SessionLog
  sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>
}
function receivedOutput(stream: readonly AssistantStreamRecord[]) {
  return stream.some(record => record.type !== 'chunk' || record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop')
}
/** 原生类型与消息块转换；完成措辞解析及所有状态转换由库处理。 */
function nativeFact(event: SessionEvent): CompletionFact {
  if (event.type === 'request/header') {
    const prompt = requestDecision(event)?.prompt
    return { type: event.type, seq: event.seq, route: event.data.header?.config, ...(prompt ? { prompt } : {}) }
  }
  if (event.type === 'step/start') return { type: event.type, seq: event.seq }
  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    return { type: event.type, seq: event.seq, time: event.time,
      completed: event.type === 'assistant/message' && !event.data.interrupted,
      // 与旧路径一样，只有库需要判断未完成回执时才读取原生流记录。
      get received() { return receivedOutput(event.data.stream) },
      text: { *[Symbol.iterator]() {
        if (event.type === 'assistant/message') for (const block of event.data.message.content) if (block.type === 'text') yield block.text
      } } }
  }
  throw new Error('context-care: unrelated completion fact')
}
/** Host 持有 Session 身份、只读切面和共享缓存；库持有候选、冷却、预约与回执。 */
export function createSessionCompletions(options: Options) {
  return createCompletionFeedback({ ...options, cache: options.logs.cache, render: completionNoticeText,
    sessions: { get: id => options.sessions.get(id as Session['id']), list: () => options.sessions.list(), flush: session => options.sessions.flush(session) },
    facts(session, fromSeq): CompletionFactRead {
      const log = options.logs.live(session)
      return { length: log.length, [Symbol.dispose]: () => log[Symbol.dispose](),
        *[Symbol.iterator]() {
          for (const event of log.select(['request/header', 'step/start', 'assistant/message', 'assistant/attempt'], fromSeq)) yield nativeFact(event)
        },
      }
    },
  })
}
