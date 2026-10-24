# reminder/v4 执行与持久化验收工作稿

截至 2026-10-24，工作树版本为 0.13.5，原生日志迁移已通过同一可执行树上的 release、完整 Source 和默认 benchmark，作为 v0.13.5 交付。生产请求、提醒和共享额度已移除重复 JSON 账本依赖，原生 Session 与规则定义决定恢复；旧 writer 仅保留独立调用方兼容测试。下文保留历史红灯及性能实验，不把旧测量当作最终树结果；单规则和历史基线的性能差异、最早 before 源码缺失均不被新 benchmark 掩盖。

## 测量范围与原始产物

[基准脚本](../test/benchmark-reminders.ts)实际创建 worker、加载同一个 [TS judge](../test/fixtures/reminder-benchmark.ts)，交替执行逐条与 batch 路径。没有替换 execute。它不执行候选投递、持久化、优先级/互斥策略或 deny-tool 授权，不能代替后面的真实业务测试。

| 项目 | before | after |
| --- | --- | --- |
| 报告格式 | `reminder-worker-benchmark/v1` | `reminder-worker-benchmark/v2` |
| 开始时间（UTC） | 2026-10-20T15:52:59.790Z | 2026-10-20T19:09:31.512Z |
| 结束时间（UTC） | 2026-10-20T15:53:55.107Z | 2026-10-20T19:10:32.770Z |
| HEAD | `159eaff1f048149352b7105580ed618ca4ad5bd2`，dirty | 同一 HEAD，dirty，工作树不同 |
| 原始文件 SHA-256 | `4e765a7957ecf56342e3d525c8087f9faf129b5a436f3d211b66673d33bf7da2` | `e04889b85c86889ab861f4509e794770093c20f607e9346356864ec69e72d211` |

两个报告的 Node v22.19.0、Windows 10.0.26200 x64、Intel i5-10400F、12 个逻辑处理器、64 GiB 内存一致。每组 3 次 cold、3 次 warmup、25 次 hot；条件/judge/混合三类 × 1/13/64 条规则 × 512/32768 字符，共 18 组。矩阵、配置、环境、逐组 workload hash 和 fixture hash 均已核对；两次测量各自运行前后的源码和实际加载产物 hash 未变。

fixture SHA-256 为 `684f3b16713dcf2d54dd877cb60f02be36734e711112f0290a2e7ac4bb1ec5f1`。输入字节是 JSON UTF-8 累计大小，不是 structured-clone 的线上字节。v2 的 dispatch 观测来自 worker `started` 回执；v1 观测点在发送前，两者不能直接解释成精确 MessagePort 通信计数。cold 只有 3 个样本，p95 相当于这三个样本的最大值，不据此作可靠尾延迟推断。

本地原始产物为 `.local/logs/benchmark-reminders-before.json` 和 `.local/logs/benchmark-reminders-after.json`；该目录受 Git 忽略，文件不随安装包分发。独占创建保护原件，后续实验不得覆盖它们。公开复核需要先取得与上述 SHA-256 一致的报告。

## 三种比较必须分开

1. **同路线前后比较**：旧 sequential 对新 sequential，旧 batch 对新 batch。完整原始结果（包括错误名称）与每个样本的摘要相同才计算比值。
2. **同次测量的路线比较**：after sequential 对 after batch。v2 比较完整 worker 结果，另行记录外层错误包装差异。
3. **跨版本路线切换**：before sequential 对 after batch，输出字段为 `beforeSequentialToAfterBatch`。它同时更换版本和执行方式，不说明同路线实现变快。

比值均为分子延迟 / 分母延迟；大于 1 表示分母路径更快，`null` 表示不具备可比性。旧版 12 组 judge/mixed batch 被 schema 拒绝，没有执行规则，其快速失败不构成性能收益。

### 热运行 p50（毫秒）

`—` 表示旧 batch 拒绝该 workload，故不列作有效执行延迟。最后一列仅为旧逐条 / 新 batch 的路线切换比值。完整未舍入样本、cold、p95、字节数和回执计数保留在报告及比较器输出中。

| 场景 | 规则 | 字符 | 旧逐条 | 旧 batch | 新逐条 | 新 batch | 路线切换比 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conditions | 1 | 512 | 0.660 | 0.779 | 0.744 | 0.901 | 0.732 |
| judges | 1 | 512 | 1.019 | — | 0.982 | 1.172 | 0.870 |
| mixed | 1 | 512 | 1.082 | — | 0.976 | 1.197 | 0.903 |
| conditions | 13 | 512 | 6.053 | 3.086 | 7.046 | 3.984 | 1.519 |
| judges | 13 | 512 | 8.451 | — | 9.216 | 5.716 | 1.479 |
| mixed | 13 | 512 | 8.979 | — | 8.607 | 5.231 | 1.717 |
| conditions | 64 | 512 | 27.226 | 12.886 | 31.125 | 15.862 | 1.716 |
| judges | 64 | 512 | 36.205 | — | 40.809 | 23.424 | 1.546 |
| mixed | 64 | 512 | 33.443 | — | 36.699 | 21.263 | 1.573 |
| conditions | 1 | 32768 | 0.770 | 0.827 | 0.804 | 0.891 | 0.865 |
| judges | 1 | 32768 | 1.408 | — | 1.169 | 1.294 | 1.088 |
| mixed | 1 | 32768 | 1.330 | — | 1.188 | 1.321 | 1.007 |
| conditions | 13 | 32768 | 8.007 | 3.292 | 8.544 | 3.859 | 2.075 |
| judges | 13 | 32768 | 11.205 | — | 11.610 | 6.340 | 1.767 |
| mixed | 13 | 32768 | 11.208 | — | 10.868 | 5.426 | 2.066 |
| conditions | 64 | 32768 | 38.454 | 13.104 | 39.360 | 16.338 | 2.354 |
| judges | 64 | 32768 | 50.378 | — | 52.678 | 25.926 | 1.943 |
| mixed | 64 | 32768 | 47.740 | — | 50.771 | 22.275 | 2.143 |

18 组热运行的旧逐条结果与新 batch 原始结果、逐样本摘要均相同。多规则路线切换的 p50 比值为 1.48–2.35；after 内部多规则 sequential/batch 的 p50 比值为 1.61–2.41。单规则不能据此笼统宣称提速。

### 必须保留的同路线回退

| 纯条件场景 | batch p50 before → after（ms） | batch p95 before → after（ms） |
| --- | ---: | ---: |
| 1 / 512 | 0.7789 → 0.9014 | 2.3515 → 1.2445 |
| 13 / 512 | 3.0863 → 3.9841 | 4.5476 → 5.3863 |
| 64 / 512 | 12.8859 → 15.8621 | 16.7029 → 18.2959 |
| 1 / 32768 | 0.8266 → 0.8908 | 1.5125 → 1.3032 |
| 13 / 32768 | 3.2920 → 3.8588 | 4.2859 → 6.5279 |
| 64 / 32768 | 13.1037 → 16.3381 | 16.5915 → 19.9888 |

历史测量的六组 batch p50 都变慢约 7.8%–29.1%。该次没有 CPU 采样，不能追溯性地把全部差异归因于某个函数。下面的新实验定位当前开销并只调整 schema 的创建位置，保留 checkpoint、取消等待、输入校验及逐条回执；不能用新实验覆盖这份历史回退记录。

### 当前实现的 schema 复用独立实验

[真实 Worker profiler](../test/profile-reminders.ts)通过实际 analyzer 把 Inspector 连接到执行规则的同一条线程，不替换 matcher。它复用原 benchmark 的 `conditions-64-32768` 工作负载，每条路线预热 20 轮、记录 200 轮，逐轮比较结果；[采样前报告](../.local/logs/profile-reminders-29/summary.json)和[采样后报告](../.local/logs/profile-reminders-31/summary.json)均确认全程一条实际线程、源码/产物 hash 稳定。`bounded()` 含子调用的采样占比约 22.2% → 8.9%，GC 约 10.7% → 3.5%。这是含 idle 的采样区间占比，子调用有重叠，不能相加或当成无插桩延迟。

生产改动仅在 [matcher](../src/reminder-runtime/matcher.ts)把事件快照与结果的 `z.json()` 提到模块级复用；每次仍执行相同的 `parse` 和字节限制，不缓存 match、judge 或解析结果。另以无 Inspector 的完整 18 组矩阵测量：[实验前原始报告](../.local/logs/benchmark-schema-reuse-before30.json)、[实验后原始报告](../.local/logs/benchmark-schema-reuse-after31.json)、[完整比较结果](../.local/logs/benchmark-schema-reuse-details31.json)。采样配置仍为 3 cold / 3 warmup / 25 hot，环境、fixture、workload、设置核对一致，18 组的 sequential 与 batch 各自跨版本原始 match/error 及逐样本摘要全部相同。

| 纯条件场景 | batch p50 实验前 → 后（ms） | batch p95 实验前 → 后（ms） |
| --- | ---: | ---: |
| 1 / 512 | 0.9810 → 0.8774 | 2.2966 → 1.2891 |
| 13 / 512 | 5.1013 → 3.2551 | 9.9283 → 4.2803 |
| 64 / 512 | 18.4192 → 12.3548 | 26.4954 → 17.5061 |
| 1 / 32768 | 0.9587 → 1.0307 | 1.8873 → 1.6247 |
| 13 / 32768 | 4.6312 → 3.5896 | 6.2354 → 4.8425 |
| 64 / 32768 | 16.4291 → 12.5688 | 23.1651 → 15.7816 |

四组多规则纯条件 batch 的 p50 降低约 22.5%–36.2%。完整矩阵中 15 组 batch p50 降低，3 组单规则反而升高：`judges-1-512` 约 4.8%、`conditions-1-32768` 约 7.5%、`mixed-1-32768` 约 7.5%；后者 p95 也约增 1.1%，其余 17 组 p95 降低。没有统计显著性或普遍提速声明，也不把该改动前后的结果当成最早旧实现的恢复证据。

实验前已保存 [367 文件源码/产物归档](../.local/logs/schema-reuse-before30.zip)及[逐文件 SHA-256 清单](../.local/logs/schema-reuse-before30-manifest.json)，压缩包内每个文件均与当时工作树逐字节 hash 对照。归档包含源码、lib、测试、脚本、文档、package 与锁文件及构建配置，不包含 node_modules、凭据或 Git 数据；尚未从归档解压重新执行测量。压缩包 SHA-256：`f1ee193c604b5473a4e037e8e71043942992b604859314e6bd574f93853cc61a`。实验前后报告 SHA-256 分别为 `e87a41008de50aa45fbe234eff943c9255c8772af82bbe093dafad63580b59dc`、`1407ae4eef69fbffbc81fe859a4890aa3e93f6d2579e94e60b0b901c3746107c`。

## 语义检查与诊断差异

旧单条 judge 异常记录原 `Error`；新单条通过 `MatcherFailure` 包装，保留原异常于 `cause` 并增加调度诊断；新 batch 的逐条回执仍保留原错误名称/消息。v2 仅在真实 `instanceof MatcherFailure` 且 `cause instanceof Error` 时投影一层原始 worker 错误。原始回执、包装和诊断仍保存，不删除 name 比较，不修改生产错误类名称。

after 的 worker 结果 18/18 等价；原始 API 结果 10/18 等价，其余 8 组多规则 judge/mixed 外层名称不同。旧 v1 未保存 cause 和完整诊断，不能倒推其内部异常；同路线跨版本比较因此拒绝为这些单条结果计算收益。完整 runtime 的诊断、持久化、授权和投递语义须另行验证。

基准内的独立检查实际运行 worker，然后用回执的修改副本验证六类比较器反例：错误名称、消息、缺失、重排、match 变化、协议错误均不能通过。新增的 [报告读取器测试](../test/reminder-benchmark-comparison.test.ts)另有 16 个纯数据用例，校验环境/采样/预算/矩阵/fixture/workload/样本/hash/分位数拒绝逻辑，并区分同路线回退、路线切换和旧 batch 拒绝；它们不冒充真实业务验收。

## 复核命令和复现缺口

[比较器](../scripts/compare-reminder-benchmarks.ts)不重跑 worker，只重算已有产物；类型检查和这两份真实报告的比较已通过。取得原始报告后，在仓库根执行：

```powershell
pnpm exec node scripts/compare-reminder-benchmarks.ts .local/logs/benchmark-reminders-before.json .local/logs/benchmark-reminders-after.json --summary
pnpm exec node --test test/reminder-benchmark-comparison.test.ts
```

当前实现可单独运行真实冒烟：

```powershell
pnpm build:host
pnpm exec node test/benchmark-reminders.ts --smoke
```

新完整矩阵用 `--output-file=.local/logs/<新的实验名称>.json`，与 `--output-before` / `--output-after` 互斥；所有产物仍独占创建，已有文件会拒绝覆盖。CPU 采样可运行 `pnpm exec node test/profile-reminders.ts .local/logs/<新的采样目录> 200`。不得在当前新实现上使用 `--output-before` 冒充最早旧基线。

**完整 before 源码快照尚缺**：两个 run 都是 dirty 工作树，HEAD 与源码 hash 能识别差异，但 hash 本身不能恢复源码。仅 checkout 上述 HEAD 不能精确重跑当时的 before。当前已能重算原始报告、运行新实现，但还不能声称已经满足“完整优化前源码可复现”的要求。

## 原 11 项证据映射

下表是证据清单和剩余验收，不把存在实现或测试文件写成最终通过。所有真实业务套件还需在最终工作树统一重跑。

| 项 | 原问题 | 当前实现/真实证据 | 尚未关闭的部分 |
| --- | --- | --- | --- |
| 1 | flush 失败后 dirty、重试与盘滞后 | 旧 dirty 快照 writer 已替换为 [persistence](../src/reminder-runtime/persistence.ts)实际事务 owner，状态仅在 ACK 后发布；[真实存储测试](../test/reminder-persistence-real.test.ts)覆盖 rename 失败、旧失败不能覆盖新 ACK | 当前没有后台自动重试；不能把冻结或下次请求重试当成自动恢复，失败后的业务恢复语义仍需复核 |
| 2 | close 等待不足丢快照 | [shutdown](../src/reminder-runtime/shutdown.ts)区分有限 caller close 与真实 drain；实际存储用例覆盖新 ACK 保留 | plugin-only 通过，但整 Host 补偿失败，见下节 |
| 3 | save 永久悬挂 | caller 有限等待与实际 I/O owner 分离；[真实策略测试](../test/reminder-persistence-real.test.ts)在 libuv 争用下不等待落盘阻断工具 | 有限争用不是永久 I/O；无法承诺永久 I/O 的硬取消或有界 teardown |
| 4 | batch 卡死耗整轮、未开始项误超时/重投 | [evaluation](../src/reminder-runtime/evaluation.ts)保留逐条回执，真实执行测试覆盖 rule termination 续后缀和 round exhaustion 不续 | 极窄 terminate 推进窗口尚无确定性真实复现 |
| 5 | solo resolve 抛错使结算永等 | 旧 `resolveAlone`/`settles` 分支已删除；[真实线程边界测试](../test/reminder-worker-boundaries-real.test.ts)分别让当前 `onDispatch`、`onItem`、`onTiming` 完成回调抛错，后续实际 judge 正常执行 | 当前回调路径已测；不把普通 judge 异常当成旧 resolve 回调的等价复现 |
| 6 | postMessage 失败使 worker 队列中毒 | [真实线程边界测试](../test/reminder-worker-boundaries-real.test.ts)触发两方向实际 structured-clone 失败；Worker 异常字段先校验为字符串，错误回执可完成且 batch 后续规则继续 | 原关闭端口触发点未单独复现；当前序列化发送失败已先红后绿，见下节 |
| 7 | 每轮重新编译条件树 | 注册期语义编译与执行期 [有界结构解析](../src/reminder-runtime/conditions.ts)已分开；malformed 条件真实用例阻止 judge；真实 profile 后复用 JSON schema，独立矩阵见上节 | 执行期仍解析/分配；单规则和历史基线差异仍需复核，不宣称零解析或全部场景提速 |
| 8 | 逐条预算没有生效 | [progress](../src/matcher/progress.ts)记录真实规则开始/完成；真实 batch 总时可超过单条而各条不超；CPU 终止用例 | 最终树重跑，且不能把执行 elapsed 当成纯 CPU 时间 |
| 9 | startup 错归 rule-timeout | [真实线程边界测试](../test/reminder-worker-boundaries-real.test.ts)覆盖实际冷启动期限和安装入口缺失；后者经 runtime 写入实际 JSON，恢复入口后同服务正常放行 | 定向及当前代码全量中的对应场景通过；整体发布门槛仍未通过 |
| 10 | judge 被重复执行 | 真实执行测试含仍运行 judge 不重入、priority/互斥调用前跳过；策略真实测试含重复 callId 不重复 judge | 最终树重跑；尚无极窄终止推进窗口实证 |
| 11 | acquire closed 后 claimed 残留 | 原问题指 Worker 启动认领，不是共享提醒额度；新 FIFO 没有旧 `claimed` 标记。[真实线程边界测试](../test/reminder-worker-boundaries-real.test.ts)在预热被任务认领、第二项排队时关闭，核对三项等待均拒绝、所有线程/任务归零且未调用 judge | 定向及当前代码全量中的对应场景通过；整体发布门槛仍未通过 |

早期真实红灯日志保留于 `.local/logs/`：`execution-real-red.log`、`execution-real-duplicate-red.log`、`persistence-real-red.log`、`condition-boundary-real-red.log`。不能删除红灯或以假 execute/save/context 替换真实路径。Windows 非空目录阻止 rename 仅验证提交前失败；POSIX 提交后 fsync failure 尚无真实证据。

## 真实线程故障补验

[线程边界套件](../test/reminder-worker-boundaries-real.test.ts)不替换 Worker、MessagePort、执行器或存储。不可克隆入参触发 Node 的真实 `DataCloneError`；一个实际 judge 把异常的 `name` 设置为函数，触发错误回执发送失败。缺失安装入口的场景复制原 pool 产物字节但不提供入口，实际加载失败后恢复到原源码路径，并检查真实存储中的诊断和后续工具票据。

[修复前日志](../.local/logs/worker-boundaries-red25.log)的八个业务场景有三个失败：单条异常回执丢失，直到清理 watchdog 取消；batch 的后续规则丢失；模块缺失被误报成规则失败。[错误序列化](../src/matcher/worker-error.ts)现保留正常异常的原名称/消息，对不合法或不可读字段明确报告序列化失败；连检查后的错误都无法送出时让实际线程报错退出，不能吞掉后把 Host 任务挂住。启动期模块错误保留原 cause 并使用启动阶段标识。

[补验日志](../.local/logs/worker-boundaries-green27.log)的九个业务场景全部通过，包括新增的启动认领期间关闭。其余五个无匹配文件级结果不计为业务测试。普通异常后的 same-worker 恢复、batch 后续规则、三个完成回调异常后的下次执行、实际冷启动超时与实际缺失入口均已观测；不声称已验证所有物理传输故障。

## 工具票据虚假过期已定向修复

[真实票据生命周期用例](../test/reminder-denial-lifetime-host-cases.ts)接入原 Loader、JSON 存储、匹配 Worker、Agent 循环和工具注册表，在提醒评估完成后的真实 `tools/pre-execute` hook 等待约 1100ms，再让实际同步 guard 决定；单条预算为 250ms，旧票据 TTL 为 1000ms。工具体是否运行和最终工具结果均从真实执行及会话日志核实。

修复前 `ticket-lifetime-red20.log` 的六个业务场景有五个失败：无规则、纯执行前提醒、未命中拒绝都被过期误拒绝；真实拒绝的理由被过期覆盖；无关 `tool.succeeded` 提醒来源刷新也全局作废票据。新增真实拒绝策略的对照仍正确拒绝。

[票据实现](../src/reminder-runtime/denial.ts)现按本次执行令牌、结算与策略代数管理生命周期，不给已完成评估追加 TTL；[runtime](../src/reminder-runtime/runtime.ts)只在存在拒绝规则且执行前规则变化时作废票据。执行前提醒仍可能通过优先级、互斥组影响拒绝，因此相关变化保留检查。其它事件阶段提醒刷新不影响授权。

`ticket-lifetime-green22.log` 中六个业务场景全部通过；`denial-green22.log` 的 17 个契约测试也通过。runner 另显示四个没有匹配测试的文件级结果，它们不计作业务场景。类型检查与 Host 编译通过；这组结果不关闭整 Host 卸载、性能与其余验收缺口。

## 原生交接与真实卸载

历史 `host-shutdown12.log` 确实记录过生产 reservation 的迟到补偿被已关闭 `context_care_reminders` 拒绝，实际两分支一绿一红；该记录保留，但旧侧表补偿不再是生产架构。没有修改 Harness、覆写 Domain.close 或给关闭流程额外加 drain。

[卸载用例](../test/reminder-shutdown-host-cases.ts)现在通过[真实集成宿主](../test/integration.test.js)启动真实 Worker：quick judge 的完成匹配由实际 inbox 接纳，不合作 CPU judge 在插件或全 Host 卸载时物理终止，退出后的心跳不再变化。插件卸载保留 Agent 的原生 input；全 Host 的 Agent disposal 实际取消 inbox，空缓存重放遵守取消而不复活。两分支检查未打开候选域、没有旧域写入且冻结命中不重新 judge。`native156-source.log` 两个实际卸载场景均通过；后续 queued 改动后的 `native163-source.log` 同样通过这两项。

生产请求／提醒／claims 均不再读写其旧 JSON 账本。工具结果、Session 事件及别名和输出采样从原生输入重建；已交接 input 持有冻结正文、规则签名、逐规则触发和控制代次。`queued: true` 区分已接纳匹配与已获得共享名额的预约，真实 claim 不消费额度；名额不足不会让 queued 正文进入模型，也不会为重试自动追加 inbox 造成空转。`native164-source.log` 的实际共享竞争、claim 后冷恢复用例通过：保留消息 ID，无第二次 Worker judge，只有一次自然请求。显式取消、来源替换、scope、窗口、sticky、真人轮次和最终名额仍由完整 Source 回归验证。

迟注册别名的 `native157-red.log` 复现新会话 `'*'` 标记跳过后来声明的 Session 事件，`native158-source.log` 验证按具体事件选择补扫并在冷重放后不重复 judge。`native159-source.log` 的 174/174 通过属于 queued 改动前的树，不能代替最终门禁。真人在场仅倒序读取当前适用规则的近期窗口，不复制全 Session；未交接的原生触发允许重算。

## 发布门槛

历史 [release-check32](../.local/logs/release-check32.log)退出 0，424/424 单测通过；历史 [source-integration32](../.local/logs/source-integration32.log)退出 1，132 项中 131 通过、1 失败。它们属于旧侧表生产架构；其 Host 补偿失败由移除重复账本依赖解决，不再作为当前代码状态。六个真实票据生命周期和九个真实线程边界场景继续保留在完整 Source 中。最终门禁在 native170 同一可执行树串行完成，job `pwsh-b708e1f9828d471c` 已收取、退出 0：[release 日志](../.local/logs/native170-release.log)严格类型／语法检查、事件目录校验、461/461 unit（0 skip）及 Host／Client 构建通过；[完整 Source 日志](../.local/logs/native170-source.log)178/178（0 skip），耗时 205854.0018ms；[默认矩阵日志](../.local/logs/native170-benchmark.log)18/18 Worker 结果语义一致，[原始报告](../.local/logs/benchmark-reminders-final-native170.json) `validBaseline: true`、`sourceStable: true`、`failure: null`。默认设置为热样本25、冷样本3、预热3，规则数1/13/64，事件字符512/32768，三类workload；没有用 smoke 或缩减参数替代。报告独占新建，不覆盖旧基线。

本次基准时间为 2026-10-24T14:33:25.586Z–14:34:29.042Z。多规则 batch 的同次热 p50 加速约 1.50–2.75 倍；单规则 batch 的同次 p50 比逐条慢约 4.7%–30.7%，不声称全部更快或历史回归已经消失。8组含错误的多规则 judge/mixed 保留原始 `MatcherFailure`／`Error` 包装差异，经过已验证的 cause 解包后 Worker 原错误名称／消息一致；比较器实际拒绝名称、消息、缺项、乱序、match 或 protocol 的改变。以上是 matcher 测量，不替代运行时额度、取消及投递验收。缺少最早 before 源码的历史实验仍不能构成可复现前后因果比较。最终门禁后仅更新本验收结果与日志，未改变可执行源码、测试或配置。

同一轮代码还通过严格类型检查、真实 benchmark 冒烟、schema 复用前后各 18 组完整矩阵及比较；采样结果与无插桩延迟分开保存。尚需完成上表缺口、单规则/历史基线差异复核和最早旧源码恢复。后续代码变化后，发布前仍须在最终同一工作树重新执行：

```powershell
pnpm release:check
$env:DSH_TEST_CHECKOUT = 'D:/dev/deepseek-harness'
pnpm test:integration:source
pnpm exec node test/benchmark-reminders.ts --output-file=.local/logs/benchmark-reminders-final-native.json
```

旧 `release-check8.log` 的 408 个 unit、`source-integration8.log` 的 115 个集成结果早于新增 Host 卸载用例，不能作为当前最终树通过证据。未全部达标前不提交版本、不创建标签、不推送安装引用。
