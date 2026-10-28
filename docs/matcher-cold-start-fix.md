# 并行冷检测超时修复

## 原因

首次干净目录原单元出现 `matcher-work-timeout`，失败于检测器流隔离用例。原失败栈落在 `matcher-pool` 终止线程后的结算处，说明监督器实际终止了仍在工作的线程；并非只因 Host 未及时接收已经完成的结果。

单项 Worker 在 `executeRuleTask` 前启动工作检查点。首次检测器调用要编译 state、result、params 三份 JSON schema；旧 `detectorValidator` 每编译一份用户 schema 都新建 Ajv，使内建 draft-07 元 schema 重复冷编译。这段重复准备被计入同一个默认 250ms 工作预算。用户回调还保持独立默认 50ms VM 限制。

本地分段诊断测得三份独立 schema 冷编译约 39.7 / 17.5 / 14.1ms；同一检测任务 schema 缓存热后约 9.3ms。16 个冷调用并行的分段复现中，7 个任务触发 `matcher-work-timeout`，监督诊断 processingElapsedMs 约 277–323ms，其中 3 个在原始 `executeRuleTask` 返回前被终止。该探针在任务完成后还有额外的缓存热调用，因此另外 4 个超时不作为原始任务超时证据；不把这些诊断数字当性能基准。

## 修复

修复在引擎库 `detector-protocol` 内完成：每个进程/Worker 复用一个 Ajv，在模块初始化时编译一次内建元 schema。默认 Worker 发送 ready 前已完成该准备；用户 schema 自身编译、数据验证和回调执行仍在原工作预算中。

每次用户 schema 编译后，无论成功失败，都清理 Ajv 中的用户 schema 和引用，再恢复原元 schema 引用。这样保持原行为：

- 不同检测器允许使用相同 `$id`，各自独立校验。
- 后一个 schema 不能通过外部 `$ref` 使用前一个检测器的 schema。
- 单份 schema 内的递归引用有效，失败编译不会污染后续编译。
- 显式 draft-07 元 schema 别名、严格 schema 校验及调用方 16 项 LRU 保留。
- 不缓存 VM 上下文或回调全局状态。

250ms 工作限额、50ms 回调限额、取消和 Worker 退出确认逻辑均未修改。没有更改测试并发参数，也没有增加自动重试。

## 验证范围与结果

只新增两项行为回归：冷并发 Worker 的增量流结果/状态，以及编译器复用后的 schema 独立性和失败恢复。没有把耗时数字写成单元断言。引擎既有发布前 build / lint / tests 门禁通过 143/143。

独立目录安装实际 `0.5.1` 归档后，运行原有 detector 与 matcher-failure 两套，21/21，0 fail / 0 skip。覆盖原始流隔离、回调全局隔离、变更 schema、病态 schema 正则和普通正则的实际终止、取消、容量、线程恢复与关闭。

相同 16 并行诊断在修复后无 `matcher-work-timeout`；实际默认 Worker 冷调用约 15–129ms。该过载诊断仍出现两个独立的 VM 50ms 墙钟超时；这些结果保留，未放宽 VM 限制，也不据此声称任意系统负载下所有调用必定成功。正式行为回归使用默认预算，检查结果和状态，不依赖压力采样的耗时范围。

## 交付状态

`@leolee9086/dsh-rule-engine@0.5.1` 已发布到 npm。registry SHA1 为 `f5d389d6698ed0fe21f7caddfad2b0b869462adb`，与以上验证归档一致。本人完成系统通行密钥认证后，标准 `pnpm publish` 成功；插件已通过普通 `pnpm add` 将正式依赖和锁文件更新为精确 `0.5.1`。归档验证和正式安装均未替换生产源码解析。从 registry 正式安装后，相关 detector / matcher-failure 原回归再次通过 21/21；标准 `pnpm check`（含 102 个 JS 文件语法检查）及 Host / 客户端构建全部通过。已安装库的所有 lib 文件逐一 SHA256 与已验证本地产物一致，锁文件 integrity 与 registry 一致。pnpm 12 普通 add 自动记录精确 `0.5.1` 发布时间豁免，未放宽其它版本政策。

本次没有重跑不受该修复影响的 UI、完整 Host 及全部插件单元。此前 `0.5.0` 验收结果保留在 [统一引擎迁移验收](unified-engine-migration.md)。
