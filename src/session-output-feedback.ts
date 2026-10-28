import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { createOutputFeedback, type OutputFeedbackFact, type OutputFeedbackFactRead,
  type OutputFeedbackBounds, type OutputFeedbackMetrics, type OutputFeedbackOptions } from '@leolee9086/dsh-rule-engine'
import { requestDecision } from './request-replay.js'
import type { SessionLog } from './session-log.js'

interface Options<D, M> extends Omit<OutputFeedbackOptions<Session, D, M>, 'sessions' | 'cache' | 'facts'> {
  sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>
  logs: SessionLog
}
function receivedOutput(stream: readonly AssistantStreamRecord[]) {
  return stream.some(record => record.type !== 'chunk' || record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop')
}
function nativeFact(event: SessionEvent): OutputFeedbackFact {
  if (event.type === 'request/header') {
    const prompt = requestDecision(event)?.prompt
    return { type: event.type, seq: event.seq, route: event.data.header?.config, ...(prompt ? { prompt } : {}) }
  }
  if (event.type === 'step/start') return { type: event.type, seq: event.seq }
  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    return { type: event.type, seq: event.seq, completed: event.type === 'assistant/message' && !event.data.interrupted,
      received: receivedOutput(event.data.stream),
      text: event.type === 'assistant/message' ? event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n') : '' }
  }
  throw new Error('context-care: unrelated output-feedback fact')
}

/** Host 只提供带释放边界的原生增量读取；反馈触发、时钟、预约和回执由库实现。 */
export function createSessionOutputFeedback<D extends OutputFeedbackBounds, M extends OutputFeedbackMetrics>(options: Options<D, M>) {
  return createOutputFeedback({ ...options, cache: options.logs.cache,
    sessions: { get: id => options.sessions.get(id as Session['id']), list: () => options.sessions.list(), flush: session => options.sessions.flush(session) },
    facts(session, fromSeq): OutputFeedbackFactRead {
      const log = options.logs.live(session)
      return { length: log.length, [Symbol.dispose]: () => log[Symbol.dispose](),
        *[Symbol.iterator]() {
          for (const event of log.select(['request/header', 'step/start', 'assistant/message', 'assistant/attempt'], fromSeq)) yield nativeFact(event)
        },
      }
    },
  })
}
