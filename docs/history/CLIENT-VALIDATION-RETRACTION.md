# Client 验收撤回与重验

时间：2026-10-11 01:49 Asia/Shanghai。位置：dsh-context-care 测试、发行记录及只读 Harness 源码。意图：撤回由自写运行环境推导的验收，改用完整正式 Web 启动链路。结果：以下历史结果全部退出发行验收；完整应用重验尚未完成。

`test/fixtures/artifact-display-reader.js` 自写了 ctx.effect、locale、slots、uiConversation 和 sidebarRightTabs，直接调用 plugin.apply 与 inject 提取 reader。它没有经过 Cordis 依赖注入、真实槽位声明、Session 服务或右栏渲染。文件和对应运行入口已停用；真实网络和未修改构建工厂不能补足这些缺失。

`test/client-assembly.spec.js` 使用了真实 Cordis Context 和 SlotRegistry，但替换了 locale、layout、部分右栏服务、会话来源及 fetch。`test/browser-display-entry.js` 手工制造框架 hooks、标记与右栏容器。这两条路径及旧快照已删除，不得把它们表述为正式客户端装配、官方右栏或完整 Client→Host 验证。通知规则、变换日志、activate 及 context-care 单元套件中的自写 ctx/会话/服务环境也已删除，旧套件总数退出发行验收。

哥哥确认本地源码与正在运行的桌面版属于准确的同一套代码。第一次完整 Web scaffold 尝试在本地构建入口导入失败，未进入 Client 验收；这不能证明两套代码不同。后续核对实际包导出、入口及解析路径，禁止靠修改依赖或注入替身让启动通过。

受影响的历史证据包括所有 client-assembly、display-phase-client、display-sidebar-diagnostic-client、public-phase-client 与 public-current-client-assembly 日志，以及 legacy-artifact-deployed-asar-gzip64、public-client-artifact-deployed-asar-gzip-fixed 和 care-unload 系列日志。相关命令退出码仍是原始尝试记录；它们不构成 Client 验收通过。旧版直接 source reader 与自有浏览器页面的 protocol/load/gzip 结果同样不能作为真实应用行为验收。

此前 README、RELEASE-0.8.2、桌面 fetch 排查及进度记录中的相关“通过”“正式/官方”结论均撤回，以本记录为准。311/314 单元或 25/26 Client 的数字不能合并成发行通过结论。Host 局部组合及测试模型适配器的结果也不能代替完整部署行为验收。

提交 e8ccd9c 是最后生产代码变动；其后的 4019cb4 与 1d7b009 只涉及诊断、测试和记录。替身 fixture 在 1d7b009 才加入，因此没有基于该 fixture 的后续生产改动。e8ccd9c 的 Client 正确性仍需要从真实启动链路重验，不能因提交先后而认定正确。

补验曾通过部署的正式 `dsh/profile-boot` 入口启动完整 profile。02:01 全图启动后，Workspace 拒绝没有 cwd 的测试会话，未进入浏览器和真实右栏验收，没有模型调用。该并行应用试验未事先验证全部写入位置和冲突，02:05 后已中止，新增完整应用测试及运行入口全部删除，不再启动或重跑。

该次临时 DSH_HOME 为 `C:/Users/al765/AppData/Local/Temp/care-full-profile-web-xLnj6R/home`，由系统 tmpdir/mkdtemp 分配，非工作区目录。更早官方 scaffold 也在系统 Temp 的 `dsh-web-e2e-ws-<随机名>/.dsh-home`，具体随机名未记录，不能补造。

02:10 只读核查：测试脚本进程列表为空，原完整 profile 临时目录不存在。现场 Host PID33496仍存活，启动时间仍10:26:16.611；原会话 workbench 文件最后修改仍10:39:14.682，desktop package.json/cordis.yml仍10:39:35.074/10:39:35.245。该检查只覆盖已知文件与进程，不构成所有持久位置零影响的证明。

本次实现应验收的事实是：实际变化/失败的标记、经原有右栏触发的按需详情、未变消息零详情读取、错误时原文保留与可追踪诊断、卸载后的注册清理。必须经过真实应用才能确认的模块加载、依赖注入、会话与插槽行为，不得再用自写替身推断，也不得在未核验写入冲突时另起完整应用。生产代码阶段与实际环境验收分别报告；后者仍未完成。
