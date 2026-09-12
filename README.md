# dsh-context-care

[![版本](https://img.shields.io/github/v/release/leolee9086/dsh-context-care)](https://github.com/leolee9086/dsh-context-care/releases)

**DeepSeek Harness 的上下文状态与自主压缩插件。** 界面同时显示疲劳度和唤醒值的百分比、等级与颜色；模型可在任务边界主动请求历史压缩，保留续接笔记并继续工作。

参考 S-forge MAGI 的指标曲线和 Codex 的上下文生命周期设计，以独立 Cordis 插件接入，不修改 Harness、S-forge 或 Codex 源码。本文档以中文为主。

> 当前版本：`v0.1.1`，依赖 DSH 的预稳定接口。已在 Harness 提交 `d347e703908d0406b7a7ef80e3a0e594d86b2215` 对应的本地构建上验证；不承诺兼容所有旧版或未来版本。

## 指标与行为

疲劳度采用 `min(100, 100 × (上下文估算量 / 策略预算)^1.5)`；唤醒值采用 `min(100, 100 × sqrt(保留历史估算量 / (模型容量 / 3)))`。默认按 30、60、85 分段；界面显示 0–100% 数值（最多一位小数）和等级，模型正文仍只报告等级，不显示剩余 token 倒计时。疲劳度四段依次为绿、蓝、橙、红；唤醒值依次为橙、蓝、青绿、绿。未校准使用灰色。容量取最近记录请求的真实路由模型；尚无容量时显示“未校准”。疲劳度以完整请求压力为基础，唤醒值以保留消息量为基础，因此工具定义和系统提示不会被当成丰富的历史经验。

`context_status` 查询状态。`context_rest` 接收最多 4000 字符的续接笔记，排入持久化收件箱；当前工具批次完成后，在下一次请求准备边界执行一次压缩。笔记、近期历史、工具调用与结果配对均保留。它使用预设现有的 compaction provider，生成真实摘要，不清空记录或休眠，不结束任务。

正常自动压缩继续负责容量兜底；同一边界若自动维护已经改写历史，主动请求不再追加一次压缩。待选范围只有旧摘要及本插件状态，或新内容不足时不执行。这个保护属于主动压缩入口，不改变 DSH 原有自动压缩的重试策略。

## 缓存与模型体验

固定说明由 `systemPrompt.context` 生成可重放的 user 消息；动态状态通过 `agent/pre-step` 追加到最终消息队列末尾，角色为 `user`。不修改系统提示，不插入 system 角色状态，不改写既有消息。按整数百分比节流：任一指标跨过 1 个百分点的区间才追加采样提示（例如 52.1→52.8 不提示，52.8→53.0 提示）；等级变化和主动压缩结果仍通知。数值放在消息来源元数据 `contextCare` 中，模型正文仍只有等级，既有消息不变。界面展示最近一次已通知采样的数值。首次挂载新增工具会改变一次工具定义；实际压缩会改变历史前缀，这两种必要变化不承诺保持原缓存。测试验证普通相邻请求的系统提示一致、既有消息前缀完全相等。

提示明确区分指标与事实：它们不证明记忆丢失、幻觉或能力下降，不构成任务时限；继续工作，在任务边界自主选择压缩。唤醒值低时按需查阅摘要和文件，不编造缺失事实，也不为提升指标填充消息。此设计减少上下文焦虑的诱因，不能保证某个模型绝不产生此类输出；尚未进行真实 DeepSeek 模型的对照效果评估。

UI 显示最近一次请求准备时的状态，与模型读取的同一条持久化消息对应。`contextCareNumeric` 投影支持会话重放；旧记录没有数值时显示“未校准”，不会根据等级反推百分比，下一次新版本采样后显示实值。它不是逐 token 更新的心理健康监测。

## 安装

### 使用 Release 发布包（推荐）

[下载 v0.1.1](https://github.com/leolee9086/dsh-context-care/releases/tag/v0.1.1) 中的 `dsh-context-care-0.1.1.tgz` 已包含前端构建产物，可以直接安装到现有 Web profile：

```sh
dsh plugin --profile web add https://github.com/leolee9086/dsh-context-care/releases/download/v0.1.1/dsh-context-care-0.1.1.tgz
```

安装不拉取 DSH 本体或内部包，也不需要 DSH 源码目录。所有 DSH 能力都通过 Cordis 的 `inject`、`ctx` 服务及事件参数取得；运行环境需预先提供这些服务。本项目暂不发布到 npm registry。安装后还需完成下面两步挂载。

1. 在 Web profile 的 `cordis.patch.yml` 中加入共享显示入口。默认文件位于 `${DSH_HOME}/profiles/web/cordis.patch.yml`，未设置 `DSH_HOME` 时通常位于 `~/.dsh/profiles/web/cordis.patch.yml`。已有 `insert` 时，把行合并到相应列表：

```yaml
- insert:
    - id: context-care-display
      name: dsh-context-care
```

2. 在**自己维护的 agent preset** 中，把以下行加入现有 compaction 隔离组，与 compaction provider 放在同一个 `config` 列表里：

```yaml
    - id: context-care
      name: dsh-context-care/agent
      config:
        budgetRatio: 0.8
        wakefulnessRatio: 0.3333333333333333
        fatigueExponent: 1.5
        retainRatio: 0.16
        minFreshTokens: 1024
        maxNoteChars: 4000
```

完整组示例见 [agent.example.cordis.yml](agent.example.cordis.yml)，宿主补丁见 [cordis.patch.yml](cordis.patch.yml)。不要编辑随部署附带的预设；应编辑自定义预设。根入口负责共享投影与 UI，`/agent` 入口负责会话工具和策略。

重新加载 profile（未启用配置热更新时需要重启 DSH），刷新现有 Web 页面，并使用修改后的预设开始新会话。首次有效请求采样后会显示数值；没有模型容量信息时显示“未校准”。编辑预设不会替换已经运行的会话所持有的旧实例。

### 从源码开发

插件可以在任意目录独立安装、测试和构建，无需同级 DSH checkout，也没有 `link:../deepseek-harness` 依赖。运行时第三方库只有 React 和 Zod；Cordis 核心仅作为默认测试环境的 registry 开发依赖，不随插件运行时载入。

```sh
git clone https://github.com/leolee9086/dsh-context-care.git
cd dsh-context-care
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm run check
```

`pnpm test` 是不依赖 DSH 安装的测试套件。需要验证真实宿主时，另行指定已构建的 Harness 路径运行外部集成测试：

```powershell
$env:DSH_TEST_CHECKOUT = '/path/to/built/deepseek-harness'
pnpm run test:integration
```

这个命令的测试宿主显式加载 DSH 来注入服务；该测试文件不会进入发布包，插件自身从不查找或导入这个路径。未指定路径时测试明确报错，不静默跳过。源码开发后可使用 `dsh plugin --profile web add link:/absolute/path/to/dsh-context-care`，仍需完成上述两处挂载。

### 注入接口

| 入口 | Cordis 注入服务 | 用途 |
|---|---|---|
| 主入口 | `sessionProjections` | 注册共享显示投影 |
| `/agent` | `agents`、`tools`、`systemPrompt`、`tokenMeter`、`llm`、`compaction`、`sessionProjections` | 工具、状态采样、请求边界监听与压缩 |
| `/activate` | `agents`、`agentPresets`、`tools` | 找到指定会话并在其 Cordis 作用域中挂载能力 |
| 客户端 | `slots`、`locale` | 插槽渲染与本地化；会话投影使用插槽传入的 `useProjection` |

工具以标准 JSON Schema 和回调数据交给注入的 `tools.register`，配置使用 Standard Schema。插件只构造自身拥有的消息数据，消息入队、持久化、计量、模型路由和摘要执行由注入的宿主负责。`package.json` 中 `dsh.client.inject` 的包名用于客户端插件加载顺序，不是 npm 依赖或模块导入。

### 更新已运行的会话（可选）

常规安装不需要此入口。需要向一个已加载会话即时补充功能时，可在 profile patch 中临时添加：

```yaml
- insert:
    - id: context-care-live
      name: dsh-context-care/activate
      config:
        sessionId: "替换为目标会话的实际 ID"
```

此入口只针对配置指定的会话。已有旧版工具时补充数值采样；没有工具时复用该会话的 compaction provider 安装工具；目标未加载时不操作。它不替换预设，重启后普通预设负责新挂载。移除该行会卸载临时贡献。正常分发不需要开发过程用于刷新 Node 模块缓存的 URL 查询参数。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `budgetRatio` | 0.8 | 疲劳度分母占模型窗口的比例；与预设压力阈值配合设置 |
| `wakefulnessRatio` | 1/3 | 唤醒值饱和时的保留信息量比例 |
| `fatigueExponent` | 1.5 | 疲劳度增长曲线指数 |
| `retainRatio` | 0.16 | 主动压缩保留的近期历史预算比例 |
| `minFreshTokens` | 1024 | 待压缩区间的新内容最低估算量 |
| `maxNoteChars` | 4000 | 续接笔记 UTF-16 字符数上限 |

比例必须大于 0 且小于 1，保留比例小于预算比例；计数上限必须为正整数。配置错误在挂载时拒绝。

## 验证与来源

`pnpm test` 验证曲线、百分比节流、范围配对、参数拒绝、失败、取消、卸载、数值投影与中文 UI，并检查 manifest、锁文件和运行时代码不引入 DSH 包。`pnpm run test:integration` 使用明确指定的真实 DSH Loader YAML、agent loop、工具注册表、token meter 与 compaction provider，仅模拟 LLM；检查摘要事务、工具结果顺序、继续执行、提示快照、投影重放和请求前缀。`pnpm run build` 生成客户端构建产物。

S-forge 来源：`kernel/nerv/magi/sages/token_counter.go` 的 `CalculateFatigue`、`CalculateWakefulness`，`sages/sage.go` 的末尾 user 状态消息，`prompts/core.go` 与 `coordinator/heartbeat_downtime.go` 的深度休息策略。Codex 参考：`codex-rs/core/src/session/token_budget.rs` 与 `compact_token_budget.rs` 的上下文管理入口。详见 [设计记录](DESIGN.md)。

## 已知限制

计量是最近请求锚点加历史增减的估算，新模型路由和其他插件在后续阶段追加的大块内容可能暂时不反映在当前等级中。自动压缩仍是必要兜底。摘要质量取决于现有 provider；失败报告不声称压缩完成。插件不提供长期记忆存储，重要不可替代的信息仍应保存到文件。尚未用真实 DeepSeek 请求验证行为改善幅度。

## 赞赏

如果这个项目帮到了你，可以请我喝杯咖啡：

![赞赏码](assets/sponsor-qr.png)

也欢迎通过 [爱发电](https://afdian.net/a/leolee9086) 支持。