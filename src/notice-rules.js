// src/notice-rules.js — 把索引插件声明的提示规则接进规则引擎,命中后注入提醒。
//
// 分工(2026-09-22 与哥哥定的):
//   · 索引插件只给规则:ctx.provide 一个纯数据数组,它不知道谁在读,也不判断谁该提示;
//   · 本插件负责判断和发起:取规则、跑引擎、命中就注入。
//
// 这里只管 notify。transform(篡改上下文)是另一条路 —— 它要经过请求层,
// 由提供 requestRewrite 服务的插件执行,本插件只做裁决。
//
// 判的 surface 是「用户刚说了什么」(placement: user);
// when.produced 和 when.idle 要的助手输出与工具调用历史,从会话事件里取(见 prompt-text.js)。

import { randomUUID } from 'node:crypto'
import { createEngine } from './vendor/rule-engine/index.js'
import { createUserMessage } from './message.js'
import { producerKind } from './producer-source.js'
import { lastAssistantText, lastUserMessage, recentToolCalls, textOf } from './prompt-text.js'

/** 规则里写 action.by: 'context-care' 就落到这里。 */
export const CONSUMER_NAME = 'context-care'

/** 提示规则服务名。取不到就是没装索引插件 —— 正常情况,不是错误。 */
export const RULES_SERVICE = 'memoryNoticeRules'

/**
 * 装提示规则。
 *
 * @param {object} ctx 插件上下文。
 * @param {object} options
 * @param {string} options.plugin 本插件名,用来拼 notice 的 source.plugin。
 * @param {(record: object, where: {sessionId: string|undefined}) => void} [options.onHit] 每条命中的回调。
 * @returns {{collect: (input: {agent: object, messages: object[]}) => object[]}}
 */
export function installNoticeRules(ctx, { plugin, onHit = () => {}, rulesFor }) {
  /** 每个会话一个引擎:冷却和 surface 去重都是按会话算的。 */
  const engines = new Map()
  /**
   * 这一轮 run 期间消费者收到的动作往哪放。
   * run 是同步的,中间插不进别的会话,所以一个变量就够,不用按会话分。
   */
  let sink = null
  let hitSink = null
  let runEvidence = null

  function warn(message) {
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
    else console.warn(message)
  }

  function engineFor(agent) {
    const key = String(agent.id)
    const existing = engines.get(key)
    if (existing !== undefined) return existing
    const engine = createEngine({
      // 每次命中都留一条记录。规则命中和提醒注入都是对上下文的介入,
      // 不记下来就没人知道模型为什么突然收到那句话。
      onRecord(record) {
        // The same stable identity is persisted and attached to the resulting prompt; never join by time.
        const captured = { ...record, evaluationId: randomUUID(), ...runEvidence,
          rule: (rulesFor?.(agent.session?.id, runEvidence) ?? ctx.get(RULES_SERVICE))?.find(rule => rule.id === record.ruleId) }
        onHit(captured, { sessionId: agent.session?.id })
        hitSink?.push(captured)
        if (record.outcome === 'applied') return
        warn(`context-care: 提示规则 ${record.ruleId} 未生效(${record.outcome})${record.detail === undefined ? '' : ': ' + record.detail}`)
      },
    })
    engine.registerConsumer({
      name: CONSUMER_NAME,
      kinds: ['notify'],
      handle(payload) {
        if (sink === null) throw new Error('context-care: 提示规则在收集窗口之外被消费')
        sink.push(payload)
      },
    })
    // 规则来源:索引插件声明的提示规则。取不到就是没有规则,不是错误。
    engine.provideRules(RULES_SERVICE, () => {
      const rules = rulesFor?.(agent.session?.id, runEvidence) ?? ctx.get(RULES_SERVICE)
      return rules === undefined || rules === null ? [] : rules
    })
    engines.set(key, engine)
    return engine
  }

  /** 把一条命中变成要注入的消息。规则没说清楚要提醒什么,就是规则写错了。 */
  function render(payload, trace) {
    const say = payload.action?.say
    if (typeof say !== 'string' || say.length === 0) {
      throw new Error(`context-care: 提示规则 "${payload.ruleId}" 没有 action.say,不知道该提醒什么`)
    }
    return createUserMessage({
      content: [{ type: 'text', text: say }],
      source: {
        kind: producerKind(`${plugin}:rules:${payload.ruleId}`),
        form: 'notice',
        summary: `Notice rule: ${payload.ruleId}`,
        contextCareTrace: trace,
      },
    })
  }

  /**
   * 跑一轮提示规则,返回这一轮该注入的消息(可能为空)。
   *
   * @param {object} input
   * @param {object} input.agent 当前 agent。
   * @param {object[]} input.messages 这一轮组装好、准备发出去的消息。
   * @param {object} [input.facts] 这一轮的事实值（疲劳度、唤醒值、token 量…），键名就是规则里写的指标名。
   *   值算不出来时给 null（表示"此刻不可知"，规则会判为不命中），
   *   **不要给 undefined 或干脆不给键** —— 那会被引擎当成"规则写错或漏填"而抛错。
   * @returns {object[]} 要注入的消息。
   */
  function collect({ agent, messages, facts }) {
    const message = lastUserMessage(messages)
    if (message === undefined) return []
    const text = textOf(message)
    if (text.length === 0) return []
    const engine = engineFor(agent)
    const collected = []
    const hits = []
    const events = agent.session?.snapshotEvents?.() ?? []
    const userEvent = message.id === undefined ? undefined : events.findLast(event => event.type === 'user/message' && event.data.id === message.id)
    const assistantEvent = events.findLast(event => event.type === 'assistant/message')
    runEvidence = { inputMessageId: message.id, userText: text, facts, userSeq: userEvent?.seq, assistantSeq: assistantEvent?.seq, sourceSeqs: [userEvent?.seq, assistantEvent?.seq].filter(seq => seq !== undefined) }
    hitSink = hits
    sink = collected
    try {
      // 助手输出和工具调用历史都从会话里取 —— 规则里的 when.produced / when.idle 靠它们。
      engine.run({
        surface: { placement: 'user', text },
        ctx: {
          userText: text,
          assistantText: lastAssistantText(agent.session),
          toolCalls: recentToolCalls(agent.session),
          now: Date.now(),
          // 事实值放到最后展开：它们只有算得出来的那一侧（本插件的 pre-step）知道，
          // 而引擎不认识这些指标名 —— 它只按 key 取值比较。约定好的键写在本插件的文档里。
          ...(facts ?? {}),
        },
      })
    } finally {
      sink = null
      hitSink = null
      runEvidence = null
    }
    return collected.map(payload => {
      const evaluation = hits.find(hit => hit.ruleId === payload.ruleId && hit.outcome === 'applied')
      return render(payload, { trigger: 'notice-rule', ruleId: payload.ruleId, evaluationId: evaluation?.evaluationId,
        userText: text, sourceSeqs: evaluation?.sourceSeqs ?? [], facts, evaluation, rule: evaluation?.rule })
    })
  }

  return { collect }
}
