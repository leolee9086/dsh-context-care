import { ContextCareStatus, dictionaries } from './client-view.js'
import { REWRITE_NODE, RewriteNodeView, createRewriteDefinition } from './rewrite-view.js'

export const inject = ['slots', 'locale', 'uiConversation']

/** 拉记录的间隔。改写发生在请求发出**之前**,而助手消息在响应**之后** ——
 *  所以只要这个间隔短于一次模型响应,卡片就赶得上。 */
const POLL_MS = 2000


/** 记录路由。host 侧 src/host.js 注册的同一条路径。 */
const JOURNAL_ROUTE = '/context-care/rewrite-journal'

/** Add two context indicators beneath the composer, without replacing its built-in statistics. */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('dsh-context-care', dictionaries))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'context-care', order: 4, locale: 'dsh-context-care',
  }, ContextCareStatus))

  // 改写卡片:让界面看得到「这条输出在发送前被改写过」。
  // 数据来自 host 的裸路由(同源 fetch 自动带 Cookie),客户端**只读结论、不跑规则** ——
  // 规则将来可能不是纯函数(比如改成问 JEV 拿概率判定),那时客户端根本算不出来。
  let table = new Map()
  let signature = ''
  let disposed = false
  const listeners = new Set()
  // 轮询产生的新快照通过框架 hook 通知已挂载的卡片。
  const rewriteRecords = {
    getSnapshot: () => table,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const load = async () => {
    try {
      const response = await fetch(JOURNAL_ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) return
      const body = await response.json()
      const records = Array.isArray(body?.records) ? body.records : []
      if (disposed) return
      const nextSignature = JSON.stringify(records)
      if (nextSignature === signature) return
      const next = new Map()
      for (const record of records) {
        if (typeof record?.hash !== 'string' || record.hash === '') continue
        // 会话范围内匹配，避免另一会话中相同文本的记录串过来。
        next.set(record.sessionId + ':' + record.hash, record)
      }
      signature = nextSignature
      table = next
      for (const listener of listeners) listener()
    } catch {
      // host 侧还没提供这条路由时不该在控制台刷屏。静默跳过,下一轮再试。
    }
  }
  void load()
  const timer = setInterval(() => { void load() }, POLL_MS)
  ctx.effect(() => () => { disposed = true; clearInterval(timer); listeners.clear() })

  ctx.effect(() => ctx.uiConversation.events.register(createRewriteDefinition()))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: REWRITE_NODE, locale: 'dsh-context-care',
    inject: () => ({ hooks: { rewriteRecords } }),
  }, RewriteNodeView))
}
