# P3-11 / I.12 本地持久层权限策略跨平台一致性矩阵

- 执行日期：`2026-02-12`
- 执行约束：`docs-first`、`fail-fast`、`no-push`、`不改 packages/app/**`
- 执行环境：`macOS 14.5 (Darwin 23.5.0)`、`bun 1.3.5`
- 证据范围：`packages/opencode` 的权限决策、本地存储、路径边界控制

## 1) 证据源

- 权限规则实现：`packages/opencode/src/permission/next.ts:13`
- 本地存储实现：`packages/opencode/src/storage/storage.ts:12`
- 项目边界判断：`packages/opencode/src/project/instance.ts:17`
- 文件访问边界判断：`packages/opencode/src/file/index.ts:275`
- 路径工具实现：`packages/opencode/src/util/filesystem.ts:4`
- 关键回归测试：
  - `packages/opencode/test/permission/next.test.ts:42`
  - `packages/opencode/test/permission/next.test.ts:569`
  - `packages/opencode/test/file/path-traversal.test.ts:9`
  - `packages/opencode/test/file/path-traversal.test.ts:118`

## 2) 跨平台一致性矩阵（local persistence + permission）

| 检查点 | macOS / Linux | Windows | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| 规则动作集合（allow/deny/ask） | 同一枚举与同一 evaluate 路径 | 同一代码路径 | 一致 | `src/permission/next.ts:24`, `src/permission/next.ts:231` |
| 规则优先级（最后匹配胜出） | `findLast` 覆盖顺序稳定 | 同一逻辑 | 一致 | `src/permission/next.ts:234`, `test/permission/next.test.ts:181` |
| external_directory 的 `~` 与 `$HOME` 展开 | 由 `os.homedir()` 展开，当前平台测试通过 | 仍走 `os.homedir()`，但分隔符混用场景未单测 | 基本一致（需补窗测） | `src/permission/next.ts:16`, `test/permission/next.test.ts:42` |
| 非 Git 项目 `worktree='/'` 兜底 | 显式阻断“全盘都在 worktree 内”误判 | 同一判断条件 | 一致 | `src/project/instance.ts:57`, `test/file/path-traversal.test.ts:185` |
| `File.read`/`File.list` 目录逃逸阻断 | `Instance.containsPath` 拒绝 `../` 与绝对越界 | 同一代码路径 | 一致（已测当前平台） | `src/file/index.ts:282`, `src/file/index.ts:342`, `test/file/path-traversal.test.ts:43` |
| 持久层读取已审批规则 | 初始化时读取 `Storage.read(["permission", projectID])` | 同一存储 API | 一致 | `src/permission/next.ts:108`, `src/storage/storage.ts:169` |
| `reply=always` 的本地持久化写入 | 内存 `approved` 会追加 allow 规则 | 写入磁盘代码被注释，行为相同 | 一致但非“耐久化” | `src/permission/next.ts:196`, `src/permission/next.ts:223` |
| Windows 跨盘符越界防护 | N/A（当前环境非 Windows） | 已有 TODO 指出 cross-drive 可能绕过 | 不一致风险（待修） | `src/file/index.ts:281`, `src/file/index.ts:341` |
| `Filesystem.contains` 语义 | 词法 `path.relative` 判定，不做 realpath | 同一实现，受平台路径语义影响 | 一致实现，存在同类边界风险 | `src/util/filesystem.ts:35` |

## 3) DoD 结论（I.12）

1. `local-persistence-permission-matrix.md`：已产出。
2. 与 `permission-cross-os-regression.md` 配套回归证据：已补齐。
3. 是否需要平台特化 fallback：**需要（Windows）**。

## 4) 建议的最小平台特化 fallback（仅补证，不在本卡实施）

1. 在 `File.read` 与 `File.list` 的边界校验前增加 Windows 盘符一致性判断（盘符不同直接拒绝）。
2. 将路径边界判定改为“`realpath` 后再 contains”，避免符号链接词法绕过。
3. 若 canonicalization 失败，保持 fail-closed（按越界拒绝）。

## 5) 当前卡片判定

- 一致性状态：`partial-consistent`（除 Windows cross-drive 风险外，其余行为路径一致）
- 发布建议：在补齐 Windows 盘符回归前，维持最保守权限策略（默认 `ask` + 越界拒绝）。
