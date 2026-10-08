# dsh-context-care

[![版本](https://img.shields.io/github/v/release/leolee9086/dsh-context-care)](https://github.com/leolee9086/dsh-context-care/releases)

**DeepSeek Harness 的上下文状态与自主压缩插件。** 界面同时显示疲劳度和唤醒值的百分比、等级与颜色；模型可在任务边界主动请求历史压缩，保留续接笔记并继续工作。

参考 S-forge MAGI 的指标曲线和 Codex 的上下文生命周期设计，以独立 Cordis 插件接入，不修改 Harness、S-forge 或 Codex 源码。本文档以中文为主。

> 修复版本：`v0.7.3`，面向官方 DSH `0.2.0-rc.2`。安装 GitHub 版本前确认对应标签已经发布；本地修复包可使用下文的 tgz 装法。源码组合验收使用显式外部 Host 的 `pnpm test:integration:source`，不依赖残留构建产物；桌面产物验收由 Electron 从其封装目录只读加载官方模块。

## 指标与行为

疲劳度采用 `min(100, 100 × (上下文估算量 / 策略预算)^1.5)`；唤醒值采用 `min(100, 100 × sqrt(保留历史估算量 / (模型容量 / 3)))`。默认按 30、60、85 分段；界面显示 0–100% 数值（最多一位小数）和等级，模型正文仍只报告等级，不显示剩余 token 倒计时。疲劳度四段依次为绿、蓝、橙、红；唤醒值依次为橙、蓝、青绿、绿。未校准使用灰色。容量取最近记录请求的真实路由模型；尚无容量时显示“未校准”。疲劳度以完整请求压力为基础，唤醒值以保留消息量为基础，因此工具定义和系统提示不会被当成丰富的历史经验。状态与自动维护使用插件自己的输入计价：公开 `tokenMeter.estimateMessage` 提供固定文本估算，保留 surface、工具定义和本轮待进入的输入共用冻结的计价依据，输出计费量不参与下一次输入预算。插件请求日志从符合条件且 header 匹配的成功 prompt 样本校准文本、schema 和 framing；没有样本时文本倍率为 1。图片视觉价格不重复乘倍率，有效大倍率不截断。旧 `providerUsageRatio` 配置只保留迁移提示。此版本使用官方 0.2.0-rc.2 已有接口，不要求新增 `measureInput` / `priceMessages` 方法或修改宿主。

`context_status` 查询状态。`context_rest` 默认接收 1000–10000 个 UTF-16 字符的续接笔记，排入持久化收件箱；当前工具批次完成后，在下一次请求准备边界执行一次压缩。笔记、近期历史、工具调用与结果配对均保留。它读取预设 compaction provider 的公开摘要配置，在插件内执行摘要事务；自定义提供方未声明 LLM 摘要配置时仍调用其执行接口。摘要保留原记录并让任务继续。容量未知时，主动请求仍选择历史前缀，按显式 `retainTokens` 保留尾部；未设置时保留最近完整单元，再交给摘要路由或自定义 provider 处理实际输入。自动维护在可算出压力阈值时启动。摘要指令分别记录原始明确要求、执行者的实现选择、推测和完成状态，并依据最新纠正更新来源归属。

组合中 basic 设置 `auto: false`，保留摘要执行服务；context-care 按会话分别维护迟滞状态，选择普通维护动作。工具结果 pruner 按会话在边界现取，裁剪完成后重测，再决定摘要。普通主动休息在同一边界已被自动维护改写时不重复执行；显式深度休息仍执行自己的交接与找回路径；旧摘要和状态不计为 fresh，系统提示也不能让状态前缀通过 fresh 门槛。维护从 `budgetRatio × 有效容量` 的软阈值开始，直到输入严格低于释放目标或动作次数耗尽。通知通道、提示规则与循环提醒先收集，再参与维护计价；预计状态消息也纳入输入。一次维护先等待上一轮请求结算的存储 ACK，再在入口捕获文本倍率、图片定价与文件 handle 投影，裁剪后、摘要后和深度替换前后均用这份价格重算。成功用量或 adapter 定价在维护期间改变，只影响后续操作；图片视觉价格保持独立，不乘文本倍率。最终请求检查使用 ready 捕获的实际图片定价，明确未提供图片投影时保留固定估算。

显式 `deep: true` 使用完整交接与找回路径替换历史，不调用摘要模型。交接在同一输入计价依据下必须比选区更小，否则保留历史并报告失败；持久化 shadow 使用固定 heuristic。成功的交接已在 replacement 中，本轮不再重复提交排定请求的正文。

普通维护候选按新内容摘要、相邻旧检查点合并、仍有真实压力时的合法前缀兜底排序。`rangeStrategy: basic-prefix` 保留最大完整前缀；`target-prefix` 需要显式 `expectedCheckpointTokens`，按预测降幅选择能覆盖释放缺口的较小完整范围，无候选覆盖时选择预测收益最大者。预测与实际摘要输出分别计价。至少两个旧检查点且仅夹有照料状态时可合并；单个检查点不满足主动合并，真实压力仍可走兜底。日志增长和照料状态变化不会重新启用已验证无收益的同一候选，来源任务内容、有效价格或路由政策改变后重新评估。来源覆盖递归展开原记录、裁剪替换与前代摘要，深度表示加工次数，不表示保真度。

裁剪、摘要与深度替换共享单会话维护占用；其它会话独立推进。卸载取消排队和正在执行的操作并等待清理。摘要错误同步委托既有 `compaction/summary-error` listener；重试要求选区内部的新持久替换或已记录图片 offload、固定摘要价格下降、选区外内容与 header 不变。端点替换根据来源重映射，空 `true` 不授权重试。`maxSummaryRepairRetries` 和 `maxSummaryCallsPerAction` 可显式配置；缺省由每次必须新缩减的条件终止修复，真实派发才消耗调用名额，本地拒绝不消耗。

若规范 `IMAGE_OFFLOAD_REQUIRED` 错误因 LLM 的终止失败归一化而未被原 listener 接受，插件只在已有 `image/offload` 消息投影已挂载时适配结构化失败。它记录选区内请求数量的最旧未卸载图片；选区外图片保持原样，仍须通过相同的持久修复和价格下降检查。修复 listener、审计 ACK 或事务闭合再失败，不替代原始摘要失败。

## 预算与维护详情

输入框工具栏、模型选择器前的右栏图标打开当前会话的“预算与维护记录”；输入框下方仅显示状态指标。右栏概览突出完整输入、硬限额和使用率，计价与保留策略可展开查看实际路由、物理与政策容量、文本校准来源和样本、独立视觉价格、软阈值、释放目标、尾部与输出预留。维护详情展示选区规则、候选预测降幅、同价前后输入、路由与固定估价降幅、旧来源到新检查点的替换、递归覆盖及加工深度，以及提交、部分进展、失败和无收益结局。深度休息的 operation 与检查点事务显示为同一动作。

维护列表每条显示动作、状态、时间和输入变化，展开可查完整事实。面板正文独立滚动，底部页码与分页按钮持续可达，每页 20 条，在当前会话内翻页；顶部刷新可立即重读，加载失败在面板和状态行显示具体 HTTP 或读取错误，并可刷新重试。显示样式使用 DSH 的语义颜色、辅助字号和字号缩放变量，保持键盘焦点可见。改写记录失败会单独报告，按退避间隔重试，恢复后清除错误；修复、审计和事务闭合的二次失败保留原始错误码与消息，同时单独报告和记录。若会话已经提交检查点但提交审计不完整，只恢复可核对的替换事实并标明记录不完整，不推测缺失价格。客户端使用框架生成的响应式 hook，切换会话取消旧页请求，卸载停止轮询和未完成请求。Host 只读路径 `/context-care/actions?sessionId=...&limit=20&offset=0` 要求会话和显式页大小（1–200），继承已安装连接服务的鉴权并返回 `no-store`；响应不包含系统提示、工具 schema 或原始输出。

## 请求预算与溢出恢复

Host 行 `dsh-context-care/requests` 通过官方 `llm/stream` waterfall 拦截请求，在插件内创建编号并关联 `agent/assistant-stream` 的 attempt 与结算事件；会话侧登记当前可见工具所有者的政策。插件入口冻结日志 revision、surface 来源和正文，公开 `prepareCall` 绑定配置后组装一次性提示并完整计价。这里的 ready 和 dispatched 是插件日志阶段，不是新增 Harness 事件；dispatched 表示请求交给 prepared stream，不声称已观测 adapter 内部 HTTP 发包。使用预算 `C=min(已知实际容量,已知政策容量)`，输出预留取本次显式 `maxTokens`、adapter default 或 absent。硬输入 `H=C-R-safetyTokens`，可选计费输入上限再取 `min(H,billingInputCeilingTokens-safetyTokens)`；安全量各扣一次。软输入 `S=min(floor(budgetRatio*C),H-burstTokens)`，释放目标 `L=S-releaseMarginTokens`，尾部从 `C-R` 计算。非法已解析预算直接报错；两种容量均未知时保留 provider 调用。

`contextBudgetTokens` 与 `billingInputCeilingTokens` 可全局设置，或在 `routeBudgets` 按 exact provider/model/purpose 指定，不猜模型家族或实际容量。`safetyTokens`、`burstTokens`、`releaseMarginTokens` 迁移默认 0，部署应明确填写；`summarySafetyTokens` 可覆盖摘要安全量，`retainTokens: 0` 合法，`maxOverflowRetries` 默认 1。旧 `softBudgetRatio`、`hardBudgetRatio`、`hysteresisRatio` 不再决定新预算阈值，使用 `budgetRatio` 与 token allowances。

完整输入超过硬预算时，本地返回 `REQUEST_BUDGET_EXCEEDED`，不会派发到 adapter。provider 的 `CONTEXT_WINDOW_EXCEEDED` 即使低于估算软阈值也进入强制恢复。恢复先裁剪再尝试保留最近完整单元的前缀摘要；只有失败 revision 之后、覆盖失败请求已用来源且同一冻结 basis 下价格下降的持久 replacement 才允许有限重试。本地预算拒绝还要求重构输入已在 H 内；恢复失败且没有合格进展时保留原始请求失败，摘要错误不会替代它。idle 或正常输出清除重试计数，贡献卸载清除对应快照及检查。

摘要构造与执行共用请求 builder，包含系统头、工具定义、完整选区与末尾指令。摘要路由按自己的容量和 compaction 政策选择能容纳的完整前缀；provider 或最终检查拒绝过大输入后，在配置次数内缩小完整选区重试。提交前核对输入仍相同，并以同一冻结 basis 比较完整主请求，包含检查点包裹文字；文本校准倍率不会被固定 shadow 价格代替。同一会话的摘要执行串行，失败闭合事务并保留历史。`summary` 可覆盖 `provider`、`model`、`maxTokens` 与 `maxRetries`；未覆盖的值取提供方对应会话路由的公开配置。Host 请求观察行还独占 `context_care_requests` 存储域。ready 先持久记录实际路由、完整输入指纹、计价依据与预算，再决定派发；dispatch 和真实输出结算按会话串行更新，保留是否确实派发、输出事件与 usage。摘要的 started、prepared、committed 或 failed 动作关联同一 compactionId。`contextCareRequests.list(sessionId?)` 按时间和 key 稳定排序，`flush(sessionId?)` 等待存储确认；卸载先移除监听再等待写入并关闭 handle。ready 另存完整实际输入的未校准文本价和视觉价；校准只选同输入配置的成功真实对话请求，以 usage 的输入与 cache tokens 减视觉价后除文本价，合法大倍率保留。一次性提示与工具已在分母中，图片视觉价仍独立。没有匹配的合格请求样本时使用倍率 1；旧会话的请求与输出合计压力不会代替输入校准；裁剪和深度替换也记录 started 与 completed/failed、来源 seq 和同依据前后输入价；失败后已提交的缩减仍在记录中标为部分进展。本地错误的 origin/budgetKind 目前属于运行时检查详情，终止 stream 保存稳定错误码与原始消息。普通维护的状态消息计价属于预测，最终 ready 检查完整实际请求。高负载与非常高负载文案保留落盘和维护步骤，只描述请求负载、正文替换及可核对的原记录，不从统计推导失忆、能力下降或身份改变。

## 模型作用域提醒

`modelScopedPrompts` 按明确的 `provider`、`model` 和 `purposes` 匹配，规则含 `ruleId`、`version`、`text`、`trigger: static | model-switch | output-pattern`；purposes 默认仅 conversation。切换规则以同用途上次真实派发的路由为依据，`initialBind` 默认 false，可显式要求首次提醒。`{boundModelLabel}` 替换为本次路由名。未派发的请求不会更新上次路由；规则卸载后立即停止贡献。

Host 在 `llm/stream` 委托后，为新增提示使用公开 prepared call 构造独立的不可变请求，并将实际派发关联回原调用。完整段落记录在已有 `request/header` 事件的 `contextCarePrompt` 元数据，完整输入继续经过 ready 预算检查。提示消息只在本次请求中追加，历史 surface、系统头和摘要选区不包含它。另一模型或另一用途的请求重新匹配，返回原路由时收到一份切换提醒。主请求预测和辅助摘要预选使用相同的 preview，再由实际 ready 输入执行最终检查。`output-pattern` 规则显式提供 detector：Markdown 结构解析与 Intl.Segmenter 句/词统计排除代码、引用及配置的局部元讨论前缀；literal 按最长优先合并重叠，记录 N/K/H/F/J/D、源 offset 和有界证据。词表、单篇/滑窗阈值、完整文本/语句/词条/证据上限均须配置；超限记为 unavailable。仅真实派发后完整提交的对话输出纳入独立路由窗口，失败、中断和辅助摘要不作健康证据。反馈按新 seq 去重、完成输出冷却和健康输出重新启用，存入 Host 的 `context_care_output_feedback`，下一次自然请求投递；未主动制造额外 turn。目标路由的 `carryFromOtherRoute` 明确允许携带旧源反馈，否则切换派发将其 superseded。投递前先记录 delivery-unknown，按 detector.maxDeliveries 限制崩溃后的重投。

下面是测试参数构成的完整配置示例，词表和数值用于演示可复验条件，未作为所有模型的默认政策。部署时替换明确的 provider/model、词表、阈值和提醒文字；将 `modelScopedPrompts` 放在负责该会话的 `/runtime` 或 `/agent` 的 config 中。literal 区分大小写，不接收任意正则。

```yaml
modelScopedPrompts:
  - ruleId: thinking-model-bind
    version: '1'
    provider: your-provider
    model: your-exact-model-id
    purposes: [conversation]
    trigger: model-switch
    initialBind: true
    text: '本次使用 {boundModelLabel} 支持思考。依据实际任务和证据继续工作，辨别并克服所用模型的措辞倾向。'
  - ruleId: wording-feedback
    version: '1'
    provider: your-provider
    model: your-exact-model-id
    purposes: [conversation]
    trigger: output-pattern
    carryFromOtherRoute: false
    text: '检查上一份输出是否反复使用了限制性措辞；依据具体请求和证据继续完成已授权工作。'
    detector:
      detectorVersion: example-1
      locale: zh
      maxTextChars: 20000
      maxStatements: 200
      maxEvidence: 10
      maxPhrases: 10
      maxPhraseChars: 30
      phrases:
        - { id: claim, family: claim, literal: '不能宣称' }
        - { id: overlap, family: claim, literal: '宣称' }
        - { id: action, family: action, literal: '不会做' }
        - { id: wording, family: wording, literal: '不写成' }
      metaPrefixes: ['规则匹配', '词表示例']
      thresholds:
        - { minStatements: 5, minHits: 4, minHitStatements: 3, minDensity: 0.35, minFamilyStatements: 0 }
        - { minStatements: 3, minHits: 3, minHitStatements: 3, minDensity: 0, minFamilyStatements: 3 }
      windowOutputs: 3
      window: { minOutputs: 2, minHitsPerOutput: 2, minHits: 6, minFamilyOutputs: 2, minDensity: 0.25 }
      cooldownCompletedOutputs: 2
      rearmHealthyOutputs: 2
      maxDeliveries: 2
```

N 是有效正文语句数，K 是命中语句数，H 是合并重叠后的命中数，F 是命中类别数，J 是同一类别覆盖的最大语句数，D=K/N；源 offset 与证据数量有界。阈值列表内条件取 OR，每条条件内取 AND。滑窗使用最近 `windowOutputs` 个成功对话输出；重新启用要求连续可测且无命中的健康输出，unavailable 会打断健康序列。未知投递达到上限后保留审计并结束旧 pending，后续新完成证据仍能形成新反馈。

## 输出循环中止

模型偶尔会退化成「卡带」：末尾一大段里同一行反复出现。v0.3.0 只在下一个请求边界提醒它，
而那时整屏往往已经刷完、也推给了前端。现在改为**在生成过程中**动手。

管线是「检测模式 → 执行操作」两段式：引擎（`src/stream-watch.js`）只维护视图与调度，
判定归模式、行为归操作，两边都不认识「循环」这个概念 —— 加一种检测方式就是加一个判定器，
不需要动管线。

`line-repeat` 模式在流式阶段命中时，先中止这一轮（已生成的部分由 agent-loop 落成
`interrupted` 消息，不会静默丢），随后由插件唤醒并把原因说清楚 —— 因为界面只显示一个
「已停止」，不显示是谁、为什么停的。同一会话连着掐断两次就不再自动续，停在那里等人。

阈值比提醒那条路更严：提醒是「重复 ≥15 次且占窗口 ≥20%」，掐断是「≥30 次且 ≥35%，
或同一行连续 ≥12 次」。掐断宁可漏也不误杀 —— 长清单、代码、表格都可能出现稀疏重复。

性能上做了针对性设计，因为 delta 粒度是 1–4 个字符、一次回复上千帧：文本按块累积、
不做整串拼接与切片；行窗口与行计数在遇到换行时增量维护；标记匹配用滑动窗口，
成本与已累积文本量无关；昂贵的模式按累计字节节流，不到量引擎根本不叫它。

`agent/pre-step` 的提醒路径保留为兜底。两条路共用文案；被中止时文案会明确说
「不是你自己停下来的」，否则模型会以为自己正常收尾了。

除循环之外，流式管线还保留 `time-anxiety` 与 `context-anxiety` 两个历史模式名。它们只匹配思考块中的时间或上下文措辞，命中后投递提醒并让当前响应继续生成。词表命中不能判断心理状态或任务有没有真实期限。

文案署名 **Seraph · 上下文照料提醒**，沿用所参考的 S-forge 提醒名称。它是本插件生成的说明，没有接入心理医生服务。时间提醒依据真人给出的期限、当前时间和已知运行限制规划；没有提供的剩余额度保持未知。上下文提醒读取最近一次 `fatigue` / `wakefulness` 估计，结合工作步骤和计量安排维护；缺数值时提示查询 `context_status`。

循环提醒继续按先保存进度、再压缩的顺序处理。交接保留必要原文、准确事实和可查询的找回路径；原始日志仍可核对。维护完成后依据报告继续任务。

**降档暂未启用**：掐断后把接下来几轮的思考档位降下来（默认 `high`、维持 3 轮）的实现
已经在 `src/index.js` 里写好，但整段注释着 —— 需要先验证 `agent/request` waterfall 返回的
`reasoningEffort` 会不会被后面的解析覆盖，而且改档位会让请求头快照变化、缓存复用断一次。

## 完成表述的持久观察

宿主补丁还挂载 `dsh-context-care/completion`，独占 `context_care_completion` 存储域；会话预设不打开这个共享域。它只读取 `agent/assistant-stream` 的可见正文，排除思考、工具调用、代码围栏、引用和否定表述。块末尾与已到达的正文增量不会重复计入。同一会话的写入串行，按会话与生产者来源隔离 cooldown；attempt 是一次观察的 occurrence，不是新的来源。

发现完成表述后，先等待 pending 的持久写入确认，再根据真实日志结算。正常 `assistant/message` 可进入 cooldown；`assistant/attempt`、中断消息和 abandoned 流恢复 pending，不算成功完成。结算说明的是输出观察的生命周期，不证明实际任务完成。默认 cooldown 为 300000 毫秒，可在该 Host 行的 `config.cooldownMs` 中修改。成功观察另写 `context_care_completion_notices` 出箱，提醒核对实际交付与验证范围，等待下一次自然对话请求。`notifications: false` 可关闭投递，`maxObservedChars` 默认 65536，超限正文不测量；`maxDeliveries` 默认 2，限制 delivery-unknown 重投。只扫描权威 block-end 与最终提交正文，不积累无限增量或每片重扫全文。正常正文的实时发布不等待存储 ACK。

真实 storage-domain 服务是该 Host 行的必需依赖。打开或写入失败保留原始错误，不降级成内存写入；`contextCareCompletion.flush(sessionId?)` 等待观察写入并报告原始失败，单凭 Agent idle 不代表观察器已持久化。卸载观察器先移除监听、等待排队写入，再关闭 handle。状态由真实 JSON backend 保存并在重新打开后读取；恢复后首次自然请求用请求日志的实际派发与成功输出 seq 核对漏处理的完成通知，并记录已处理水位；结算后的 occurrence 标识补齐未写出的通知，其它 occurrence 继续遵守冷却。一次自然派发只使用最新符合路由的通知，其余旧通知被 superseded。过长会话/来源编码使用 SHA-256 存储键，保留原先可落盘的短键；已有 pending 保留，已消费 seq 不重复投递，失败记录不能被后续成功 attempt 改写。

## 缓存与模型体验

固定说明由 `systemPrompt.context` 生成可重放的 user 消息；动态状态通过 `agent/pre-step` 追加到最终消息队列末尾，角色为 `user`。不修改系统提示，不插入 system 角色状态，不改写既有消息。状态通知按**模型实际可见的文本**去重：只有疲劳/唤醒等级、建议或压缩结果发生变化时才追加消息；同一等级内的数值变化不触发新的模型消息，也不制造“每次都在逼近上限”的倒计时感；数值仍保存在最近一次状态消息的 `contextCare` 元数据中供界面投影，模型正文仍只包含等级和必要建议。首次挂载新增工具会改变一次工具定义；实际压缩会改变历史前缀，这两种必要变化不承诺保持原缓存。测试验证普通相邻请求的系统提示一致、既有消息前缀完全相等。

提示明确区分指标与事实：它们不证明记忆丢失、幻觉或能力下降，不构成任务时限；继续工作，在任务边界自主选择压缩。唤醒值低时按需查阅摘要和文件，不编造缺失事实，也不为提升指标填充消息。此设计减少上下文焦虑的诱因，不能保证某个模型绝不产生此类输出；尚未进行真实 DeepSeek 模型的对照效果评估。

UI 显示最近一次请求准备时的状态，与模型读取的同一条持久化消息对应。`contextCareNumeric` 投影支持会话重放；旧记录没有数值时显示“未校准”，不会根据等级反推百分比，下一次新版本采样后显示实值。它不是逐 token 更新的心理健康监测。

## 安装

### 安装本地修复包

在插件管理界面的包来源填写 tgz 的完整路径，或使用官方 CLI（将路径替换为包的实际位置）：

```sh
dsh plugin --profile desktop add "/absolute/path/to/dsh-context-care-0.7.3.tgz"
```

Host 代码更新后需要重启 DSH，再刷新页面；重新启用条目不会清除旧 Node 模块缓存。安装和重启通过官方管理流程完成。

### 从 GitHub 安装

确认 `v0.7.3` 标签已发布后可使用：

```sh
dsh plugin --profile web add "github:leolee9086/dsh-context-care#v0.7.3"
```

构建产物 `lib/` 已入库，装完即可用 —— 不需要额外构建，也不需要手工打包上传 tgz。带上标签安装，版本不会跟着分支漂。

安装不拉取 DSH 本体或内部包，也不需要 DSH 源码目录。所有 DSH 能力都通过 Cordis 的 `inject`、`ctx` 服务及事件参数取得；运行环境需预先提供这些服务。GitHub 安装按已发布标签固定版本，本地修复可直接使用 tgz；包清单不设置 `private` 发布拦截。**安装后挂载宿主补丁中的四行**（请求观察、完成观察、运行逻辑和显示入口）。`context-care-runtime` 负责全局工具、采样、维护与查询；`context-care-display` 只负责浏览器界面。关闭显示不会停止运行逻辑。

从 0.7.1 升级时，原 `context-care-display` 上的维护配置必须移到新增的 `context-care-runtime` 行，`name` 为 `dsh-context-care/runtime`；显示行保留 `name: dsh-context-care`。旧配置没有自动迁移。已在预设 `/agent` 行上的会话政策保持原位置。

1. 在 Web profile 的 `cordis.patch.yml` 中加入主入口。默认文件位于 `${DSH_HOME}/profiles/web/cordis.patch.yml`，未设置 `DSH_HOME` 时通常位于 `~/.dsh/profiles/web/cordis.patch.yml`。已有 `insert` 时，把行合并到相应列表：

```yaml
- insert:
    - id: context-care-requests
      name: dsh-context-care/requests
    - id: context-care-completion
      name: dsh-context-care/completion
      config:
        cooldownMs: 300000
    - id: context-care-runtime
      name: dsh-context-care/runtime
    - id: context-care-display
      name: dsh-context-care
```

2. **不需要改 preset。** `/runtime` 入口本身就对所有会话生效：工具在根作用域注册（按 DSH 的工具服务约定，根作用域注册进全局层，每个会话的视图都以它为基底），状态采样与压缩在 `agent/pre-step` 边界执行，唯一按会话的 compaction provider 在边界上用 `agentPresets.serviceFor(agent, 'compaction')` 现取；取不到时如实报告 `no compaction provider is available`，不影响其它功能。

   旧的会话内装法仍然可用且不冲突：如果某个 agent preset 的 compaction 隔离组里还留着下面这行，该会话就由 preset 里的实例负责，根入口检测到该 agent 作用域内已有注册后自动退让，不会重复通知或重复压缩。

```yaml
    - id: context-care
      name: dsh-context-care/agent
      config:
        budgetRatio: 0.8
        wakefulnessRatio: 0.3333333333333333
        fatigueExponent: 1.5
        retainRatio: 0.16
        minFreshTokens: 1024
        maxNoteChars: 10000
```

完整组示例见 [agent.example.cordis.yml](agent.example.cordis.yml)，宿主补丁见 [cordis.patch.yml](cordis.patch.yml)。`/runtime` 与 `/agent` 入口是等价的两种装法：前者一次覆盖所有会话，后者只覆盖挂载它的那个 agent 作用域。

重新加载 profile（未启用配置热更新时需要重启 DSH），刷新现有 Web 页面。首次有效请求采样后会显示数值；没有模型容量信息时显示“未校准”。

### 从源码开发

插件可以在任意目录独立安装、测试和构建，无需同级 DSH checkout，也没有 `link:../deepseek-harness` 依赖。运行时第三方库为 React、Zod、mdast-util-from-markdown 与规则引擎；Cordis 核心仅作为默认测试环境的 registry 开发依赖，不随插件运行时载入。

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

这个命令的测试宿主显式加载 DSH 来注入服务；该测试文件不会进入发布包，插件自身从不查找或导入这个路径。未指定路径时测试明确报错，不静默跳过。

本机开发可以用 `link:` 指向工作区（`dsh plugin --profile web add link:/absolute/path/to/dsh-context-care`），再按上面的步骤 1 挂载主入口。这是**仅限本机的开发写法**：跨盘的 `link:` 会让应用自带的 pnpm 在重建依赖树时创建符号链接失败（`ERR_PNPM_EPERM`），所以它只适合同盘、只适合开发阶段，发布的声明和安装说明一律用版本范围或 `#标签`。

### 注入接口

| 入口 | Cordis 注入服务 | 用途 |
|---|---|---|
| `/requests` | `agents`、`sessions`、`tools`、`llm`、`tokenMeter`、`storageDomain` | 请求计价、预算观察、持久请求记录与输出反馈 |
| `/completion` | `storageDomain`、`contextCareRequests` | 完成措辞观察、冷恢复与持久通知 |
| `/runtime` | `sessions`、`sessionProjections`、`tools`、`systemPrompt`、`tokenMeter`、`llm`、`webServer`、`contextCareRequests`（`agentPresets`、`compaction`、`connection` 为可选读取） | 全局注册 `context_status` / `context_rest`、系统提示段与请求边界处理；compaction provider 按会话现取；一次挂载覆盖所有会话 |
| `/agent` | `agents`、`sessions`、`tools`、`systemPrompt`、`tokenMeter`、`llm`、`compaction`、`sessionProjections`、`contextCareRequests` | 工具、状态采样、请求边界监听与压缩 |
| `/activate` | `agents`、`agentPresets`、`tools` | 找到指定会话并在其 Cordis 作用域中挂载能力 |
| 主入口 / 显示行 | 无 Host 服务依赖 | 仅挂载浏览器入口，不注册工具、维护事件或 HTTP 路由 |
| 客户端 | `slots`、`locale`、`uiConversation`、`sidebarRightTabs`、`sidebarRight`、`layout` | 数值和轻量记录按钮；预算与维护详情在当前会话右侧栏打开，会话投影使用插槽传入的 `useProjection` |

工具以标准 JSON Schema 和回调数据交给注入的 `tools.register`，配置使用 Standard Schema。插件只构造自身拥有的消息数据，消息入队、持久化、计量、模型路由和摘要执行由注入的宿主负责。`package.json` 中 `dsh.client.inject` 的包名是客户端依赖说明；实际激活由 Cordis 的服务注入决定，它们不是 npm 依赖或模块导入。

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
| `minNoteChars` | 1000 | 续接笔记 UTF-16 字符数下限（堵掉「随便写两句」） |
| `maxNoteChars` | 10000 | 续接笔记 UTF-16 字符数上限 |
| `contextBudgetTokens` / `billingInputCeilingTokens` | 未设置 | 政策合计容量 / 输入计费上限；可由 exact `routeBudgets` 覆盖 |
| `safetyTokens` / `burstTokens` / `releaseMarginTokens` | 0 | 硬预算安全量 / 软预算突发量 / 维护释放余量；部署应明确填写 |
| `summarySafetyTokens` | 跟随 `safetyTokens` | 摘要输入安全量 |
| `retainTokens` | 未设置 | 覆盖 `retainRatio` 的保留尾部 token 数，允许 0 |
| `maxOverflowRetries` | 1 | 同一请求序列的溢出恢复重试上限 |
| `maxPasses` | 继承，缺少公开配置时 2 | 普通维护继承对应路由的 `compactionRetries + 1`；显式设置覆盖该值，与摘要输入错误的 `summary.maxRetries` 分开 |
| `rangeStrategy` | basic-prefix | 最大完整前缀，或 target-prefix 的较小目标前缀 |
| `expectedCheckpointTokens` | 未设置 | target-prefix 必填的完整替换物预测价格；提交仍按实际输出检查 |
| `maxSummaryRepairRetries` / `maxSummaryCallsPerAction` | 未设置 | 同步修复次数 / 实际摘要派发次数的显式上限 |
| `summary` | 继承 provider 公开配置 | `provider`、`model`、`maxTokens`、`maxRetries` 覆盖 |
| `modelScopedPrompts` | 空列表 | 明确路由的静态、切换与输出模式规则 |
| `softBudgetRatio` / `hardBudgetRatio` / `hysteresisRatio` | 0.72 / 0.8 / 0.05 | 仅兼容旧配置及其合法性校验，不决定新请求阈值 |
| `auxiliaryBudgetRatio` | 0.12 | 仅兼容旧配置；摘要采用自己的完整硬输入预算，范围空间扣除系统、工具、提示和指令 |

比例必须大于 0 且小于 1，保留比例小于预算比例；计数上限必须为正整数。配置错误在挂载时拒绝。

## 验证与来源

验证本地实现可直接读取外部未修改的 Harness 源码，无需构建或改动 Harness：

```powershell
$env:DSH_TEST_CHECKOUT = '/path/to/deepseek-harness'
pnpm run test:integration:source
pnpm run build
pnpm run test:client:source
```

源码组合挂载发行 Host 入口及 requests/completion，实际启动自有端口的 HTTP 服务和 JSON 存储。测试检查路由与工具卸载、真实历史 seed 恢复、完成冷却及崩溃补写、一次性大提示校准、约 5.102 倍输入校准后的十步不重复压缩、完整摘要预算和有限溢出恢复。测试目录、临时存储与端口都属于外部测试，不改部署与现有 GUI。客户端装配测试读取实际发行模块工厂，在外部 Host 提供的真实 SlotRegistry、SessionProvider、框架 hook 和渲染器中运行，验证当前会话显示、分页、切换与卸载，并保存 DOM 快照；该测试是 jsdom 装配验收，不代表已安装到正在运行的 GUI。

`pnpm test` 验证曲线、百分比节流、范围配对、参数拒绝、失败、取消、卸载、数值投影与中文 UI，并检查 manifest、锁文件和运行时代码不引入 DSH 包。`pnpm run test:integration` 使用明确指定的真实 DSH Loader YAML、agent loop、工具注册表、token meter 与 compaction provider，仅模拟 LLM；检查摘要事务、工具结果顺序、继续执行、提示快照、投影重放和请求前缀。`pnpm run build` 生成客户端构建产物。

S-forge 来源：`kernel/nerv/magi/sages/token_counter.go` 的 `CalculateFatigue`、`CalculateWakefulness`，`sages/sage.go` 的末尾 user 状态消息，`prompts/core.go` 与 `coordinator/heartbeat_downtime.go` 的深度休息策略。Codex 参考：`codex-rs/core/src/session/token_budget.rs` 与 `compact_token_budget.rs` 的上下文管理入口。详见 [设计记录](DESIGN.md)。

## 已知限制

计量采用插件入口完整请求的近似文本校准和独立视觉价格，缺少匹配样本时退回估算，不声称 tokenizer 精确计价。公开图片计价能力没有持久 generation 标识；维护预估冻结当时可见投影，ready 检查 prepared 请求的完整输入。未提供图片投影的路由使用固定估算。官方 0.2.0-rc.2 没有最终 adapter 派发观察事件；插件检查后，第三方 middleware 若再改变路由、正文或工具，变化不会自动反映在本插件的日志和预算中。

本插件关联自身构造的 prepared call；其他插件若另建独立调用，应保留其 Agent 请求生命周期，否则本插件不能推断未关联调用的输出来源。自动摘要使用提供方公开的 LLM 摘要配置；没有该配置的自定义提供方仍委托其 `compactRegion`，其内部计价和提交行为由提供方负责。本插件不改写 basic 的直接手动 API，也未为自定义 provider 的内部错误修复增加新接口。

预算与维护详情读取请求日志，改写卡片读取既有改写记录，模型反馈按自己的持久状态投递。摘要质量取决于提供方；失败报告不声称压缩完成。插件不提供长期记忆或自动 artifact offload；重要不可替代信息应保存到文件。真实组合测试模拟 LLM，尚未测量真实模型的行为改善幅度。

## 赞赏

如果这个项目帮到了你，欢迎通过 [爱发电](https://afdian.net/a/leolee9086) 支持。