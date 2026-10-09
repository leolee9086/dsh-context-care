# 固定发行模块

v0.8.1（2026-10-09）将以下已发布上游的纯 JavaScript 模块随包发行，避免 pnpm 默认拒绝 GitHub 子依赖。模块逐字节复制，未改变实现；主线程、worker 与独立测试都导入这份发行模块。上游仓库继续独立维护，更新时应重新核对版本、许可证和哈希。

- `rule-engine/*.js`：[@leolee9086/dsh-rule-engine v0.3.0](https://github.com/leolee9086/dsh-rule-engine/tree/1c67baa1692f2f9cfdf66a1925dfe54bf30a80b6/lib)，commit `1c67baa1692f2f9cfdf66a1925dfe54bf30a80b6`，AGPL-3.0-only，完整许可证在 `rule-engine/LICENSE`。其中 regex.js 保留 SillyTavern 来源说明。本插件整体按 AGPL-3.0-only 发行；根 LICENSE 提供完整条款，GitHub 标签包含对应源码及构建配置。
- `session-query/blocks.js`：[dsh-better-session-query v0.1.1](https://github.com/leolee9086/dsh-better-session-query/blob/3caf61b2d0432774cb19eff1ecdf3cf74004929b/lib/blocks.js)，commit `3caf61b2d0432774cb19eff1ecdf3cf74004929b`，MIT，完整许可证及版权在 `session-query/LICENSE`。仅携带无外部依赖的块读取模块，不携带索引、SQLite、记忆或插件挂载实现。

`provenance.json` 记录原始路径、版本、commit 和各文件 SHA-256。`test/dependencies.test.js` 在发布检查中校验哈希，防止无意修改固定模块。运行不需要上游 checkout、另一个已挂载插件或安装时构建。
