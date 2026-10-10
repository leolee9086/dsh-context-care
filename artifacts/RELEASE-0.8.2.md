# dsh-context-care 0.8.2 修复候选

主包候选未发布、未部署；代码修复已提交推送，v0.8.0 与 v0.8.1 旧标签保持原位。以下公开消费验收对应提交 `6b37fa1b97e6b32e71fb2a98a993c213afc49838`。

消息区只为内容实际改变的消息显示轻量处理标记，点击后在右栏按需读取详情。逐消息显示对照卡和两秒详情轮询已移除；未命中、同文替换无标记，规则状态变化使旧标记失效。

可选匹配失败保留完整输入并持久化 failed 记录；显式必需请求匹配失败不派发；工具判定失败只拒绝对应操作并返回明确错误，后续对话继续。显示模板与预算规划失败独立记录，取消不伪造新失败。独立显示匹配池避免占用请求接纳容量。

## 已发布的标准依赖

| npm 包 | 精确版本 | 公开元数据 |
| --- | --- | --- |
| @leolee9086/dsh-rule-engine | 0.3.0 | https://registry.npmjs.org/@leolee9086/dsh-rule-engine |
| dsh-better-session-query | 0.1.1 | https://registry.npmjs.org/dsh-better-session-query |

两依赖由哥哥完成 npm 发布。公开 registry 已返回精确版本及对应 latest，实际下载归档的 SHA-512 与本仓库锁文件完全一致。所有生产导入均解析普通 npm 包，内嵌副本已撤销；Host 与 worker 使用同一组已安装依赖，没有 Harness checkout 别名或开发链接。

发布时间分别为 `2026-10-10T07:00:10.101Z` 与 `2026-10-10T07:01:25.519Z`。本机 pnpm 11.7.0 与 12.6.0 的无豁免 frozen-lockfile 安装均因未满足24小时 minimumReleaseAge 而被拒绝。实际部署工具链 pnpm 11.7.0 的普通 add 在新空消费目录和新 store 中安装53包成功，同时自动写入两个精确版本的 minimumReleaseAgeExclude；该结果不能表述为无豁免安装。本仓库不提供这两个豁免，项目与全局政策未修改。

公开固定提交安装结果见 [public-fixed-install.log](public-fixed-install.log)。12:44 阶段的旧主包归档不含此后修复的 worker 启动参数，不能作为当前代码的发行产物；本轮验证直接消费公开 Git 提交，没有额外准备发布 tgz。

## 运行验证

- 在实际部署所带 Node 24.21.0 下，真实子进程先复现 ERR_WORKER_INVALID_EXEC_ARGV：父进程的 V8/process 参数被传给 worker。纯 JavaScript worker 改为显式空 execArgv，不继承父进程 loader、inline-entry、test 或 V8 参数。Node 22.19.0 与 24.21.0 的 worker 回归均4/4通过，覆盖进程专用参数、病态正则超时后的恢复和真实并发超载。
- 公开下载依赖下独立单元套件311/311通过，见 [public-dependencies-unit-fixed.log](public-dependencies-unit-fixed.log)。Node22完整真实 Host 套件74/74通过，见 [public-dependencies-host.log](public-dependencies-host.log)，包括鉴权 HTTP、持久化重启、工具链、三会话并发与显示/请求池隔离。
- 从公开提交独立安装后，在 Node24 下检查公开 Host 入口、纯声明、已构建 Client factory、依赖精确版本、原始块读取和实际 worker 匹配，全部通过，见 [public-fixed-consumer.log](public-fixed-consumer.log)。
- 同一独立安装包在 Node24 下的8项真实 Host 检查通过：显示模板失败后两轮继续、有效变化标记、外部和内建增量检测器、输出故障持久化、并发显示超时、工具判定超时、必需请求匹配失败不派发，见 [public-fixed-installed-host-node24.log](public-fixed-installed-host-node24.log)。
- 生产标记、右栏组件与 reader 已在真实 msedge 浏览器中读取真实鉴权 Host；点击标记只读取一次，断开 Host 后显式刷新可见真实 Failed to fetch，原生正文保持原文。没有 page.route、固定成功 fetch 或伪造服务响应。官方客户端装配此前25/25通过。
- 此后补齐详情失败诊断：右栏显示具体请求路由，空或HTML的HTTP失败保留状态码。真实HTTP2/2、真实Host浏览器断开1/1、官方Client装配2/2通过，见 [display-http-diagnostic-fixed.log](display-http-diagnostic-fixed.log)、[display-sidebar-diagnostic-browser.log](display-sidebar-diagnostic-browser.log)、[display-sidebar-diagnostic-client.log](display-sidebar-diagnostic-client.log)。pnpm run build仍因发布时间政策失败；直接执行已安装构建器成功并更新已提交Client产物，没有更改安装政策。

测试明确指定外部只读 Harness；生产运行时不导入该 checkout。LLM 使用测试适配器，未验证真实模型供应商行为。主包声明 AGPL-3.0-only；引擎依赖声明 AGPL-3.0-or-later，查询依赖声明 MIT。

## 现场剩余工作

只读检查确认桌面安装目录仍为0.8.1，实际安装代码仍有旧的逐消息读取和两秒轮询。读取实际部署的桌面主程序代码确认，非静态 app 路径会转发到 Host；没有证据将 dsh-app 自定义协议认定为原 fetch 失败的原因。

当前 Playwright 的19387页停在鉴权提示，没有 context-care 请求记录；桌面正在另一个会话。实际DevTools保留大量 `/plugins/events` 的 `net::ERR_FAILED`，但未取得原显示请求的网络结果，不能认定为同一根因。旧crash日志也没有该请求的证据。未修改现场 Harness、profile、preset 或部署，也没有读取凭据。原现场 Failed to fetch 的具体网络原因仍未定位；隔离 Host 断开测试不代表该原因。整个修复目标尚未完成。
