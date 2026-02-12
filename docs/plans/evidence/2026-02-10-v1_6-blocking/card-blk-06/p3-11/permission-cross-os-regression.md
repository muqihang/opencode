# P3-11 / I.12 权限策略跨平台回归补证

- 执行日期：`2026-02-12`
- 执行模式：`local-only`、`fail-fast`、`no-push`
- 当前验证平台：`macOS 14.5 (Darwin 23.5.0)`
- 目标：对“本地持久层 + 路径权限边界”给出跨 OS 一致性与回归风险证明

## 1) 回归命令与结果（本次实际执行）

### 1.1 Typecheck

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode
bun run typecheck
```

- 结果：`exit 0`
- 关键输出：`node_modules/@typescript/native-preview/bin/tsgo.js --noEmit`

### 1.2 权限与路径回归测试

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode
bun test test/permission/next.test.ts test/file/path-traversal.test.ts --bail
```

- 结果：`exit 0`
- 汇总：`77 pass, 0 fail`
- 关键覆盖面：
  - `PermissionNext.fromConfig/evaluate/ask/reply/disabled`
  - `File.read/File.list` 路径逃逸防护
  - `Instance.containsPath` 的 `worktree` 边界语义

## 2) 跨 OS 回归项映射

| 回归项 | 代码路径 | 测试证据 | 跨 OS 判定 |
| --- | --- | --- | --- |
| 规则集合与决策动作固定为 `allow/deny/ask` | `src/permission/next.ts:24` | `test/permission/next.test.ts:171` | 一致 |
| 最后匹配规则胜出（顺序敏感） | `src/permission/next.ts:234` | `test/permission/next.test.ts:181` | 一致 |
| `~/$HOME` 展开使用 `os.homedir()` | `src/permission/next.ts:16` | `test/permission/next.test.ts:42` | 一致（平台相关路径形式待窗测） |
| `reply=always` 后可在新 `Instance` 中复用审批 | `src/permission/next.ts:196` | `test/permission/next.test.ts:569` | 一致（当前为内存/状态级） |
| 非 Git 项目 `worktree='/'` 不放大权限 | `src/project/instance.ts:57` | `test/file/path-traversal.test.ts:185` | 一致 |
| `File.read/File.list` 拒绝 `../` 逃逸 | `src/file/index.ts:282` / `src/file/index.ts:342` | `test/file/path-traversal.test.ts:43` / `:89` | 一致 |
| 路径包含判断基于 `path.relative`（词法） | `src/util/filesystem.ts:35` | `test/file/path-traversal.test.ts:9` | 一致实现 |
| Windows 跨盘符绕过风险 | `src/file/index.ts:281` / `:341` TODO | 无专门 win32 用例 | **存在差异风险** |

## 3) “本地持久层”维度结论

1. 权限状态初始化会读取本地存储：`Storage.read(["permission", projectID])`（`src/permission/next.ts:108`）。
2. `Storage` 读写路径统一落在 `Global.Path.data/storage`（`src/storage/storage.ts:145`）。
3. 当前 `reply=always` 分支仍将磁盘写回注释掉（`src/permission/next.ts:223`），因此“跨进程持久化”不作为本卡一致性承诺。
4. 结论：现有一致性主要体现在“权限决策语义一致 + 进程内/实例态复用一致”，非“always 已耐久化”。

## 4) 未覆盖回归与风险分级

### P0（必须补）

1. Windows 跨盘符路径（`C:` -> `D:`）越界拒绝。
2. Windows UNC 路径（`\\server\\share`）与本地项目边界关系。

### P1（建议补）

1. 符号链接逃逸（`realpath` 与词法 contains 差异）。
2. `external_directory` 在混合分隔符输入（`\\` 与 `/`）时的规则命中一致性。

## 5) 平台特化 fallback 判定

- 判定：**需要平台特化 fallback（Windows）**。
- 建议策略（不在本卡改代码）：
  1. `File.read/list` 在调用 `Instance.containsPath` 前做盘符一致性校验；
  2. 失败即拒绝（fail-closed）；
  3. 在后续卡补 `win32` 专项回归用例后再考虑放宽。

## 6) I.12 最终结论

- 本卡补证已完成：`local-persistence-permission-matrix.md` 与本报告均已落盘。
- 跨平台一致性状态：`mostly-consistent-with-known-windows-gap`。
- 阻断建议：在 Windows 跨盘符专测完成前，维持最保守权限策略。
