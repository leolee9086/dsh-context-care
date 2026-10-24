# v0.13.6 诊断查询延迟验收

2026-10-25，本机 Windows，明确指定外部 Harness 源码测试宿主。用真实 Cordis Loader、Session、连接鉴权和 HTTP 服务运行；没有替代 Harness Context。对应用例在 `test/integration.test.js`：`long Session diagnostic queries keep unrelated HTTP responsive and push only actual changes`。

## 复现及结果

夹具包含 700 条原生事件、350 次请求结算。每次请求头包含 120 个工具定义及带 200 条消息的工作台请求差异。基线保留原有 request-cache 读逻辑；轮询已经关闭，因此能单独确认同步查询本身的开销。所有测量都是同机夹具，不能替代实际部署的最终延迟。

| 测量 | 修改前 | 最终完整回归 |
| --- | ---: | ---: |
| 首次读取全部结算 | 447.81 ms | 17.76 ms |
| 重复读取 20 次 | 8017.09 ms | 7.89 ms |
| 查询前次路由 20 次 | 8024.82 ms | 0.078 ms |
| 不匹配路由的校准查询 20 次 | 5119.43 ms | 14.20 ms |
| 提示 HTTP 首次 / 后续 | 452.77 / 399.91–410.43 ms | 26.97 / 2.72–4.58 ms |
| 并发规则 HTTP 首次 / 后续 | 454.26 / 400.53–411.42 ms | 27.39 / 3.04–4.94 ms |

最终完整回归中，全部同步查询墙钟 40.25 ms，等待下一次事件循环 41.47 ms，进程 CPU 时间 78 ms。CPU 包含进程所有线程；同步段的 eventLoopUtilization 为 1，不能作为空闲 CPU 占用率。

瓶颈是每次查询对每条历史结算重复执行深度 JSON 校验，而结算引用了完整历史请求差异；前次路由查询还复用了整表投影。修复后，内部已接纳事实直接组合，路由倒序读取原生结算，校准先比较路由并缓存不可变 header 哈希。只读 GET 不再强制刷盘。

## 事件订阅与恢复

操作、提示、改写、开关和运行面板均没有 setInterval 或定时重试。客户端一条鉴权 NDJSON 流复用所有保留会话，宿主按实际提交、记录、来源和工作台变更发送失效通知；微任务和背压合并重复通知。初始快照订阅后发送，读取中的变化保留一次后续读取。连接代次变化和手动刷新失败流可重连；所有权归零和卸载取消连接与未完成读取。

来源定位通过 DOM/尺寸/原生投影通知观察目标出现，操作后单帧确认，并使用单次导航期限。共享额度依然从全逻辑语料恢复，扫描中按进度让出 Host；没有提醒入箱事件的冷日志省去 detached Session 构造。额度、窗口、原生已接受输入和取消的语义由完整真实宿主回归验证。

## 发布门禁

- `pnpm release:check`：464/464，零跳过；严格 TypeScript、事件目录一致性及构建成功。
- `DSH_TEST_CHECKOUT=D:/dev/deepseek-harness pnpm test:integration:source`：179/179，零跳过。
- `DSH_TEST_CHECKOUT=D:/dev/deepseek-harness pnpm test:client:source`：24/24。
- 推送流测试使用实际 ReadableStream/Response 验证分片、多会话共享、隔离、代次替换、空闲无读取、显式重试、取消及释放；HTTP 订阅使用真实 Host 鉴权和路由。
