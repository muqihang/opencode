# P2-4 Storage Layering Design（最小可验收）

- 日期：2026-02-12
- 卡片：`CARD-BLK-06 / P2-4`
- Owner：`P2-4-STORAGE-LAYERING-01`
- 分支：`codex/v16-p2-4-storage-layering`

## 1) 目标

在不破坏既有 evidence 默认读写路径的前提下，引入可开关的三层存储策略入口（L0/L1/L2），并支持最小双写与对账审计能力。

## 2) 分层职责

### L0（Legacy 兼容层）

- 证据目录：`.opencode/evidence/<sessionId>/`
- 产物目录：`.opencode/artifacts/<sessionId>/`
- 职责：兼容历史路径，作为默认回退层与双写镜像目标。

### L1（Tenant Namespace 主层）

- 证据目录：`.opencode/evidence/<tenantId>/<orgId>/<sessionId>/`
- 产物目录：`.opencode/artifacts/<tenantId>/<orgId>/<sessionId>/`
- 职责：承载租户隔离的主读写路径。

### L2（Layering 审计层）

- 证据目录：`.opencode/evidence-layering/<tenantId>/<orgId>/<sessionId>/`
- 产物目录：`.opencode/artifacts-layering/<tenantId>/<orgId>/<sessionId>/`
- 职责：承载分层治理与双写对账报告落盘（`dual-write-reconcile.json`）。

## 3) 策略入口与开关

策略入口文件：

- `packages/opencode/src/evidence/storage-layering.ts`

核心入口：

- `resolveStorageLayering(...)`
- `resolveMirrorPath(...)`

开关定义（环境变量）：

- `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING`
- `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE`
- `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE`
- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2`（租户 namespace 既有开关）

## 4) 读写策略（MVP）

### 默认模式（`storage layering` 关闭）

- `mode = legacy`
- 主写：L1（在 A2 enabled 情况下）
- 读回退：`[L1, L0]`（A2 enabled）或 `[L0]`（A2 disabled）
- 镜像：关闭

### 分层模式（`storage layering` 打开）

- `mode = layered`
- 主写：L1
- 双写镜像：可选写入 L0（`dual_write` 开启时）
- 对账：可选写入 L2 报告（`reconcile` 开启时）

## 5) 最小实现映射

- `packages/opencode/src/evidence/writer.ts`
  - 接入 `resolveStorageLayering`。
  - 新增 `writeDual` / `appendDual`，用于主写 + 镜像写。
  - 新增 `reconcile()`，生成 `storage-dual-write-reconcile/1.0` 报告。
- `packages/opencode/src/evidence/export.ts`
  - 在对账开启时附带导出 `reconcile/dual-write-reconcile.json`。

## 6) 租户边界

- L1/L2 必须显式包含 `tenantId/orgId/sessionId`，保证跨租户路径天然隔离。
- L0 仅作为兼容层，不承载租户隔离语义。
- export/read 在 A2 打开时优先 namespaced 路径，保持兼容回退。

## 7) TDD 证据（RED → GREEN）

### RED

- `Cannot find module '../../src/evidence/storage-layering'`
- `TypeError: writer.reconcile is not a function`

### GREEN

- 新增策略模块与 `writer.reconcile()` 后，通过：
  - `test/evidence/tenant-namespace.test.ts`
  - `test/evidence/export-tenant-compat.test.ts`

