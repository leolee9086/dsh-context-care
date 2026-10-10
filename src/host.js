import { installContextCare, Config } from './index.js'
import { contextCareActions } from './action-view-data.js'
import { contextCarePrompts } from './prompt-view-data.js'
import { installControlRoute } from './control-route.js'
import { installWorkbenchRoute } from './workbench-route.js'
import { installDisplayRoute } from './display-route.js'

// 通用入口:挂在 profile 层一次,对所有会话生效。
//
// 工具注册在根作用域 —— 按 DSH 的 tools 服务约定,根作用域的注册进全局层,
// 每个 agent 的视图都以全局层为基底,因此不需要给每个 preset 各挂一遍。
// 状态采样与压缩在 `agent/pre-step` 边界执行,事件参数自带 agent。
// 唯一按 agent 的东西是 compaction provider,在这里用 agentPresets 现取
// (`serviceFor` 在未提供时返回 undefined,由安装方在边界上报"无 provider")。
export const name = 'context-care-runtime'
export { Config }
// webServer 是路由的硬依赖；connection 在每次请求时现取，未挂载时明确返回 503。
// 写进 inject(而不是用 ctx.get 碰运气)才会让 Cordis 等到它们就绪再 apply ——
// 用 ctx.get 的话,本行先于 webServer 加载时拿到 undefined,路由就静默地没了。
export const inject = ['agents', 'sessions', 'sessionProjections', 'tools', 'systemPrompt', 'tokenMeter', 'llm', 'webServer', 'contextCareRequests']

/**
 * 客户端卡片从这里拿「哪些内容被改写过」。
 *
 * 为什么需要这条路:改写记录不进会话日志(自定义事件类型会被读侧校验拒载,
 * 见 README「记录去哪儿了」),所以界面本来看不到它 —— 而「界面看得到」正是要的东西。
 * 独立插件包能用的 host → client 通道是 webServer 的裸路由;客户端同源 fetch 自动带 Cookie。
 */
const JOURNAL_ROUTE = '/context-care/rewrite-journal'

export function apply(ctx, config = {}) {
  const care = installContextCare(
    ctx,
    config,
    agent => ctx.get('agentPresets')?.serviceFor(agent, 'compaction') ?? ctx.get('compaction'),
  )
  ctx.effect(() => installDisplayRoute(ctx))
  ctx.effect(() => installControlRoute(ctx))
  ctx.effect(() => installWorkbenchRoute(ctx))
  ctx.effect(() => installWorkbenchRoute(ctx, '/context-care/rule-runtime'))
  const journal = care?.rewriteJournal
  if (journal === undefined) return

  // 两者都已在 inject 里声明,所以直接用属性代理读:**声明的服务用 ctx.<name>,
  // 未声明的可选服务才用 ctx.get**(见 packages/AGENTS.md 的 Optional services 那条)。
  const server = ctx.webServer
  // Authentication may mount after this plugin. Absence denies access without blocking model tools.
  function authorized(req, res) {
    res.setHeader('cache-control', 'no-store')
    const connection = ctx.get('connection')
    const rejected = connection === undefined ? 503 : connection.requestRejection(req)
    if (rejected === undefined) return true
    res.writeHead(rejected, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: connection === undefined ? 'authorization-unavailable' : 'unauthorized' }))
    return false
  }
  for (const collection of ['actions', 'prompts']) ctx.effect(() => server.register({ kind: 'exact', path: `/context-care/${collection}`, async handler(req, res) {
    if (!authorized(req, res)) return
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
    const query = new URL(req.url, 'http://localhost').searchParams
    const sessionId = query.get('sessionId')
    const limit = Number(query.get('limit'))
    const offset = Number(query.get('offset') ?? 0)
    // The panel requests one session page; cap each response at 200 actions.
    if (!sessionId || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) {
      res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid-query' })); return
    }
    try {
      // A readable old table is not evidence that the latest journal write
      // succeeded. Surface retained storage failures to the status panel.
      await ctx.contextCareRequests.flush(sessionId)
      const session = ctx.sessions.get(sessionId)
      if (collection === 'prompts' && !session) { res.writeHead(404); res.end(JSON.stringify({ error: 'session-unavailable' })); return }
      const records = ctx.contextCareRequests.list(sessionId)
      const view = collection === 'actions' ? contextCareActions(records, session) : { prompts: contextCarePrompts(records, session) }
      const items = view[collection]
      const selectedSeq = query.has('seq') ? Number(query.get('seq')) : undefined
      if (selectedSeq !== undefined && (!Number.isSafeInteger(selectedSeq) || selectedSeq < 0)) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid-sequence' })); return }
      const selectedIndex = selectedSeq === undefined ? -1 : items.findIndex(item => item.seq === selectedSeq)
      const pageOffset = selectedIndex < 0 ? offset : Math.floor(selectedIndex / limit) * limit
      const page = items.slice(pageOffset, pageOffset + limit)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      const runtime = ctx.get('contextCareWorkbench')?.store.read(sessionId)?.runtime
      const matchingFailures = collection === 'actions' ? (runtime?.runs ?? []).filter(run => ['matching', 'display'].includes(run.kind)).map(run => ({
        id: run.id, kind: run.kind, status: run.status, reason: run.reason, count: run.count, updatedAt: run.updatedAt, sourceSeqs: run.sourceSeqs, diagnostic: run.result,
      })) : undefined
      const workbench = ctx.get('contextCareWorkbench'); const agent = ctx.agents.get(sessionId)
      const displayMarkers = collection === 'actions' ? (runtime?.state['$displayMarkers'] ?? [])
        .filter(value => agent && value.token === workbench.token(agent)).map(value => value.seq) : undefined
      res.end(JSON.stringify({ admission: view.admission, currentState: ctx.contextCareRequests.controls.currentSample(sessionId), matchingFailures, displayMarkers, [collection]: page, total: items.length, offset: pageOffset,
        selectedFound: selectedSeq === undefined ? undefined : selectedIndex >= 0,
        nextOffset: pageOffset + page.length < items.length ? pageOffset + page.length : null }))
    } catch (error) {
      ctx.logger.warn(`context-care: action query failed: ${String(error)}`)
      res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'journal-unavailable', message: error instanceof Error ? error.message : String(error) }))
    }
  } }))

  ctx.effect(() => {
    const dispose = server.register({
      kind: 'exact',
      path: JOURNAL_ROUTE,
      handler: async (req, res) => {
        res.setHeader('x-context-care-journal-format', journal.format ?? 'legacy')
        if (!authorized(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId')
        if (!sessionId) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid-query' })); return }
        if (!ctx.sessions.get(sessionId)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'session-unavailable' })); return }
        try {
          const records = await journal.list({ sessionId })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ records }))
        } catch (error) {
          ctx.logger.warn('context-care: 读改写记录失败: ' + (error instanceof Error ? error.message : String(error)))
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'journal-unavailable', message: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    return () => dispose()
  }, 'dsh-context-care: 改写记录路由')
}
