# 更新记录

## v0.2.0

把"通用能力"改成真正通用：一次挂载对所有会话生效，不再要求在每个 preset 里各挂一遍。

- 主入口（`.` → `src/host.js`）现在安装完整能力：在根作用域注册 `context_status` / `context_rest`（根作用域注册进全局层，每个会话的视图都以全局层为基底）、注册系统提示段、在 `agent/pre-step` 边界做状态采样与压缩。事件参数自带 agent，因此不需要按会话挂纤维。
- compaction provider 是唯一按 agent 的东西，改为在请求边界用 `agentPresets.serviceFor(agent, 'compaction')` 现取；取不到时如实报告 `no compaction provider is available`，不再在安装期抛错。
- 与旧装法共存：agent 作用域里已有 `context_rest` 注册时（preset 里的 `/agent` 入口），作用域注册遮蔽全局注册，根实现据此退让，同一会话不会被通知或压缩两次。
- `/agent` 与 `/activate` 入口保留且行为不变；preset 里的 `context-care` 行不再是必需项。
- 新增 4 项测试覆盖上述路径。

验证：23 项测试（activate / client / context-care / dependencies / general）与语法检查通过。真实 DSH 组合测试仍需显式设置 `DSH_TEST_CHECKOUT`。

## v0.1.1

修复 v0.1.0 直接依赖 DSH 内部包的架构问题。

- 删除运行时 DSH 模块导入、DSH peer dependencies 和所有 checkout 链接。
- 所有 DSH 能力经 Cordis 注入服务访问；工具直接向注入注册表提交 JSON Schema 和回调。
- 配置改用 Zod Standard Schema，不依赖 DSH schema 包。
- 消息数据构造和范围策略由插件自身持有，摘要执行仍由注入服务负责。
- 默认安装、测试与构建完全独立；真实 DSH 集成测试改为显式设置 `DSH_TEST_CHECKOUT` 的单独命令，不进入发布包。
- 新增依赖边界回归检查和工具参数校验覆盖。

验证：在独立临时目录从 registry 全新安装，19 项测试、构建与语法检查通过；另有 1 项真实 DSH Loader/loop 集成测试通过。

## v0.1.0

首次发布独立 Cordis 插件。

- 输入框下方显示疲劳度和唤醒值百分比、等级与四段颜色。
- 参考 S-forge 的凸增长疲劳度曲线和平方根唤醒值曲线。
- 提供 `context_status` 状态查询和 `context_rest` 主动历史压缩。
- 在安全请求边界执行压缩，保留近期历史、工具配对与续接笔记。
- 普通通知按整数百分比区间节流，压缩结果单独报告。
- 模型状态仅以末尾 `user` 消息追加；数值保存于消息来源元数据，已有请求前缀保持不变。
- 支持数值投影重放、旧记录未校准显示、失败与取消处理、卸载清理。
- 中文优先 README，包含发布包安装、自定义预设挂载、开发和限制说明。

验证：19 项测试通过，前端构建与语法检查通过。真实 DSH 组合测试模拟 LLM；尚无真实 DeepSeek 行为改善幅度的对照实验。
