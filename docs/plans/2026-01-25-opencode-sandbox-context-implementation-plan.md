# OpenCode Sandbox + Evidence Pack（PoC v1）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `opencode-zh-build/opencode_src` 的 OpenCode core 上实现 PoC v1：BashTool/PythonTool 进入“执行沙盒”（先软隔离），并生成可验证的 Evidence Pack（`pack.json`/`manifest.json`/`pack.md`），支持主会话与子会话（task 子代理）各自产证据。

**Architecture:** 复用 OpenCode 的 server 作为 daemon，在 server/core 层引入 `SandboxRunner`（执行统一入口）与 `EvidencePackWriter`（证据落盘）。工具层（BashTool/PythonTool）只负责权限询问与参数校验，执行与产物化交给 `SandboxRunner`，证据写入交给 `EvidencePackWriter`。

**Tech Stack:** TypeScript (Bun), OpenCode server/cli, `PermissionNext`, `bun test`。

---

## Task 0: 先对齐“目录与约定”（避免落地分叉）

**Files:**
- Modify: `opencode-zh-build/opencode_src/docs/plans/2026-01-25-opencode-sandbox-context-design.md`

**Step 1: 校对默认目录**
- 确认默认写入目录为：
  - `.opencode/evidence/<sessionId>/...`
  - `.opencode/artifacts/<sessionId>/...`

**Step 2: 校对命名与字段**
- 统一 `specVersion`、`packId`、`manifest specVersion` 等字段名。

---

## Task 1: 引入 Evidence Pack v1（最小可验收实现）

**Files:**
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/evidence/evidence-pack.ts`
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/evidence/manifest.ts`
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/evidence/writer.ts`
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/evidence/paths.ts`
- Test: `opencode-zh-build/opencode_src/packages/opencode/test/evidence/evidence-pack.test.ts`

**Step 1: 写一个 failing test（canonical JSON + manifest）**
- 在 `opencode-zh-build/opencode_src/packages/opencode/test/evidence/evidence-pack.test.ts`：
  - 构造一个最小 pack 对象
  - 断言 `stableStringify(pack)` 在多次调用下输出一致（稳定键顺序）
  - 断言 `manifest.entries[]` 包含 pack.json/pack.md

Run:
```bash
cd opencode-zh-build/opencode_src/packages/opencode
bun test test/evidence/evidence-pack.test.ts
```
Expected: FAIL（文件/导出不存在）

**Step 2: 实现最小 schema + stable stringify**
- `evidence-pack.ts`：定义最小类型（specVersion、packId、task、environment、claims、artifacts、checks、events、capsule、risks、rollback）。
- `writer.ts`：提供 `writePack({ sessionId, pack, viewMarkdown, manifestEntries })`：
  - 生成 `.opencode/evidence/<sessionId>/pack.json`（canonical）
  - 生成 `.opencode/evidence/<sessionId>/pack.md`（view）
  - 生成 `.opencode/evidence/<sessionId>/manifest.json`
- `paths.ts`：集中提供目录：
  - `evidenceDir(sessionId)`、`artifactsDir(sessionId)`、`sandboxesDir(sessionId)`
  - 基于 `Instance.worktree`（repo 有 vcs）或降级到 `Global.Path.data`（无 vcs）与 OpenCode 现有逻辑保持一致

**Step 3: 跑测试**
Run:
```bash
cd opencode-zh-build/opencode_src/packages/opencode
bun test test/evidence/evidence-pack.test.ts
```
Expected: PASS

---

## Task 2: 引入 SandboxRunner（PoC 先做 soft backend）

**Files:**
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/sandbox/sandbox-runner.ts`
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/sandbox/backends/soft.ts`
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/sandbox/types.ts`
- Test: `opencode-zh-build/opencode_src/packages/opencode/test/sandbox/soft-runner.test.ts`

**Step 1: 写 failing test（能产出 stdout/stderr artifact）**
- 在 `soft-runner.test.ts`：
  - 创建临时 project（复用 `tmpdir({ git: true })` fixture）
  - `Instance.provide({ directory: tmp.path, fn })`
  - 调用 `SandboxRunner.run()` 执行 `echo test`
  - 断言返回 `stdoutArtifactPath` 文件存在且包含 `test`

Run:
```bash
cd opencode-zh-build/opencode_src/packages/opencode
bun test test/sandbox/soft-runner.test.ts
```
Expected: FAIL

**Step 2: 实现 soft backend**
- `types.ts`：定义 `SandboxBackend` / `SandboxCapability` / `SandboxRunRequest` / `SandboxRunResult`（与设计稿 Section 13.1 一致）。
- `backends/soft.ts`：
  - 仍然使用 `child_process.spawn`（或 `Bun.spawn`），但必须：
    - cwd 只能落在 `.opencode/sandboxes/<sessionId>/workdir`（默认）
    - stdout/stderr 必须落盘到 `.opencode/artifacts/<sessionId>/...`
    - 强制 timeout + killTree（复用 `Shell.killTree`）
  - 将“这是 soft 隔离”的风险写入 result（例如 `backend: 'soft'`），后续 Evidence Pack provenance 会记录

**Step 3: 跑测试**
Expected: PASS

---

## Task 3: 让 BashTool 走 SandboxRunner，并生成 Evidence Pack（P0 验收核心）

**Files:**
- Modify: `opencode-zh-build/opencode_src/packages/opencode/src/tool/bash.ts`
- Modify: `opencode-zh-build/opencode_src/packages/opencode/test/tool/bash.test.ts`

**Step 1: 写 failing test（bash 执行后会生成 evidence 目录）**
- 在 `bash.test.ts` 增加一个用例：
  - 执行一次 bash tool（sessionID 固定为 `test`）
  - 断言 `.opencode/evidence/test/pack.json` 存在
  - 断言 manifest 包含 stdout artifact 条目

Run:
```bash
cd opencode-zh-build/opencode_src/packages/opencode
bun test test/tool/bash.test.ts
```
Expected: FAIL

**Step 2: 改 BashTool 的执行链路**
- 保留现有的：
  - zod 参数校验
  - tree-sitter 解析 + PermissionNext.ask（bash/external_directory）
- 替换掉 `spawn(params.command, ...)`：
  - 调用 `SandboxRunner.run({ sessionId: ctx.sessionID, toolName: 'bash', command: params.command, ... })`
  - stdout/stderr 不再直接拼接到内存，而是：
    - metadata.output 只保留截断预览（从 stdout artifact 读取前 N 字节）
    - 长输出只回传指针（artifact path + sha256）
- 执行后调用 `EvidencePackWriter`：
  - 写 `pack.json`（最小 claims/checks/events）
  - 写 `pack.md`（view）
  - 写 `manifest.json`

**Step 3: 跑测试**
Expected: PASS（需要视现有测试对 metadata.output 的断言调整）

---

## Task 4: 增加 PythonTool（P1 的核心前置，PoC 也可先只支持内置脚本）

**Files:**
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/tool/python.ts`
- Modify: `opencode-zh-build/opencode_src/packages/opencode/src/tool/registry.ts`
- Test: `opencode-zh-build/opencode_src/packages/opencode/test/tool/python.test.ts`

**Step 1: 写 failing test（python tool 能生成 JSON 输出 artifact）**
- 先用最小脚本：`print("{\\"ok\\": true}")`
- 断言：
  - stdout artifact 存在
  - evidence pack 存在且 artifacts 列表登记了 stdout

**Step 2: 实现 PythonTool（最小但可控）**
- PoC v1 推荐先实现“内置脚本模式”：
  - 不接受任意 code string（避免任意执行）
  - 只接受 `scriptId`（内置脚本目录）
  - 输入/输出通过 artifact 文件路径传递（避免大文本回填）
- 依赖与网络默认禁用（deny_all）

**Step 3: 跑测试**
Run:
```bash
cd opencode-zh-build/opencode_src/packages/opencode
bun test test/tool/python.test.ts
```
Expected: PASS

---

## Task 5: 子会话（task 子代理）也能产 micro-pack（P1 一致性）

**Files:**
- Modify: `opencode-zh-build/opencode_src/packages/opencode/src/tool/task.ts`
- Test: `opencode-zh-build/opencode_src/packages/opencode/test/tool/task-evidence.test.ts`

**Step 1: 写 failing test（task 子会话会生成自己的 evidence）**
- 创建临时 project
- 直接调用 TaskTool 的 execute（或用更高层 prompt）创建子 session
- 断言子 session id 对应的 `.opencode/evidence/<subSessionId>/pack.json` 存在

**Step 2: 实现“子会话 evidence 自动初始化”**
- 在 session 创建或 tool/task 结束时：
  - 写入 micro-pack（至少包含：子会话的 capsule 指针、执行事件、产物索引）
- 注意：PoC 阶段不要求 macro 合并（合并可放到 P2），但至少要让主会话拿到子会话 pack 的路径指针

**Step 3: 跑测试**
Expected: PASS

---

## Task 6: Evidence 导出命令（PoC 闭环的“交付出口”）

**Files:**
- Create: `opencode-zh-build/opencode_src/packages/opencode/src/cli/cmd/evidence.ts`
- Modify: `opencode-zh-build/opencode_src/packages/opencode/src/index.ts`
- Test: `opencode-zh-build/opencode_src/packages/opencode/test/cli/evidence-export.test.ts`

**Step 1: 写 failing test（给定 sessionId，会把 `.opencode/evidence/<id>` 复制到输出目录）**
- 在 `evidence-export.test.ts`：
  - 创建临时 project（git=true）
  - 手工写入一个最小 `.opencode/evidence/<sessionId>/pack.json` 与 `manifest.json`
  - 调用 command handler（或拆出的 `exportEvidence()` 函数）导出到 `./evidence/<sessionId>/`
  - 断言导出目录存在且文件 sha256 与源一致

**Step 2: 实现 `opencode evidence export`**
- yargs command：`evidence export [sessionID] --out <dir>`
- 安全约束（PoC v1 最小实现）：
  - 源目录只允许 `.opencode/evidence/<sessionId>/`
  - 目标目录必须在项目根内（`Instance.containsPath`），防止写出越界
  - 只复制 allowlist 文件（`pack.json`/`pack.md`/`manifest.json` + manifest.entries 指向的 artifacts）

**Step 3: 注册到 CLI**
- 在 `opencode-zh-build/opencode_src/packages/opencode/src/index.ts` 增加 `.command(EvidenceCommand)`

**Step 4: 跑测试**
Run:
```bash
cd opencode-zh-build/opencode_src/packages/opencode
bun test test/cli/evidence-export.test.ts
```
Expected: PASS

---

## 验证与回归（每次提交前）

Run:
```bash
cd opencode-zh-build/opencode_src/packages/opencode
bun test
bun run typecheck
```

Expected:
- `bun test` 全绿
- `typecheck` 全绿
