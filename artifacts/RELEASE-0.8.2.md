# dsh-context-care 0.8.2 修复候选

当前未发布、未部署。v0.8.0 与 v0.8.1 旧标签保持原位。

修复遍布消息的显示对照卡和两秒详情轮询：消息区只为内容实际改变的消息显示轻量处理标记，点击在右栏查看；未命中、同文替换无标记，规则状态变化使旧标记失效。匹配故障不再默认终止整个会话：可选处理保留完整输入并记录 failed；显式必需请求处理失败不派发；工具判定失败拒绝对应操作并返回明确错误，后续对话继续。显示模板与预算规划失败独立记录，取消不伪造新失败。

撤销未获依据支持的源码内嵌，恢复标准依赖：

| 包 | 版本 | 来源 |
| --- | --- | --- |
| @leolee9086/dsh-rule-engine | 0.3.0 | https://registry.npmjs.org/@leolee9086/dsh-rule-engine |
| dsh-better-session-query | 0.1.1 | https://registry.npmjs.org/dsh-better-session-query |
| dsh-context-care | 0.8.2 候选 | 本仓库 main 的固定提交，客户端构建产物已入库 |

12:44 阶段的主包 SHA-256 为 `AA19631FC6EE90FB4CD5111FFBF55ADDE8AF3F711CE4938B6C04B008501AB0F6`，它不含此后修正的 worker 启动参数，不能当作当前源码的发行产物。无需额外准备 tgz 才能进行公开 Git 消费验证。

验证：

- 当前代码完整真实 Host 套件 74/74，通过实际 worker 病态正则超时、真实工具链、真实鉴权 HTTP、持久化重启、三会话并发与显示/请求池隔离、实际缺字段模板、预算和取消。
- 生产标记/右栏组件在真实 msedge 浏览器中读取真实 Host，再关闭 Host 点击刷新，真实 Failed to fetch 可见。无 page.route、固定成功 fetch 或伪造服务响应。
- 独立单元套件 310/310；官方客户端装配 25/25。首个候选独立安装后关键 Host 5/5、实际 Client 2/2；最终候选在新空目录独立安装、公开入口烟雾与关键真实 Host 故障 6/6 通过，源码全套 74/74 通过（final-candidate-independent-install.log、final-candidate-consumer-smoke.log、final-candidate-installed-host.log、repair-host-final-reasons.log）。
- 两依赖实际 tgz 按标准版本号通过隔离 test registry 使用 pnpm 12 默认政策安装；不使用 allowBuilds、ignore-scripts、blockExoticSubdeps 例外。测试 registry 不证明公开 npm 分发已完成。
- 生产运行时无 Harness checkout 导入或开发 node_modules 链接。测试明确指定外部只读 Harness，LLM 使用测试适配器，未测试真实供应商/模型行为。

公开分发尚未解决。2026-10-10 12:56 Asia/Shanghai 只读查询 public registry：rule-engine latest 为 0.2.0，0.3.0 不存在，公开 maintainer 为 leolee9086；query 包返回 404。这些元数据不能证明本会话拥有发布权限。

此前把 whoami 401 推断成“只差登录”，并建议登录后直接发布，没有查询当前政策，是没有依据的判断，现撤回该建议与发布命令。whoami 只检查传统身份，既不验证包写权限，也不验证 OIDC trusted publishing 权限。

本次实际读取的 npm 官方现行政策：

- [发布所需 2FA 与包设置](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification)：所有包创建/发布要求 2FA，或启用 bypass 2FA 的 granular token；包级 disallow tokens 可禁止 granular token 发布。包设置修改本身要求交互 2FA。
- [公开 scoped 包发布](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)：直接发布和 staged publishing 是不同路径；暂存不等于公开发布，必须由 maintainer 以 2FA 审批，bypass token 不能跳过暂存审批的 2FA。
- [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers)：必须预先授权具体包与 CI workflow，支持指定的云 runner；最低 npm CLI 11.5.1、Node 22.14.0。当前新 trusted publisher 默认允许 stage publish，直接 publish 权限需另选。文档明确 whoami 不是 trusted publishing 权限检查。

这两个包的实际发布权限、2FA/包级设置、有效 granular token 或受信任 CI 发布配置均未验证。登录不会建立这些权限，不能承诺登录后可以发布。须先解决并实际验证可用的分发路径，再验收普通公开 registry 锁文件与空目录安装。此次没有发布、暂存或修改发布设置。

完成公开 registry 消费验证后，再通过官方插件管理器安装并重启/刷新现有 GUI 做现场验收。当前没有修改现场 Harness、profile、preset 或部署。原现场 Failed to fetch 的具体网络根因仍无现场证据，隔离测试断开不可当作该根因。
