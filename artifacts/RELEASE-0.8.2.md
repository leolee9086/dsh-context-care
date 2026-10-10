# dsh-context-care 0.8.2 修复候选

主包候选未发布、未部署；代码修复已提交推送，v0.8.0 与 v0.8.1 旧标签保持原位。初次公开消费验收对应提交 `6b37fa1b97e6b32e71fb2a98a993c213afc49838`；最新包含详情诊断修正的公开消费验收对应 `0c18c2981ee398ec59339b208de6aeae3ad51cb0`。

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
- 17:23从公开最新提交0c18c29再做全新消费者/全新store安装，53包全部下载，普通add再次只自动写入上述两个精确年龄豁免；依赖integrity与源锁一致，见 [public-current-install-0c18c29.log](public-current-install-0c18c29.log)。独立入口/Client factory/真实worker smoke通过，见 [public-current-consumer-0c18c29.log](public-current-consumer-0c18c29.log)。公开安装Host的8项真实故障检查及真实浏览器按需取数/断开共9/9通过，见 [public-current-host-node24-0c18c29.log](public-current-host-node24-0c18c29.log)；读取同一安装包已构建Client的官方装配2/2通过，见 [public-current-client-assembly-node24-0c18c29.log](public-current-client-assembly-node24-0c18c29.log)。浏览器fixture构建仍来自测试checkout生产组件，95个发布src及lib/client.js与此次公开安装逐SHA256一致，见 [public-current-source-0c18c29.json](public-current-source-0c18c29.json)。

实际运行的桌面 Host 引擎为 Electron 内置 Node24.18.1，启动带 `--expose-internals`；此前的 Node24.21.0 是部署随带的独立 Node。最新公开消费包在实际引擎及同一启动参数下的入口、Client factory、原块和 worker smoke通过，见 [desktop-engine-public-consumer-0c18c29.log](desktop-engine-public-consumer-0c18c29.log)。真实已部署 ASAR 模块（DSH0.2.0-rc.2、Cordis4.0.4、Loader1.0.5）的8项故障及多会话检查全部通过，见 [desktop-runtime-public-host-fixed-0c18c29.log](desktop-runtime-public-host-fixed-0c18c29.log)。首次检查在测试解析包名处失败，已修正目录叶推断为显式公开包名；未修改生产解析。生产标记与右栏reader通过真实msedge→该ASAR Host的按需读取及断开检查1/1，见 [desktop-runtime-browser-diagnostics-0c18c29.log](desktop-runtime-browser-diagnostics-0c18c29.log)。浏览器入口从相同生产源码构建，源码与公开安装文件一致；这不是将插件安装进现场GUI。

测试明确指定外部只读 Harness；生产运行时不导入该 checkout。LLM 使用测试适配器，未验证真实模型供应商行为。主包声明 AGPL-3.0-only；引擎依赖声明 AGPL-3.0-or-later，查询依赖声明 MIT。

## 现场剩余工作

只读检查确认桌面安装目录仍为0.8.1，文件中的旧实现仍有逐消息读取和两秒轮询；当前profile bundle名册和有效Host组合已无照料插件。桌面旧boot图保留照料条目，但真实/plugins/events返回200后的当前图已无照料。对应display/actions/controls同源只读GET均为空404，页面没有自动详情请求；该状态不能当作10:29原失败的重现。

已读取原始两张截图：显示卡片只有TypeError: Failed to fetch，没有当时请求URL或底层网络码；matcher异常进入工具提示和整轮UNKNOWN失败。原图保留在既有本地存储。实际部署桌面代码将非静态app路径转发到Host并移除连接encoding/length头，当前同源404也证明能拿到Response；不能直接归咎于自定义协议。fetch-router Client没有改写全局fetch。

只读选择原安装0.8.1、实际Node24.18.1与已部署ASAR Host，用原生产reader做真实msedge HTTP诊断：8条空规则请求均200，8条真实正则超时请求均503且显示HTTP503:matcher-work-timeout，两组requestfailed均零。参数化诊断脚本复验相同，见 [legacy-display-transport-parameterized.log](legacy-display-transport-parameterized.log)。该结果只确认所测试HTTP路径的超时错误响应，不覆盖历史dsh-app连接或所有原配置。修正测试解析器后，源码Host的有效标记回归1/1也通过，见 [source-host-resolver-regression.log](source-host-resolver-regression.log)。

实际DevTools保留的 `/plugins/events` net::ERR_FAILED、旧crash日志与会话工作台记录均不足以证明原显示请求的失败原因。原现场Failed to fetch的具体传输根因仍缺当时URL、网络码或对应Host记录；隔离Host断开测试验证同类错误显示，不替代历史根因。未修改现场Harness/profile/preset/deploy，也未读取凭据。代码与标准依赖阶段通过，整个目标尚未完成。
