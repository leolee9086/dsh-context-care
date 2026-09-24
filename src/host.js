import { installContextCare } from './index.js'

// 通用入口:挂在 profile 层一次,对所有会话生效。
//
// 工具注册在根作用域 —— 按 DSH 的 tools 服务约定,根作用域的注册进全局层,
// 每个 agent 的视图都以全局层为基底,因此不需要给每个 preset 各挂一遍。
// 状态采样与压缩在 `agent/pre-step` 边界执行,事件参数自带 agent。
// 唯一按 agent 的东西是 compaction provider,在这里用 agentPresets 现取
// (`serviceFor` 在未提供时返回 undefined,由安装方在边界上报"无 provider")。
export const name = 'dsh-context-care'
// webServer / connection 在这里是**真依赖**:没有它们就没有客户端卡片那条路由。
// 写进 inject(而不是用 ctx.get 碰运气)才会让 Cordis 等到它们就绪再 apply ——
// 用 ctx.get 的话,本行先于 webServer 加载时拿到 undefined,路由就静默地没了。
export const inject = ['sessions', 'sessionProjections', 'tools', 'systemPrompt', 'tokenMeter', 'llm', 'webServer']

/**
 * 客户端卡片从这里拿「哪些内容被改写过」。
 *
 * 为什么需要这条路:改写记录不进会话日志(自定义事件类型会被读侧校验拒载,
 * 见 README「记录去哪儿了」),所以界面本来看不到它 —— 而「界面看得到」正是要的东西。
 * 独立插件包能用的 host → client 通道是 webServer 的裸路由;客户端同源 fetch 自动带 Cookie。
 */
const JOURNAL_ROUTE = '/context-care/rewrite-journal'

export function apply(ctx, config = {}) {
  const presets = ctx.get('agentPresets')
  const local = ctx.get('compaction')
  const care = installContextCare(
    ctx,
    config,
    agent => presets?.serviceFor(agent, 'compaction') ?? local,
  )
  const journal = care?.rewriteJournal
  if (journal === undefined) return

  // 两者都已在 inject 里声明,所以直接用属性代理读:**声明的服务用 ctx.<name>,
  // 未声明的可选服务才用 ctx.get**(见 packages/AGENTS.md 的 Optional services 那条)。
  const server = ctx.webServer
  // connection 是**可选**依赖(手册里的写法就是 ctx.get('connection')?. ),不写进 inject ——
  // 猜错服务名会让插件一直停在 PENDING,那比少一层鉴权严重得多。
  const connection = ctx.get('connection')

  ctx.effect(() => {
    const dispose = server.register({
      kind: 'exact',
      path: JOURNAL_ROUTE,
      handler: async (req, res) => {
        res.setHeader('x-context-care-journal-format', journal.format ?? 'legacy')
        // 裸路由没有自动鉴权,必须自己问 connection(401 未过 Cookie 校验 / 403 Host 校验失败)。
        const rejected = connection?.requestRejection(req)
        if (rejected !== undefined) {
          res.writeHead(rejected, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return
        }
        try {
          // 不带 sessionId = 所有会话。客户端节点定义拿不到 sessionId
          // (ConversationNodeContext 里只有 key/kind/id/matches/start/state),
          // 所以它拉全量、按内容哈希匹配 —— 哈希相同就意味着文本相同,不会配错。
          const records = await journal.list({})
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ records }))
        } catch (error) {
          ctx.logger.warn('context-care: 读改写记录失败: ' + (error instanceof Error ? error.message : String(error)))
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'journal-unavailable' }))
        }
      },
    })
    return () => dispose()
  }, 'dsh-context-care: 改写记录路由')
}
