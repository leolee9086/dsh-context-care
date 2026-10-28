import { createNoticeRuleRuntime } from '@leolee9086/dsh-rule-engine'
import { createUserMessage } from './message.js'
import { producerKind } from './producer-source.js'
import { lastAssistantText, lastUserMessage, recentToolCalls, textOf } from './prompt-text.js'

export const CONSUMER_NAME = 'context-care'
export const RULES_SERVICE = 'memoryNoticeRules'

/** Host 读取当前轮的原生事实，并把库产生的通知呈现成原生消息。 */
export function installNoticeRules(ctx, { plugin, onHit = () => {}, rulesFor, history, engine }) {
  const runtime = createNoticeRuleRuntime({ engine, consumer: CONSUMER_NAME, source: RULES_SERVICE, onHit,
    rulesFor: (sessionId, evidence) => rulesFor?.(sessionId, evidence) ?? ctx.get(RULES_SERVICE),
    warn: message => typeof ctx.logger?.warn === 'function' ? ctx.logger.warn(message) : console.warn(message) })
  function collect({ agent, messages, facts }) {
    const message = lastUserMessage(messages)
    if (message === undefined) return []
    const text = textOf(message)
    if (text.length === 0) return []
    const { userEvent, assistantEvent } = history.withLive(agent.session, log => {
      const turn = log.last('turn/start')
      const events = log.select(['user/message'], turn?.seq ?? agent.session.inheritedEventCount)
      return { userEvent: message.id === undefined ? undefined : events.findLast(event => event.data.id === message.id), assistantEvent: log.last('assistant/message') }
    })
    const evidence = { inputMessageId: message.id, userText: text, facts, userSeq: userEvent?.seq, assistantSeq: assistantEvent?.seq,
      sourceSeqs: [userEvent?.seq, assistantEvent?.seq].filter(seq => seq !== undefined) }
    return runtime.collect({ key: String(agent.id), sessionId: agent.session?.id, text,
      assistantText: lastAssistantText(agent.session, history), toolCalls: recentToolCalls(agent.session, history), facts, evidence })
      .map(value => createUserMessage({ content: [{ type: 'text', text: value.text }],
        source: { kind: producerKind(`${plugin}:rules:${value.ruleId}`), form: 'notice', summary: `Notice rule: ${value.ruleId}`, contextCareTrace: value.trace } }))
  }
  return { collect }
}
