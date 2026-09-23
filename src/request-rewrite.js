// src/request-rewrite.js — 在请求层执行篡改。
//
// 为什么篡改要放到这里:pre-step 只能改「这一轮要发出去的消息」,
// 而组装好的请求体里还有系统提示词、工具定义等等 —— 那些只有请求层看得见。
//
// 分工:这一层是执行者,不是决策者。它跑规则引擎里 placement 为 request 的
// transform 规则 —— 谁该改、能废多少缓存,都是规则里写好的,这里只把它落到 body 上。
//
// 请求层的规则没有会话可依附:引擎的冷却与 surface 去重都按请求本身算。

import { createEngine } from '@leolee9086/dsh-rule-engine'

/** 注册到 fetch-router 的 requestRewrite 服务时用的名字。 */
export const REWRITER_NAME = 'context-care'

/** 同接口的键:host + path。缓存只跟上一次同接口的请求比。 */
function targetOf(url) {
  const parsed = new URL(url)
  return parsed.host + parsed.pathname
}

/**
 * 造一个请求体改写器。
 *
 * @param {object} deps
 * @param {() => (object[]|undefined|null)} deps.rules 取规则;每次请求现取。
 * @param {(record: object, where: {sessionId: string|undefined}) => void} deps.onRecord 命中记录的回调。
 * @returns {(request: {body: string, url: string, scope?: object}) => Promise<string|undefined>} 改写器;没改动就返回 undefined。
 */
export function createRequestRewriter({ rules, onRecord }) {
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
    lastSent.set(key, result.text)
    const sessionId = typeof scope?.sessionId === 'string' ? scope.sessionId : undefined
    for (const record of result.records) onRecord(record, { sessionId })
    // 没变就交回 undefined —— 「没人改」和「改成一样的东西」是两回事,
    // 前者不该让调用方重建 body。
    return result.text === body ? undefined : result.text
  }
}
