// src/request-rewrite.js — 在请求层执行篡改。
//
// 为什么篡改要放到这里:pre-step 只能改「这一轮要发出去的消息」,
// 而组装好的请求体里还有系统提示词、工具定义等等 —— 那些只有请求层看得见。
//
// 执行通道就是 fetch-router:它替换 globalThis.fetch,请求发出前依次跑登记的
// 改写器(interceptor.js 的 rewriteBody → rewrite.js 的 apply)。本插件通过
// ctx.inject(['requestRewrite']) 拿到那个服务,把自己 register 成改写器之一。
// **没有第二条改写通道** —— 引擎规则和循环清理都走这一个 rewrite。
//
// 分工:这一层是执行者,不是决策者。它跑规则引擎里 placement 为 request 的
// transform 规则 —— 谁该改、能废多少缓存,都是规则里写好的,这里只把它落到 body 上。
// 循环清理(loop-clean 的模式表)也在这里执行:请求体里的 messages 含上一轮
// 助手输出,这是 pre-step 够不着的部分。
//
// 请求层的规则没有会话可依附:引擎的冷却与 surface 去重都按请求本身算。

import { createEngine } from '@leolee9086/dsh-rule-engine'
import { cleanMessages } from './loop-clean.js'
import { changedBlocks } from './rewrite-journal.js'

/** 注册到 fetch-router 的 requestRewrite 服务时用的名字。 */
export const REWRITER_NAME = 'context-care'

/** 同接口的键:host + path。缓存只跟上一次同接口的请求比。 */
function targetOf(url) {
  const parsed = new URL(url)
  return parsed.host + parsed.pathname
}

/**
 * 在请求体里清掉最后一条助手消息末尾的循环。
 *
 * body 是组装好的请求体(JSON 字符串)。解析失败、或没有 messages、或没有命中
 * 循环,都返回 undefined —— 请求层不该因为清理而毁掉一次请求。
 * 只有命中时才 JSON.parse/stringify 一遍,平时原样放行。
 *
 * @param {string} body 请求体原文。
 * @returns {{body: string, removedLines: number, pattern: string}|undefined} 命中时返回改写后的请求体。
 */
function cleanLoopInBody(body) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  if (!Array.isArray(parsed.messages)) return undefined
  const cleaned = cleanMessages(parsed.messages)
  if (cleaned.removedLines === 0) return undefined
  return {
    body: JSON.stringify({ ...parsed, messages: cleaned.messages }),
    removedLines: cleaned.removedLines,
    pattern: cleaned.pattern,
    // 请求体里没有事件 seq,所以记录只能靠内容哈希跟客户端的消息对上。
    changed: changedBlocks(parsed.messages, cleaned.messages),
  }
}

/**
 * 对比改写前后的请求体,找出真正变化的助手消息块。
 *
 * 引擎规则改的是**整段文本**,卡片要的却是「哪一段文本变了」——所以改完再解析一次,
 * 把前后两份 messages 交给 changedBlocks。解析不出来就返回空:规则可能动到 JSON
 * 结构(比如整段替换),那时算不出块级证据,只能不产出卡片,而不是猜一个哈希出来。
 *
 * @param {string} before 改写前的请求体。
 * @param {string} after 改写后的请求体。
 * @returns {Array<{hash: string, charsBefore: number, charsAfter: number}>} 变化的块。
 */
function blocksChangedBetween(before, after) {
  const messagesOf = text => {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
      // Chat Completions / Messages 使用 messages；Responses 使用 input。
      if (Array.isArray(parsed.messages)) return parsed.messages
      return Array.isArray(parsed.input) ? parsed.input : undefined
    } catch {
      return undefined
    }
  }
  const beforeMessages = messagesOf(before)
  const afterMessages = messagesOf(after)
  if (beforeMessages === undefined || afterMessages === undefined) return []
  return changedBlocks(beforeMessages, afterMessages)
}

/**
 * 造一个请求体改写器。
 *
 * @param {object} deps
 * @param {() => (object[]|undefined|null)} deps.rules 取规则;每次请求现取。
 * @param {(record: object, where: {sessionId: string|undefined}) => void} deps.onRecord 命中记录的回调。
 * @returns {(request: {body: string, url: string, scope?: object}) => Promise<string|undefined>} 改写器;没改动就返回 undefined。
 */
export function createRequestRewriter({ rules, onRecord, journal }) {
  // 不把 onRecord 交给引擎:引擎回调在 run 内部触发,那时还不知道这次请求属于哪个会话。
  // 从 run 的返回值里拿记录,就能把 sessionId 一起带上。
  const engine = createEngine()
  /**
   * 每个接口上一次真正发出去的 body。
   *
   * 预算要有意义就必须有它:缓存只跟上一次同接口的请求比。
   * 没有它,previous 永远是 null、loss 永远是 0,预算检查就成了摆设。
   * 而且这也正是「规则稳定时只有第一次费缓存」的来源 ——
   * 上一次发出去的已经是改过的文本,前缀自然对得上。
   *
   * 存的是最终文本:引擎规则和循环清理都改完之后的 body。
   */
  const lastSent = new Map()
  engine.provideRules('request-rewrite', rules)
  // 改写器自己就是篡改动作的消费者。引擎在 gate 阶段先判「有没有人接」,
  // 没人接的规则不执行 —— 所以这里必须注册,否则规则会全部被判成 no-consumer。
  // 接住之后不用做什么:改后的文本就是 engine.run 的返回值,
  // 这一环在这里的语义是「这条规则有主」。
  engine.registerConsumer({ name: REWRITER_NAME, kinds: ['transform'], handle() {} })
  return async function rewrite({ body, url, scope }) {
    const key = targetOf(url)
    const previous = lastSent.get(key) ?? null
    const result = engine.run({
      surface: { placement: 'request', text: body },
      ctx: { now: Date.now(), previous },
    })
    let text = result.text
    const sessionId = typeof scope?.sessionId === 'string' ? scope.sessionId : undefined
    // 循环清理:与 transform 规则同在 fetch-router 的改写通道上。
    // 请求体里的 messages 含上一轮助手输出,所以这里能碰到 pre-step 碰不到的循环。
    // 不依赖任何会话事件 —— 清理只是「这一次不把循环发出去」,日志原文不动。
    const loop = cleanLoopInBody(text)
    if (loop !== undefined) {
      text = loop.body
      onRecord({
        layer: 'loop',
        ruleId: `loop-clean:${loop.pattern}`,
        outcome: 'applied',
        loss: 0,
        detail: `最后一条助手消息去掉 ${loop.removedLines} 行`,
      }, { sessionId })
    }
    // 记一次改写:走旁路流水账(见 rewrite-journal.js)。索引插件的属性表在就落它那里,
    // 不在就只在进程内。记录失败不阻断改写 —— 旁路不该毁掉这次请求。
    //
    // 哈希统一在这里算,**不区分是谁动的手**:引擎规则(transform)和循环清理都改请求体,
    // 而卡片认的是「这条助手消息的块变了」。原先只有循环清理产出哈希,于是引擎规则的
    // 改写永远画不出卡片 —— 用户看不到被改过,而那正是这张卡片存在的理由。
    if (journal !== undefined && sessionId !== undefined && text !== body) {
      const applied = result.records.find(record => record.outcome === 'applied')
      for (const block of blocksChangedBetween(body, text)) {
        await journal.record({
          sessionId,
          hash: block.hash,
          pattern: loop === undefined
            ? (applied?.ruleId ?? 'transform')
            : `loop-clean:${loop.pattern}`,
          removedLines: loop?.removedLines,
          charsBefore: block.charsBefore,
          charsAfter: block.charsAfter,
        })
      }
    }
    lastSent.set(key, text)
    for (const record of result.records) onRecord(record, { sessionId })
    // 没变就交回 undefined —— 「没人改」和「改成一样的东西」是两回事,
    // 前者不该让调用方重建 body。
    return text === body ? undefined : text
  }
}
