# maxNoteChars 从 4000 修回 10000（2026-09-22）

## 症状

哥哥发现 `context_rest` 的 note 上限是 4000，但他记得要求过 10K。

## 根因

**源码默认值改了，但四处显式写死的 4000 没跟着改，其中一处是实际生效的。**

时间线：

1. `88fae1a`（初次提交）—— `src/policy.js` 默认 `maxNoteChars: 4000`，`agent.example.cordis.yml` 也写 4000
2. `8cd528f`（**2026-09-22 10:56**，哥哥本人提交）—— 标题「调整交接笔记字数要求」：
   - `policy.js`：`maxNoteChars: 4000` → `10000`
   - 同时新增 `minNoteChars: 1000`（「下限存在的意义是把'随便写两句'堵掉」）
   - GUIDANCE 从「交接笔记要简短」改成「交接笔记**宜细不宜粗**」
3. **但 `agent.example.cordis.yml` 没改**（该提交没碰它）
4. 而当前会话挂载的预设 `~/.dsh/.agent-presets/cordis-no-subagents/agent.cordis.yml` 里
   **显式写着 `maxNoteChars: 4000`** —— 这行会把源码默认值盖掉

所以：源码是 10000，实际运行是 4000。

## 修复（四处）

| 文件 | 位置 | 改动 |
|---|---|---|
| `C:\Users\al765\.dsh\.agent-presets\cordis-no-subagents\agent.cordis.yml` | L235 | **实际生效的那个**：4000 → 10000（带注释说明为什么别写小数字） |
| `D:\dev\dsh-context-care\agent.example.cordis.yml` | L20 | 4000 → 10000 + 注释 |
| `D:\dev\dsh-context-care\README.md` | L109 | 示例配置 4000 → 10000 |
| `D:\dev\dsh-context-care\README.md` | L173 | 参数表补上 `minNoteChars` 1000，`maxNoteChars` 改 10000 |

## 验证

- `grep maxNoteChars` 全仓库无残留 4000
- `pnpm test`：**53 项全过**（首次报 `spawn EPERM`，按 memos 记录提权重发即过）

## 教训

**改插件的默认值时，要一并搜「哪些地方显式写了旧值」。** 默认值只是兼底，
显式配置（尤其是实际挂载的预设文件）优先级更高，不改它等于没改。

下次碰到「我明明改过了却不生效」，第一个要查的就是：
**有没有别处把这个值显式写死了？**

## 相关路径

- 插件源码：`D:\dev\dsh-context-care`
- 实际预设：`C:\Users\al765\.dsh\.agent-presets\cordis-no-subagents\agent.cordis.yml`
- profile 补丁：`C:\Users\al765\.dsh\profiles\web\cordis.patch.yml`
- 本次调研成果：`D:\dev\现金流方向调研\2026-09-22-现金流方向全景扫描.md`
