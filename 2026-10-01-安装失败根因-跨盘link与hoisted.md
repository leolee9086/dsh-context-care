# 安装失败根因：`nodeLinker: hoisted` + 跨盘 `link:`

## 现象

用 DSH 内置插件安装器安装 `https://github.com/leolee9086/dsh-context-care#v0.6.3` 失败：

```
[ERR_PNPM_EPERM] [importPackage C:\Users\al765\.dsh\profiles\desktop\node_modules\dsh-context-care] EPERM:
  symlink 'D:\dev\dsh-context-care\node_modules\.pnpm\@deepseek-ai+cordis@4.0.2\node_modules\@deepseek-ai\cordis'
       -> '...\dsh-context-care_tmp_68820_7\node_modules\@deepseek-ai\cordis'
```

表现是“装不上”：pnpm 失败后安装器回滚 `package.json`，所以声明看上去没变。

## 关键的排除项（都是实测，不是推理）

1. **不是插件仓库的依赖声明有问题。** `package.json` 里没有 `link:`；把 `@deepseek-ai/cordis` 从声明里删掉后，报错只是换成了 `@leolee9086/dsh-rule-engine` —— 说明具体哪个包不重要。
2. **不是 pnpm 版本本身。** 系统 pnpm 12.6.0 无论怎么试都成功；**应用自带的 pnpm 11.7.0**（`apps/desktop/src/main.ts:157` → `resources/runtime/pnpm/bin/pnpm.mjs`，跑在打包 Node 上）才会失败。
3. **不是沙箱。** 不提权时会得到完全不同的错误（`git ls-remote ... spawn EPERM`），那是沙箱拦子进程，与本次的 symlink EPERM 是两回事。

## 变量分离（用自带 pnpm 11.7.0 + 打包 Node）

| link 目标 | pnpm-workspace.yaml | 结果 |
|---|---|---|
| 无 link（直接 `github:#v0.6.3`） | 带 `nodeLinker: hoisted` | ✅ 成功（+6 包） |
| `D:\dev\dsh-context-care` | 带 `nodeLinker: hoisted` | ❌ **EPERM** |
| `D:\dev\dsh-context-care` | 不带 `nodeLinker` | ✅ 成功 |
| C 盘的伪造目标 | 带 `nodeLinker: hoisted` | ✅ 成功 |

## 根因

`profiles/desktop/pnpm-workspace.yaml` 里的 **`nodeLinker: hoisted`** 与 **跨盘的 `link:`** 组合才触发。

hoisted 布局要把每个依赖铺进 `node_modules`（npm 风格）；`link:` 目标的依赖也得从源盘铺过来。跨盘不能硬链接，pnpm 退化成 `symlink`，而 Windows 上创建 symlink 需要开发者模式或管理员权限，于是 `EPERM` 让整棵树重建失败。

依赖字段（dependencies / devDependencies / optionalDependencies）与此无关：我试过三种写法，旧报错里那个包只是被铺的第一个。

## 哥哥的规矩（已记入会话记忆）

`link:` 只用于本机极早期开发阶段；推送出去的包不能用 `link:` 依赖。而这里更进一步：**profile 里跨盘 `link:` 在当前 pnpm 组合下会直接让安装不可用**。

## 已做的修改

- `profiles/desktop/package.json`：`dsh-context-care` 从 `link:D:/dev/dsh-context-care` 换成 `github:leolee9086/dsh-context-care#v0.6.3`，并用自带 pnpm 11 验证（41 包，3.1s，exit=0）。
- 备份：`package.json.bak-20261001-141347`、`pnpm-lock.yaml.bak-20261001-141347`。
- 仓库 `README.md`：把“源码开发后可用 `link:`”改成明确标注**仅限本机同盘开发**，并说明跨盘 `link:` 会导致 `ERR_PNPM_EPERM`。

## 未完成（下次接着干）

1. **回滚一个错误改动**：我曾把 `@deepseek-ai/cordis` 从 `devDependencies` 移除（基于错误假设），后来改回声明，但本地 `node_modules` 里那个包已被清掉。需要再跑一次 `pnpm install` 恢复它（测试要用），并跑一遍 `pnpm test` 确认没有残留影响。
2. `test/context-care.test.js` 依赖 `@deepseek-ai/cordis` 建 Context；它是 registry 上的正常包（4.0.2 / 最新 4.0.4），不是 `link:`，留着没问题。
3. 仓库当前未提交改动：`README.md`、`pnpm-lock.yaml`（后者是 `pnpm install` 顺手改的，需要看一眼是否该提交）。
4. 若要保留本地开发用 `link:`（同盘才行），需要先解决 hoisted 与跨盘 link 的冲突，或者把项目放到与 profile 同一个盘。
5. 那个一直红的既有测试 `test/context-care.test.js:407`（规则引擎对 `null` 的处理）与本问题无关，仍未处理。

## 重要路径

- 插件仓库：`D:\dev\dsh-context-care`
- profile：`C:\Users\al765\.dsh\profiles\desktop`
- 自带 pnpm：`C:\Users\al765\AppData\Local\Programs\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.mjs`
- 打包 Node：`…\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`
- 安装器日志：`…\profiles\desktop\.plugin-manager\logs\operation-*\pnpm.log`
- 安装器源码：`D:\dev\deepseek-harness\packages\boot\plugin-manager\src`
