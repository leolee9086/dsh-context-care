# dsh-context-care 0.8.2 修复候选

生产修改已提交并推送，最后一次生产改动为 e8ccd9c。主包没有发布、部署或安装到正在运行的桌面版。完整真实 Client 验收尚未完成，原 10:29 显示请求失败的具体原因尚未定位；不能把代码完成表述为实际环境验证完成。

代码移除逐消息对照卡和两秒详情轮询，改为变化/失败标记与右栏按需详情。可选匹配失败保留完整输入并记录失败；必需请求匹配失败禁止派发；显示与请求使用独立匹配池。worker 显式使用空 execArgv，不继承父进程启动参数。详情错误保留 route、phase 和收到的 HTTP 状态。

## 验收撤回

所有依赖手写 ctx、替换应用服务、测试会话或手工框架 hooks 的 Client/正式右栏/装配通过结论均撤回，详见[验收撤回记录](CLIENT-VALIDATION-RETRACTION.md)。对应 fixture、jsdom assembly、手工浏览器装配及直接模拟激活/会话环境的测试已删除，旧 partial-environment 入口已停用。

此前 311/314 单元、25/26 Client 及公开 Client assembly 的套件数量不能作为发行依据。artifact-reader、卸载、reader/protocol/load/gzip 的历史日志只保留尝试记录，不构成完整应用验收。真实 TCP、HTTP 与 Electron 错误记录不能补足模块加载、依赖注入、会话、布局和插槽装配的缺失。

补验时曾启动一份临时完整 profile；未事先验证全部持久化写入位置与并行冲突，该路径已中止，测试入口已删除。没有在实际右栏获得验收结果，没有调用模型。不能仅凭临时 DSH_HOME 宣称与现场数据完全隔离。

## 标准公开依赖

| npm 包 | 精确版本 | 公开元数据 |
| --- | --- | --- |
| @leolee9086/dsh-rule-engine | 0.3.0 | https://registry.npmjs.org/@leolee9086/dsh-rule-engine |
| dsh-better-session-query | 0.1.1 | https://registry.npmjs.org/dsh-better-session-query |

两依赖由哥哥发布。生产导入解析普通 npm 包，内嵌副本和 Harness checkout 别名已撤销。registry 归档的 SHA-512 与锁文件一致。普通 pnpm 11.7.0 add 在独立消费者下载53包时自动写入两条精确版本 minimumReleaseAgeExclude；不构成无豁免安装，本仓库没有改变年龄政策。

## 当前诊断结论

真实子进程确认父进程参数继承会触发 ERR_WORKER_INVALID_EXEC_ARGV，生产 worker 启动参数已修正。这项结论针对明确复现的 worker 启动错误，不能代替历史 matcher 超时原因。

Failed to fetch 可发生在响应头前，也可发生在收到 HTTP200 后消费响应体时。此前“该文案证明没有 Response”的判断已撤回。候选 reader 保存失败阶段与收到的状态，避免丢失这一差别。

原持久记录确认10:30:00.807请求为 REQUEST_PREFLIGHT_FAILED、dispatched=false。该记录说明请求匹配失败未派发；它不是10:29显示连接失败的底层错误码。当前 Host 持续存活也不能排除单响应或监听器生命周期问题。历史显示请求的具体触发仍未定位。
