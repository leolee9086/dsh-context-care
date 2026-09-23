import { installContextCare } from './index.js'

// 通用入口:挂在 profile 层一次,对所有会话生效。
//
// 工具注册在根作用域 —— 按 DSH 的 tools 服务约定,根作用域的注册进全局层,
// 每个 agent 的视图都以全局层为基底,因此不需要给每个 preset 各挂一遍。
// 状态采样与压缩在 `agent/pre-step` 边界执行,事件参数自带 agent。
// 唯一按 agent 的东西是 compaction provider,在这里用 agentPresets 现取
// (`serviceFor` 在未提供时返回 undefined,由安装方在边界上报"无 provider")。
export const name = 'dsh-context-care'
export const inject = ['sessions', 'sessionProjections', 'tools', 'systemPrompt', 'tokenMeter', 'llm']

export function apply(ctx, config = {}) {
  const presets = ctx.get('agentPresets')
  const local = ctx.get('compaction')
  installContextCare(
    ctx,
    config,
    agent => presets?.serviceFor(agent, 'compaction') ?? local,
  )
}
