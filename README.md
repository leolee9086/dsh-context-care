# dsh-context-care

[![版本](https://img.shields.io/github/v/release/leolee9086/dsh-context-care)](https://github.com/leolee9086/dsh-context-care/releases)

**DeepSeek Harness 的上下文状态与自主压缩插件。** 界面同时显示疲劳度和唤醒值的百分比、等级与颜色；模型可在任务边界主动请求历史压缩，保留续接笔记并继续工作。

参考 S-forge MAGI 的指标曲线和 Codex 的上下文生命周期设计，以独立 Cordis 插件接入，不修改 Harness、S-forge 或 Codex 源码。本文档以中文为主。

> 发行版本：`v0.8.1`，面向官方 DSH `0.2.0-rc.2`。安装 GitHub 版本前确认对应标签已经发布；本地修复包可使用下文的 tgz 装法。源码组合验收使用显式外部 Host 的 `pnpm test:integration:source`，不依赖残留构建产物；桌面产物验收由 Electron 从其封装目录只读加载官方模块。

## 指标与行为

疲劳度采用 `min(100, 100 × (上下文估算量 / 策略预算)^1.5)`；唤醒值采用 `min(100, 100 × sqrt(保留历史估算量 / (模型容量 / 3)))`。默认按 30、60、85 分段；界面显示 0–100% 数值（最多一位小数）和等级，模型正文仍只报告等级，不显示剩余 token 倒计时。疲劳度四段依次为绿、蓝、橙、红；唤醒值依次为橙、蓝、青绿、绿。未校准使用灰色。容量取最近记录请求的真实路由模型；尚无容量时显示“未校准”。疲劳度以完整请求压力为基础，唤醒值以保留消息量为基础，因此工具定义和系统提示不会被当成丰富的历史经验。状态与自动维护使用插件自己的输入计价：公开 `tokenMeter.estimateMessage` 提供固定文本估算，保留 surface、工具定义和本轮待进入的输入共用冻结的计价依据，输出计费量不参与下一次输入预算。插件请求日志从符合条件且 header 匹配的成功 prompt 样本校准文本、schema 和 framing；没有样本时文本倍率为 1。图片视觉价格不重复乘倍率，有效大倍率不截断。旧 `providerUsageRatio` 配置只保留迁移提示。此版本使用官方 0.2.0-rc.2 已有接口，不要求新增 `measureInput` / `priceMessages` 方法或修改宿主。

`context_status` 查询状态。`context_rest` 提示建议续接笔记为 1000–8000 个 UTF-16 字符，内部默认保留 10000 字符的宽限；笔记排入持久化收件箱；当前工具批次完成后，在下一次请求准备边界执行一次压缩。笔记、近期历史、工具调用与结果配对均保留。它读取预设 compaction provider 的公开摘要配置，在插件内执行摘要事务；自定义提供方未声明 LLM 摘要配置时仍调用其执行接口。摘要保留原记录并让任务继续。容量未知时，主动请求仍选择历史前缀，按显式 `retainTokens` 保留尾部；未设置时保留最近完整单元，再交给摘要路由或自定义 provider 处理实际输入。自动维护在可算出压力阈值时启动。摘要指令分别记录原始明确要求、执行者的实现选择、推测和完成状态，并依据最新纠正更新来源归属。

组合中 basic 设置 `auto: false`，保留摘要执行服务；context-care 按会话分别维护迟滞状态，选择普通维护动作。工具结果 pruner 按会话在边界现取，裁剪完成后重测，再决定摘要。普通主动休息在同一边界已被自动维护改写时不重复执行；显式深度休息仍执行自己的交接与找回路径；旧摘要和状态不计为 fresh，系统提示也不能让状态前缀通过 fresh 门槛。维护从 `budgetRatio × 有效容量` 的软阈值开始，直到输入严格低于释放目标或动作次数耗尽。通知通道、提示规则与循环提醒先收集，再参与维护计价；预计状态消息也纳入输入。一次维护先等待上一轮请求结算的存储 ACK，再在入口捕获文本倍率、图片定价与文件 handle 投影，裁剪后、摘要后和深度替换前后均用这份价格重算。成功用量或 adapter 定价在维护期间改变，只影响后续操作；图片视觉价格保持独立，不乘文本倍率。最终请求检查使用 ready 捕获的实际图片定价，明确未提供图片投影时保留固定估算。

显式 `deep: true` 使用完整交接与找回路径替换历史，不调用摘要模型。交接在同一输入计价依据下必须比选区更小，否则保留历史并报告失败；持久化 shadow 使用固定 heuristic。成功的交接已在 replacement 中，本轮不再重复提交排定请求的正文。

普通维护候选按新内容摘要、相邻旧检查点合并、仍有真实压力时的合法前缀兜底排序。`rangeStrategy: basic-prefix` 保留最大完整前缀；`target-prefix` 需要显式 `expectedCheckpointTokens`，按预测降幅选择能覆盖释放缺口的较小完整范围，无候选覆盖时选择预测收益最大者。预测与实际摘要输出分别计价。至少两个旧检查点且仅夹有照料状态时可合并；单个检查点不满足主动合并，真实压力仍可走兜底。日志增长和照料状态变化不会重新启用已验证无收益的同一候选，来源任务内容、有效价格或路由政策改变后重新评估。来源覆盖递归展开原记录、裁剪替换与前代摘要，深度表示加工次数，不表示保真度。

裁剪、摘要与深度替换共享单会话维护占用；其它会话独立推进。卸载取消排队和正在执行的操作并等待清理。摘要错误同步委托既有 `compaction/summary-error` listener；重试要求选区内部的新持久替换或已记录图片 offload、固定摘要价格下降、选区外内容与 header 不变。端点替换根据来源重映射，空 `true` 不授权重试。`maxSummaryRepairRetries` 和 `maxSummaryCallsPerAction` 可显式配置；缺省由每次必须新缩减的条件终止修复，真实派发才消耗调用名额，本地拒绝不消耗。

若规范 `IMAGE_OFFLOAD_REQUIRED` 错误因 LLM 的终止失败归一化而未被原 listener 接受，插件只在已有 `image/offload` 消息投影已挂载时适配结构化失败。它记录选区内请求数量的最旧未卸载图片；选区外图片保持原样，仍须通过相同的持久修复和价格下降检查。修复 listener、审计 ACK 或事务闭合再失败，不替代原始摘要失败。

## 预算与维护详情

输入框工具栏、模型选择器前的右栏图标打开当前会话的“预算与维护记录”；输入框下方仅显示状态指标。右栏概览突出完整输入、硬限额和使用率，计价与保留策略可展开查看实际路由、物理与政策容量、文本校准来源和样本、独立视觉价格、软阈值、释放目标、尾部与输出预留。维护详情展示选区规则、候选预测降幅、同价前后输入、路由与固定估价降幅、旧来源到新检查点的替换、递归覆盖及加工深度，以及提交、部分进展、失败和无收益结局。深度休息的 operation 与检查点事务显示为同一动作。

维护列表每条显示动作、状态、时间和输入变化，点击进入单条详情，返回时保留键盘焦点。详情先显示同依据输入前后与降幅，再显示原因、替换、来源、摘要调用和审计。来源与原始覆盖按 20 条分页，可按序号检索；覆盖默认只显示数量、加工深度与范围。原始 JSON 需要主动打开，完整数据仍保留。面板正文独立滚动，底部页码与分页按钮持续可达，每页 20 条，在当前会话内翻页；顶部刷新可立即重读，加载失败在面板和状态行显示具体 HTTP 或读取错误，并可刷新重试。显示样式使用 DSH 的语义颜色、辅助字号和字号缩放变量，保持键盘焦点可见。改写记录失败会单独报告，按退避间隔重试，恢复后清除错误；修复、审计和事务闭合的二次失败保留原始错误码与消息，同时单独报告和记录。会话检查点可补回已存的摘要路由、摘要输入/输出 usage、来源数量、固定 shadow 估算与替换范围。记录区分完整动作审计、部分动作审计和仅有会话提交事实；缺少历史审计不证明写入失败，也不推断历史触发原因。摘要 usage 与被替换内容的固定估算分别展示，不冒充完整主请求输入的前后价格。新选区规划与执行共用 operationId，自动、主动和溢出触发原因贯通；一个动作的多个摘要事务归并，部分提交后的失败仍保留。旧 selection 没有稳定关联编号时独立展示，不按时间强行匹配。客户端使用框架生成的响应式 hook，切换会话取消旧页请求，卸载停止轮询和未完成请求。Host 只读路径 `/context-care/actions?sessionId=...&limit=20&offset=0` 要求会话和显式页大小（1–200），继承已安装连接服务的鉴权并返回 `no-store`；响应不包含系统提示、工具 schema 或原始输出。

## 提示详情与溯源

输入框工具栏的第二个图标打开当前会话的“提示详情与溯源”右栏页签。会话内的本插件通知卡片也提供详情入口，按持久事件序号定位到历史所在页并展开；翻页后再次点击同一条通知会重新定位。右栏读取完整持久会话与 Host 记录，不依赖聊天窗口当前加载的消息范围，每页 20 条，支持刷新和切换会话。

目录覆盖状态、规则提醒、watch/resume、通知通道、循环与主动维护通知、请求专属的模型切换/静态/输出反馈/完成观察段落、可精确识别的系统照料说明、辅助摘要指令，以及有本插件所有权证据的摘要/深度交接检查点。详情保留实际包装正文，展示发布者、时间、事件或请求编号、当时的触发依据与规则快照、持久规则评估、关联请求的阶段与派发标记，以及来源事件的节选。来源正文超过 2000 字符会明确标为节选，提示正文不截断。规则评估只按稳定 evaluationId 关联；辅助摘要请求只引用实际选区与系统头，完整 surface 采样另存，避免把未发送历史列作摘要来源。

提示目录用可读摘要列表进入单条详情。已知规则、触发与判定值显示本地化说明，未知自定义字段有界阅读并保留原始记录。完整包装正文可展开阅读与精确复制。来源按 20 条分页，支持序号或节选搜索；来源、检查点及持久提示/请求记录提供“定位消息”。导航使用正式会话分页和 Chat 投影的精确身份，原生展开后滚动到目标，只有目标进入可见视口才报告成功。历史工具结果补载调用与根调用；切换会话、新点击或卸载取消旧定位。被检查点替换或仅存在于日志的来源可能没有聊天节点，此时明确报告，不跳到附近消息。系统说明的日志 revision 不是消息序号，不提供伪定位。

提示存于既有 user/message、request/header 元数据及插件 Host 存储；不会新增会导致官方读侧拒载的会话事件类型。规则评估和请求改写也使用插件自己的持久域，缺少可选索引插件时仍可重载。写入失败保留到 flush 并在查询中报告。旧提示没有结构化依据时明确注明；旧请求记录仅保存段落时不称其为原始完整包装正文。系统说明只提取可精确识别的本插件贡献，不展开相邻的其它系统指令；无法识别的历史版本暂不能可靠拆分。检查点只有插件审计关联或明确 producer 标记才能进入本插件提示目录。

Host 查询 `/context-care/prompts?sessionId=...&limit=20&offset=0` 继承连接鉴权并返回 `no-store`；可选 `seq` 定位对应页，并返回 `offset` 与 `selectedFound`。缺少可读取会话返回 404，来源不存在、存储失败与 HTTP 错误会明确显示。请求的 `dispatched` 表示交给 prepared stream，不证明 adapter 内 HTTP 已发包；无请求审计时保留未知。

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

## 会话规则控制（未发布开发版）

输入框工具栏的“打开会话规则控制”进入当前会话的右侧栏。规则可以搜索、暂停、恢复声明默认值；同一条规则的提醒、中止、续接、清理、自动维护等动作分别控制。续接依赖同次成功中止，关闭提醒不会自动关闭保护，关闭保护也不会自动关闭提醒。暂停保留动作选择，恢复默认值只清除该条规则的覆盖。

每条规则显示注册插件、注册入口和执行插件。注册插件是来源显式声明的身份，**不是平台认证**；旧 `memoryNoticeRules` 或未声明身份的通知源显示“未声明（旧接口）”，不会从服务名推断注册插件。请求改写执行者缺失、依赖关闭、来源卸载及存储失败都有可用性说明。

偏好按 `(sessionId, sourceId, ruleId, actionId)` 隔离，持久化由唯一 `/requests` Host 的 `context_care_controls` 域负责。界面只在持久写入 ACK 后显示“已保存”，串行 CAS 拒绝旧 revision。保存失败保留旧已确认值并暂停该会话的自动执行；错误保留到成功重试，后台轮询不会悄悄清掉保存错误。右栏不直接操作 Harness 或预设。

保存影响后续执行，历史消息、已派发请求及已经开始的外部操作保留。请求在投递预留 ACK 后、启动准备好的流之前复查偏好与来源生命周期；此期间切换会明确返回 `CONTROL_CHANGED` 并记录“未派发”。明确未启动的通知预留会归还本次投递次数；崩溃后的未知投递仍保留原有重放上限。禁用的动作不接收新检测证据，也不消耗该期间命中的冷却或去重；重开不回放关闭期间的旧证据。状态报告和附带建议独立控制，关闭报告后界面的请求边界数值采样继续更新，主动 `context_status` 和维护工具的实际结果仍可读取。硬输入预算校验继续约束请求。

公开 `contextCareControls` 服务允许其它插件贡献目录，注册和卸载应绑定 Cordis effect：

```js
// 本插件的 inject 声明需包含 contextCareControls。
ctx.effect(() => ctx.contextCareControls.register({
  sourceId: 'example-memory:rules',
  plugin: 'example-memory',
  registration: 'memory/rules',
  executor: 'dsh-context-care',
  rules: [{
    id: 'remember', title: '保存已验证记忆',
    actions: [{ id: 'notify', defaultEnabled: true }],
    definition: {
      order: 10, placement: ['user'], when: { said: '/MEMORIZE/' },
      action: { kind: 'notify', by: 'context-care', say: '保存已经验证的记忆，再继续工作。' },
      cooldownMinutes: 10, oncePerSurface: true,
    },
  }],
}))
```

规则和动作 ID 必须稳定；同来源 ID、重复动作、缺失或循环依赖及交给本执行器的非法引擎定义会明确拒绝。`definition.action.by: 'context-care'` 的动作 `kind` 必须对应目录动作 ID；声明目录本身不会创建其它插件的执行器。自行执行动作的插件应在实际操作前调用 `controls.enabled(sessionId, sourceId, ruleId, actionId)`，并在异步等待后复查。可用性由动作 `available/reason` 声明。

`contextNotices.register(name, source, { plugin, registration })` 贡献一条通知源规则。拉取上下文含 `controlEpoch`、`sinceSeq`；源应返回通知的原始 `sourceSeqs` 事件依据。发生控制编辑后，只有全部依据序号晚于边界的通知可投递。旧接口未提供 `sourceSeqs` 时，切换后的通知被阻止并记录警告，面板也说明此限制；不能把当前请求序号补给旧积压内容。等待中的回调跨过开关切换或来源卸载时，结果被丢弃且不记投递账。

同源 GET/PATCH `/context-care/rules?sessionId=...` 使用公开 Connection 鉴权；未挂载 Connection 返回 503，未鉴权返回 401/403。PATCH 接受 revision 与一个动作切换、暂停或 reset；拒绝非法 Origin、媒体类型、超限正文和坏 JSON，响应 no-store。客户端在发布响应给视图之前校验嵌套规则与动作，坏响应和写失败明确显示。

v2 规则由 AI 编写为声明，或由外部插件通过 `contextCareWorkbench.register` 贡献文档；本插件负责校验、匹配、执行、会话开关与来源状态。DSH 内不提供规则 JSON、文档、变量或模板的编辑器，代码编辑能力由独立插件承担。后端已支持严格 Handlebars 模板、类型化 JSON 输入绑定、条目注入、请求副本替换与过滤，以及通过正式工具策略和审批执行的输出触发程序。预览使用同一规划逻辑且不写入文档、动作队列或会话日志；实际派发记录请求差异并保留提交原文。来源按贡献对象和会话范围显示。原内部 `contextCareWorkbench` 名称保留，它不代表界面工作台。

`output.delta` 在真实请求流的可等待 chunk 边界检测，仅使用当前流块的正文或思考文本；不扫描完整历史、不处理未完成工具参数。流身份包含会话、请求、attempt 和块索引，没有提交序号的流不伪造 `seq/path`。支持实时取消、依赖取消成功的续接和 next-step 提醒；同一规则在一个流块内只触发一次，即使匹配范围随文本增长或声明 `dedupe: none`。开关、来源或变量版本改变会重置未触发文本，结束和取消清理流状态。requests Host 配置 `maxDeltaChars`（默认 32768，每块 UTF-16 字符）和 `maxDeltaBlocks`（默认 16）限制保留量；超限明确报错并停止该请求，不静默裁切后改变正则锚点。没有开启的流式动作时不保留流文本。

`display.render` 对内容确实发生变化的消息显示轻量处理标记，点击后在右侧栏查看原文与变换后对照；未命中或变换后与原文相同的消息不显示标记。消息渲染不发起详情请求，不为每条消息轮询。支持已提交的 user/system/assistant 消息和工具结果里的文本、思考块替换、过滤及文本注入。原生消息、模型输入和会话日志保持原样；规则文本按普通文本转义，不执行 HTML。只读 GET `/context-care/display?sessionId=...&seq=...` 要求连接鉴权、返回 no-store，客户端卸载或切换消息会取消读取。读取失败时右栏显示具体请求路由、失败阶段与已收到的 HTTP 状态。连接失败、响应体读取失败、JSON 格式错误和内容验证失败分别报告；即使底层都显示 `Failed to fetch`，收到 `HTTP 200` 后响应体中断也不会被混作连接失败。非 JSON 的 HTTP 失败仍保留状态码，显式刷新才重试。历史副本采用当前开关、变量和声明，重复渲染不消耗自动动作的冷却、去重或寿命。匹配窗口止于该事件，原文与 display 块具有相同来源编号；所有动作对同一基线规划，不逐动作重新匹配。字符预算沿用 `maxInjectedChars`，副本结果受 `maxRequestBytes` 限制，正则仍由可终止 worker 执行。注入锚点局限当前消息（start/end/matched/当前块编号，depth 只接受 0 或 1）；不支持 model 选择、跨块写入、结构化工具参数改写及跨轮/会话显示寿命，目录明确标为不可用。签名或不透明思考块不允许替换、过滤；非文本块在对照卡标明类型，完整媒体继续由原生消息显示。

requests Host 的 `config.matcher` 可配置 worker 的 `timeoutMs`（默认 250）、`startupMs`（默认 10000）、`maxBytes`（默认 4194304）、`maxPending`（默认 4）和 `maxIdle`（默认 2）。无当前阶段规则时不启动线程；只准备当前规则选择的视图。显示读取独立使用最多两个并行 worker，不占请求匹配接纳额度。超时诊断区分启动、传输与已开始处理的阶段，并记录规则身份、输入大小与父线程观察到的计时；这些计时不等同于精确 CPU 耗时。

匹配失败明确保存为 `kind: matching, status: failed`，包含规则、阶段、错误原因、来源序号与重复次数，不保存消息正文，也不伪造未命中或执行成功。输入区提供故障入口，右栏可读完整诊断。默认可选的请求变换或输出观察失败时，保留完整输入并继续；失败规划的局部改写和动作不派发。若请求变换是派发的必需前提，在 requests Host 明确设置 `requiredStages: ['request.assemble']`，失败返回 `CONTEXT_CARE_MATCH_FAILED` 且不派发请求。工具阻止判定失败只拒绝对应工具操作，并将判定失败写入工具结果；不声称规则已经判定应阻止。失败观察更新尝试水位，故障记录仍保留，旧事件不会在每轮无限重试。显示模板与显示预算的规划失败另记为 `kind: display, status: failed`，错误码为 `CONTEXT_CARE_DISPLAY_FAILED`，显示标记和右栏故障入口可追踪；这类呈现错误不会中断对话。

完成输出与工具结果匹配保留截至当前事件的历史窗口。触发序号独立于窗口来源序号：只匹配到旧内容不会触发，也不会占据独占组；重新启用允许新输出使用历史作为上下文，但不回放开关之前的输出。规则版本与新增条目在文档保存事务中记录提交时已有的事件序号，未变更的版本保留原起始序号；外部注册取注册时的会话尾部。Host 重新打开与会话恢复、fork 后从已有尾部开始观察；基线扫描只读取当前会话视图，视图替换不会删除原始事件或重置轮数。来源注册和捕获的规划状态仍在执行前复查，异步匹配使用真实轮次取消信号。

规则的 `actions[].template` 与注入条目的 `template` 直接声明提醒或上下文文本。模板可读取 `vars`、`captures`、`facts`、`block`、`tool` 与 `session.id` / `session.turnId`；有依赖的动作还可读取 `results`。例如以下文本可以直接写入模板字段：

```handlebars
请核对 {{vars.taskName}}：刚才匹配到「{{captures.[0]}}」。
{{#if (eq vars.mode "continue")}}核对后继续工作。{{else}}先说明当前状态。{{/if}}
{{#each vars.checks as |check|}}{{@index}}：{{check}}
{{/each}}
```

`captures.[0]` 是正则完整匹配，`captures.[1]` 是第一个捕获组；命名组可用 `captures.groupName`。所用变量须在文档的 `variables` 中声明。命名模板通过 `partials: [{ name, revision, template }]` 声明，再以 `{{> reminder}}` 引用。提供 `if`、`unless`、`each`、`with`、`eq`、`json`、`regexEscape`；使用 `{{json vars.value}}` 输出 JSON，`regexEscape` 用于转义正则字面量。程序输入保持 JSON 类型，例如 `inputs: { count: { bind: 'vars.count' }, text: { bind: 'captures.0' } }`；数值不会先变成文本，也不会把捕获文字拼成 shell 指令。

模板缺字段会明确报错；插值只做一次，捕获中的 `{{...}}` 保持字面文本。提示文本保留 `<`、`&` 和显式换行。快照仅接受 JSON 数据，拒绝函数、取值器、类实例和危险原型键。默认限制模板 16,384 字符、输出 65,536 字符、循环累计 256 次、命名模板深度 8 层；各动作还可声明更小的 `maxChars`。禁用动态 partial、partial block、decorator、`lookup`、`log` 和缺失 helper 的直接调用。自定义 helper 只由可信插件代码注册，文件声明不能注册 JavaScript；这些约束不等同于隔离不可信插件代码。

model 条目的 `lifetime` 决定已激活文本参与哪些请求。首次成功派发持久化渲染后的文本；后续请求重新生成请求副本并重新计量，不向历史反复追加同一段文字，也不再次解释文本中的 `{{...}}`。

| `lifetime` | 有效请求 |
| --- | --- |
| `request`（默认） | 当前请求；下一请求重新检测并渲染 |
| `turn` | 激活所在真实轮次的全部请求，包括工具后的模型步骤 |
| `turns` | 从激活轮起的固定 N 轮；必须且仅能附带整数 `lifetimeTurns`（1–10000） |
| `until-inactive` | 严格激活条件仍成立的请求 |
| `session` | 当前会话的后续请求 |

`stickyTurns` 从最后一次严格条件命中的成功派发轮次起延长有效期；只靠已有片段持有的请求不会延长 sticky。轮数读取持久 `turn/start.data.turn`，压缩后的消息数量不参与计数；没有轮次事件的种子视图记为 0。寿命到期且条件仍成立时，可以重新激活。片段文本在有效期内固定，变量修改会影响新激活和严格条件检测。条目关闭、token/cache 排除或预览不会消费新激活，也不会提前删除已保存的片段；重新开启时按当前轮次和条件检查有效期。

注入锚点按当前模型视图解析；旧块锚点被替换、移除，或深度超过当前消息范围时，整条注入跳过并记录 `injection-anchor-unavailable` / `injection-depth-anchor-unavailable`，依赖动作也跳过，文本不会自动移到末尾。无效角色、签名块改写与非法声明仍明确拒绝。

`cooldownMs` 是新激活之间的最小毫秒间隔，已有片段的逐请求复用不受它拦截。`activationCooldownMs` 是确认失活后的重新激活冷却，两者默认 0。冷却中的条目保留明确跳过原因并让出互斥组。激活与失活都经过同一派发预约和持久 ACK；失败、回滚和交付不确定不会伪造成功，旧状态或旧轮次的规划不能覆盖新的片段。重开恢复同一会话的片段；fork 按新会话隔离，不继承父会话的条目运行状态。display 条目只支持 `request`，不接受持久激活、sticky 或失活冷却。

升级 v2 开发声明时注意：条目 `turn` / `session` 表示每请求复用的片段；普通 `rules[].actions[].target.lifetime` 仍限制成功动作每轮或每会话执行一次。旧开发版本只保存 `lastStarted` 的运行记录不会被当作已渲染片段，新版本从下一次合格激活开始保存文本。

请求装配的字符预算是硬错误：单动作 `maxChars` 或 requests Host 的总 `maxInjectedChars` 超限，会明确拒绝规划并保留错误，不静默跳过或截断文本。`maxInjectedTokens`（默认 65536）采用公开 token-meter 的整条注入消息估计，包含角色开销；估计超限按规则优先级跳过整个注入，并记录 `injection-token-budget-exceeded`，依赖动作不进入执行队列，被跳过的注入不消耗寿命、去重或冷却。级联使用同一份剩余额度。无计量时预览标明 unknown，有 token 上限的注入拒绝以未知值入账。最终公开请求 JSON 的完整 UTF-8 字节量受 `maxRequestBytes` 约束，包含调用配置、系统说明、工具定义与全部消息；字节超限同样明确报错。

可选 `maxCacheChangedBytes` 限制完整请求 JSON 从第一个变动字节起的最大后缀字节量。规划对比相同 provider/model 下的原始请求与最终请求，包含所有级联变换；超限按优先级排除整个变换动作，重算依赖并记录 `request-cache-change-budget-exceeded`。若不可撤销的已有前缀变动仍超限，规划明确失败。请求副本的注入消息 ID 按稳定来源、动作、锚点与文本生成，相同规划不制造随机 ID 差异。预览显示估算注入 token、上限、未变动字节前缀和变动后缀，完整字节明细按需展开；**这些是公开请求 JSON 的估算，实际供应商序列化和 token 缓存命中数未知**，不将字节比值表述为缓存命中率。

经鉴权的 `/context-care/workbench` 保留查看、无副作用预览与任务取消诊断，拒绝 HTTP 文档编辑、变量编辑和导入；纯导入转换仍供插件代码调用。`compact` 动作通过正式 `context_rest` 工具链执行，真实摘要完成和同轮继续已有联测；排定维护与摘要实际完成分别记录。

现有“会话规则”侧栏包含四个视图：规则开关、声明与模板、运行任务、请求预览。声明视图显示文档版本、贡献插件与注册入口、规则及动作的阶段/依赖/模板/输入、条目、变量当前值、命名模板和执行者；完整声明与较大 JSON 只在主动展开时挂载。任务按状态和来源/规则/动作/原因检索，最新任务优先，每页 20 条，并显示请求预留或交付不确定的记录。取消成功响应表示请求已持久化，不证明正在执行的副作用被撤回。

管理接口为同源、鉴权且 no-store 的 GET/POST `/context-care/rule-runtime?sessionId=...`。GET 接受 `offset`（0–100000）、`limit`（1–100）、`status` 和最长 1024 字符的 `search`；POST 仅接受 `{ operation: 'preview' }` 或 `{ operation: 'cancel', runId }`。客户端校验嵌套响应和会话身份，读错误与取消错误分别保留。预览只由按钮触发，比较规则、变量、开关、执行可用性、运行状态与会话事件尾部的指纹；规划中状态变化返回 409，后续刷新发现变化会清除旧预览并提示重算。五秒刷新在页面隐藏时暂停读取，切换视图/会话或卸载取消旧请求。

规则声明也可通过 requests Host 行的 `config.ruleFiles` 指定绝对 JSON 文件路径，例如 `ruleFiles: ['D:/rules/session-rules.json']`。每个文件是一份 schemaVersion 2 文档，按 1 MiB 上限读取 UTF-8 JSON；不扫描目录、不导入代码。启动和请求装配/执行边界重新校验全部文件后原子发布。文档修改须增加文档版本，变更的规则、条目、partial 也须增加自身版本；纯格式变化保持原始触发边界。读取或校验失败保留上一版声明供查看并暂停 v2 自动动作，修复后恢复。

外部可信插件通过 `ctx.contextCareWorkbench.registerDetector(specification)` 贡献检测器，返回的异步 disposer 应绑定到插件卸载。注册包含 `plugin/ref/revision/on`、可选 `sessionId`、`paramsSchema/stateSchema/resultSchema` 和四个自包含同步回调：`initialize({ params, block, snapshot })` 返回 JSON state；`feed({ state, delta, params, block, snapshot })` 与 `finalize(...)` 返回 `{ state, result }`；`reset({ state, params, reason })` 返回清理后的 JSON state。规则使用 `match: { kind: 'detector', ref, revision, params }`。result 的 `ok`、`ranges`、`captures` 与 `facts` 接入统一证据校验；区间是当前原文的 UTF-16 半开坐标。无文本区间的事实检测可返回空 ranges。回调不能依赖闭包、模块导入或 Promise；跨帧状态必须显式放在 JSON state。

检测器与原生正则在可终止 worker 内运行，共用优先级与互斥决议。每次操作重建回调 VM realm；成功 worker 可复用，但全局变量不作为持久状态，schema 编译使用最多 16 项 LRU。state 按会话、请求、attempt、块、规则版本和 view 隔离，开关或版本改变、结束、取消与卸载会清理。每个 feed 的坏证据立即拒绝，不能由正常 finalize 掩盖；取消、超时和失败实际 terminate 并等待 worker。默认回调超时 50ms（可配 1–100ms）、单 state 256KiB、单 result 64KiB，另有聚合保留上限。**Node VM 不是防御恶意插件代码的安全沙箱；此接口只接受可信插件代码。**

独立纯入口 `dsh-context-care/declarations` 导出 `validateDocument(document)` 与 `importDeclarations(input)`；转换不挂载服务、不写状态、不执行动作。可用 `const { document, report } = importDeclarations(source)` 检查原生 schemaVersion 2、world-info 或 Tavern 正则数据，再由插件代码通过 `contextCareWorkbench.register({ plugin, registrationId, sessionId, documents: [document] })` 贡献。保留 disposer 并在卸载时调用；文档 ID 和注册 ID 应在贡献范围内唯一。HTTP 管理入口不接受导入或文档编辑。

Tavern 正则转换对照 [SillyTavern release 正则引擎](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/regex/engine.js)：支持 user/assistant/reasoning placement 1/2/6、明确 display 或 prompt 副本、g/i/m/s/u、数字与命名捕获及 `{{match}}`。g 转为独立 occurrence，最多 1000 次，每次捕获属于自身；Unicode 零宽扫描按码点前进。所有规则对不可变基线规划，重叠区间按优先级决议，**不等同于酒馆逐条修改前一条结果或历史编辑**。宏执行、非空 trimStrings、不等价 depth、未支持 placement 与历史原地修改明确拒绝；`runOnEdit` 和副本模式的差异、每个已出现字段与未知字段逐项报告。有效邻居保留，拒绝项不会伪装成成功转换。world-info 同样逐字段报告：支持常驻、主/次关键词及 ANY/ALL/NOT 逻辑、大小写/词边界、扫描窗口、稳定优先级和显式有限级联；概率、原酒馆计时与不等价注入位置不猜语义。

验证使用真实 Connection/Loader/storage-domain、官方客户端 Slot/Sidebar/Conversation 装配与独立包安装。真实供应商网络和模型效果不属于这些测试的证据；现场 GUI 安装版本按现有部署保留，发行开发树不会自动替换现场。

## 完成表述的持久观察

宿主补丁还挂载 `dsh-context-care/completion`，独占 `context_care_completion` 存储域；会话预设不打开这个共享域。它只读取 `agent/assistant-stream` 的可见正文，排除思考、工具调用、代码围栏、引用和否定表述。块末尾与已到达的正文增量不会重复计入。同一会话的写入串行，按会话与生产者来源隔离 cooldown；attempt 是一次观察的 occurrence，不是新的来源。

发现完成表述后，先等待 pending 的持久写入确认，再根据真实日志结算。正常 `assistant/message` 可进入 cooldown；`assistant/attempt`、中断消息和 abandoned 流恢复 pending，不算成功完成。结算说明的是输出观察的生命周期，不证明实际任务完成。默认 cooldown 为 300000 毫秒，可在该 Host 行的 `config.cooldownMs` 中修改。成功观察另写 `context_care_completion_notices` 出箱，提醒核对实际交付与验证范围，等待下一次自然对话请求。`notifications: false` 将完成提醒动作设为默认关闭，关闭期间不建立观察、不消耗新冷却；右栏可以覆盖这个默认值，`maxObservedChars` 默认 65536，超限正文不测量；`maxDeliveries` 默认 2，限制 delivery-unknown 重投。只扫描权威 block-end 与最终提交正文，不积累无限增量或每片重扫全文。正常正文的实时发布不等待存储 ACK。

真实 storage-domain 服务是该 Host 行的必需依赖。打开或写入失败保留原始错误，不降级成内存写入；`contextCareCompletion.flush(sessionId?)` 等待观察写入并报告原始失败，单凭 Agent idle 不代表观察器已持久化。卸载观察器先移除监听、等待排队写入，再关闭 handle。状态由真实 JSON backend 保存并在重新打开后读取；恢复后首次自然请求用请求日志的实际派发与成功输出 seq 核对漏处理的完成通知，并记录已处理水位；结算后的 occurrence 标识补齐未写出的通知，其它 occurrence 继续遵守冷却。一次自然派发只使用最新符合路由的通知，其余旧通知被 superseded。过长会话/来源编码使用 SHA-256 存储键，保留原先可落盘的短键；已有 pending 保留，已消费 seq 不重复投递，失败记录不能被后续成功 attempt 改写。

## 缓存与模型体验

固定说明由 `systemPrompt.context` 生成可重放的 user 消息；动态状态通过 `agent/pre-step` 追加到最终消息队列末尾，角色为 `user`。不修改系统提示，不插入 system 角色状态，不改写既有消息。状态通知按**模型实际可见的文本**去重：只有疲劳/唤醒等级、建议或压缩结果发生变化时才追加消息；同一等级内的数值变化不触发新的模型消息，也不制造“每次都在逼近上限”的倒计时感；数值仍保存在最近一次状态消息的 `contextCare` 元数据中供界面投影，模型正文仍只包含等级和必要建议。首次挂载新增工具会改变一次工具定义；实际压缩会改变历史前缀，这两种必要变化不承诺保持原缓存。测试验证普通相邻请求的系统提示一致、既有消息前缀完全相等。

提示明确区分指标与事实：它们不证明记忆丢失、幻觉或能力下降，不构成任务时限；继续工作，在任务边界自主选择压缩。唤醒值低时按需查阅摘要和文件，不编造缺失事实，也不为提升指标填充消息。此设计减少上下文焦虑的诱因，不能保证某个模型绝不产生此类输出；尚未进行真实 DeepSeek 模型的对照效果评估。

UI 优先显示当前进程最近一次请求边界的独立数值采样，关闭模型状态报告后仍更新。`contextCareNumeric` 的持久消息投影用于会话重放和没有新采样时的历史回退；旧记录没有数值时显示“未校准”，不会根据等级反推百分比，下一次新版本采样后显示实值。界面数值无需每次都向模型追加消息，也不是逐 token 更新的心理健康监测。

## 安装

运行环境需要 Node.js 22.19.0 或更新版本。当前修复树通过标准包依赖使用 `@leolee9086/dsh-rule-engine@0.3.0` 与 `dsh-better-session-query@0.1.1`，已移除内嵌副本。2026-10-10 已核对两个版本公开 npm 可用，实际下载内容的 SHA-512 与本仓库锁文件完全一致；独立消费目录已从公开 Git 提交安装插件，从 npm 取得两个依赖。旧 v0.8.1 标签保留其已发布内容，下面的旧版安装命令不会安装当前修复树。

刚发布的依赖受 pnpm 的 `minimumReleaseAge` 政策约束。本机 pnpm 11.7.0 与 12.6.0 的冻结锁文件安装都因两个版本未满24小时而失败；pnpm 11.7.0 的普通 `add` 成功，但自动在消费目录记录了两个精确版本的 `minimumReleaseAgeExclude`。这与无豁免安装不同。保持该政策且没有精确版本批准的环境应等待其发布时间窗口满足后再安装；本仓库不分发豁免，不修改消费者的全局设置。

GitHub 标签已包含客户端构建产物；包没有 `prepare`、`prepack` 或安装生命周期脚本。官方插件管理器的包来源可直接填写 `github:leolee9086/dsh-context-care#v0.8.1`。普通 pnpm 安装不需要 `allowBuilds`、`--ignore-scripts` 或 `blockExoticSubdeps` 例外。v0.8.0 的安装契约问题和历史验证限制保留在更新记录中。

### 安装发行包

在插件管理界面的包来源填写 tgz 的完整路径，或使用官方 CLI（将路径替换为包的实际位置）：

```sh
dsh plugin --profile desktop add "/absolute/path/to/dsh-context-care-0.8.1.tgz"
```

Host 代码更新后需要重启 DSH，再刷新页面；重新启用条目不会清除旧 Node 模块缓存。安装和重启通过官方管理流程完成。

### 从 GitHub 安装

确认 `v0.8.1` 标签已发布后可使用：

```sh
dsh plugin --profile web add "github:leolee9086/dsh-context-care#v0.8.1"
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

### 独立视觉预览

`DSH_TEST_CHECKOUT` 指向官方源码目录后运行 `pnpm preview:build`，在本地浏览器打开生成的 `artifacts/ui-preview/index.html`。预览直接渲染生产组件，使用公开合成事实和只读主题 token，不启动替代 DSH 服务、不安装插件、不读取真实会话。可切换维护、提示与会话卡片及深浅主题。预览没有真实聊天，定位按钮只演示明确失败反馈；导航成功由官方客户端组装测试另行验证。

### 从源码开发

插件可以在任意目录独立安装、测试和构建，无需同级 DSH checkout，也没有 `link:../deepseek-harness` 依赖。运行时 registry 依赖为 React、Zod、Ajv、Handlebars、mdast-util-from-markdown，以及标准 rule-engine 和 better-session-query 包；不再携带依赖的源码副本。Cordis 核心仅作为默认测试环境的 registry 开发依赖，不随插件运行时载入。

作者发布时运行 `pnpm release:pack`，显式完成语法检查、单元测试和客户端构建后生成 `artifacts/` 中的 tgz，并将更新后的 `lib/` 提交到发行标签。消费者直接使用已发布产物；普通 `pnpm pack` 不承担作者发布校验。本包许可证为 AGPL-3.0-only；独立规则引擎包声明 AGPL-3.0-or-later，块读取包声明 MIT，各自保留其仓库、源码和许可证。本包完整对应源码与构建配置可从本仓库发行标签获取。

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

桌面产物检查显式设置 `DSH_TEST_RUNTIME_ROOT` 为部署内的 `app.asar/dsh`，用该部署的 Electron 可执行文件和 `ELECTRON_RUN_AS_NODE=1`、`--expose-internals` 运行 `test/integration.test.js`。`DSH_TEST_PLUGIN_ROOT` 可选择独立安装的候选插件；浏览器检查另需 `DSH_TEST_CHECKOUT` 提供 Playwright。Host 模块按公开包名从 ASAR 读取，测试存储和端口独立。2026-10-10 检查的实际 Host 引擎为 Electron 内置 Node 24.18.1；部署随带的 Node 24.21.0 用于包管理及独立进程，两者分别验证。

[历史传输诊断](test/diagnose-legacy-display-transport.js) 要求显式 `DSH_TEST_RUNTIME_ROOT`、`DSH_TEST_LEGACY_ROOT` 和 `DSH_TEST_CHECKOUT`，且拒绝非 0.8.1 的历史目录。真实 msedge 读取独立 ASAR Host 的空规则及真实 matcher 故障响应；另设 `DSH_TEST_DESKTOP_EXE` 和 `DSH_TEST_DESKTOP_MAIN`（必须指向部署的 `app.asar/lib/main.js`），会复制 Electron 引擎到测试临时目录，使用独立 profile、隐藏窗口和测试 socket 通信。执行部署中的 scheme 注册与转发函数，原版 reader 经真实 `dsh-app://app` 读取同一 Host，再检查响应头前断连、响应体中断和拒绝连接。`DSH_TEST_DISPLAY_COUNT=64` 检查并发卡片和原版两秒轮询；`DSH_TEST_READER_ROOT` 可选择本候选的 reader，检查阶段、状态和按需读取。测试不修改所选安装或现有 GUI，不使用 fetch mock；合成故障证明错误传播机制，不能据此断定历史10:29的具体触发。

源码组合挂载发行 Host 入口及 requests/completion，实际启动自有端口的 HTTP 服务和 JSON 存储。测试检查路由与工具卸载、真实历史 seed 恢复、完成冷却及崩溃补写、一次性大提示校准、约 5.102 倍输入校准后的十步不重复压缩、完整摘要预算和有限溢出恢复。测试目录、临时存储与端口都属于外部测试，不改部署与现有 GUI。客户端装配测试读取实际发行模块工厂，在外部 Host 提供的真实 SlotRegistry、SessionProvider、框架 hook 和渲染器中运行，验证两正式页签、通知原位定位、精确包装正文、重复定位、刷新、分页、会话切换、HTTP 错误与卸载，并保存 DOM 快照；该测试是 jsdom 装配验收，不代表已安装到正在运行的 GUI。

`pnpm test` 验证曲线、百分比节流、范围配对、参数拒绝、失败、取消、卸载、数值投影与中文 UI，并检查 manifest、锁文件和运行时代码不引入 DSH 包。`pnpm run test:integration` 使用明确指定的真实 DSH Loader YAML、agent loop、工具注册表、token meter 与 compaction provider，仅模拟 LLM；检查摘要事务、工具结果顺序、继续执行、提示快照、投影重放和请求前缀。`pnpm run build` 生成客户端构建产物。

S-forge 来源：`kernel/nerv/magi/sages/token_counter.go` 的 `CalculateFatigue`、`CalculateWakefulness`，`sages/sage.go` 的末尾 user 状态消息，`prompts/core.go` 与 `coordinator/heartbeat_downtime.go` 的深度休息策略。Codex 参考：`codex-rs/core/src/session/token_budget.rs` 与 `compact_token_budget.rs` 的上下文管理入口。详见 [设计记录](DESIGN.md)。

## 已知限制

计量采用插件入口完整请求的近似文本校准和独立视觉价格，缺少匹配样本时退回估算，不声称 tokenizer 精确计价。公开图片计价能力没有持久 generation 标识；维护预估冻结当时可见投影，ready 检查 prepared 请求的完整输入。未提供图片投影的路由使用固定估算。官方 0.2.0-rc.2 没有最终 adapter 派发观察事件；插件检查后，第三方 middleware 若再改变路由、正文或工具，变化不会自动反映在本插件的日志和预算中。

本插件关联自身构造的 prepared call；其他插件若另建独立调用，应保留其 Agent 请求生命周期，否则本插件不能推断未关联调用的输出来源。自动摘要使用提供方公开的 LLM 摘要配置；没有该配置的自定义提供方仍委托其 `compactRegion`，其内部计价和提交行为由提供方负责。本插件不改写 basic 的直接手动 API，也未为自定义 provider 的内部错误修复增加新接口。

预算与维护详情读取请求日志，改写卡片读取既有改写记录，模型反馈按自己的持久状态投递。摘要质量取决于提供方；失败报告不声称压缩完成。插件不提供长期记忆或自动 artifact offload；重要不可替代信息应保存到文件。真实组合测试模拟 LLM，尚未测量真实模型的行为改善幅度。

## 赞赏

如果这个项目帮到了你，欢迎通过 [爱发电](https://afdian.net/a/leolee9086) 支持。