# 更新记录

## v0.3.0

新增输出循环检测：模型"卡带"时主动提醒它先把笔记写详细、再压缩历史。

- 新模块 `src/loop-guard.js`：取会话里最近一条助手回复（思考块 + 正文块），只看末尾 80 行、剔除长度 < 3 的行，当某一行重复 ≥ 15 次**且**占窗口 ≥ 20% 时判定为循环。判据只算重复次数与占比、不看具体内容，所以换一组词同样认得出，不需要维护关键词表。
- 判定结果在 `agent/pre-step` 边界以插件消息注入（`source.plugin = dsh-context-care:loop`）。文案明确要求**先把进度落盘成非常详细的笔记、再调用 `context_rest`**，并列出笔记必须写全的项（目标与背景、已完成的文件路径/命令/结果、待办、踩过的坑与根因、关键路径）—— 顺序不能反，压缩会带走还没落盘的细节。
- 连着卡住时只提醒一次：最近一条 `user` 消息若已是本插件的循环提醒，就不再重复注入，避免刷屏。

验证：真实循环样本（`（输出。）` / `**做。**` / `go.` 反复 60 轮）命中「**做。**」x27/80 = 34%；由 60 行各不相同的正常内容构成的长回复未命中，无误报。

## v0.2.1

修复主动压缩（`context_rest`）一旦真正执行就必然失败的问题：压缩区间从第 0 个节点开始，而那个节点承载系统提示。

- `selectRestRange` 原先把压缩区间的起点写死为 `surface[0]`。当该节点是 `system/message` 时，session surface 会保护它 —— 只有 `system/message` 能精确覆写这一个节点，普通 replace 一律拒绝（`core/session/src/surface.ts` 的 `assertSystemHeadRewrite`）。于是 `compactRegion` 在写回时抛 `surface replace: node 0 holds the system prompt…`，压缩前功尽弃；而且错误发生在摘要**已经生成之后**，每撞一次就白烧一次 LLM 调用。
- 现在起点会跳过受保护的 node 0：`surface[0]` 是 `system/message` 就从 `surface[1]` 开始；跳过之后若已无内容可压则照常返回 `null`。再往后的 system 节点不受保护，可以正常被压缩区间覆盖。
- 现象辨析：历史未达保留区预算（`capacity × retainRatio`）时，函数在更早的两处 `return null`，报 `not performed: no sufficiently large fresh prefix…`；一旦历史够长、真正走到执行阶段，就撞上上述错误并报 `request did not finish normally`。两者是同一流程的前后两段，不是两个独立故障。

验证：在 `capacity=1,000,000`（`retainRatio=0.16` → `retainTokens=160,000`）、`nodesLen=667`、`totalNodeTokens=329,662` 的真实会话上，压缩区间取 `[surface[1], surface[272]]`、`fresh=165,483`，19 秒完成 `compactRegion`，`replaceGeneration` 由 11 变为 12，疲劳度随后由 elevated 回落到 normal。

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
