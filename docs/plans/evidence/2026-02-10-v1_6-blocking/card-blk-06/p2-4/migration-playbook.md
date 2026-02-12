# P2-4 Migration Playbook（L0/L1/L2 + 双写对账）

- 日期：2026-02-12
- 卡片：`CARD-BLK-06 / P2-4`
- Owner：`P2-4-STORAGE-LAYERING-01`

## 1) 目标

在生产可控范围内，将 evidence 写路径从单层兼容模式演进到分层可治理模式，并保留快速回退能力。

## 2) 开关与阶段

### 阶段 A：基线（默认）

- `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING`：关闭
- `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE`：关闭
- `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE`：关闭
- 行为：维持现有主路径（L1/L0 兼容读），无双写无对账。

### 阶段 B：分层预热

- 打开 `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING=1`
- 保持 `DUAL_WRITE/RECONCILE` 关闭
- 行为：启用分层策略入口，但不引入写放大。

### 阶段 C：双写灰度

- 打开 `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE=1`
- 行为：L1 主写 + L0 镜像。

### 阶段 D：对账可观测

- 打开 `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE=1`
- 行为：生成并落盘 `dual-write-reconcile.json`，纳入审计。

## 3) 切换步骤

1. 先启 A2（如需租户 namespace）：`OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2=1`。
2. 按阶段 A → B → C → D 逐步放量，不跨级。
3. 每次提级后执行：
   - `bun run typecheck`
   - `bun test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail`
4. D 阶段确认对账报告持续产生且 `mismatched` 可控。

## 4) 失败与回退

### 触发条件

- `dual-write-reconcile` 连续出现不可接受 `mismatch`。
- 导出链路出现不可恢复异常。

### 回退步骤（无停机）

1. 先关 `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE`。
2. 再关 `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE`。
3. 必要时关 `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING`。
4. 保持 A2 与 legacy 读回退能力，恢复 L0/L1 单路径运行。

## 5) 停机影响说明

- MVP 设计为无停机切换：均为运行时开关控制，不涉及阻塞式历史迁移。
- 双写阶段会带来有限 IO 放大；建议在低峰灰度。
- 对账仅新增审计文件写入，不改变业务返回契约。

## 6) 运维巡检清单

- 对账文件存在率：`dual-write-reconcile.json`。
- 对账摘要：`summary.mismatched` 趋势。
- 导出完整性：`reconcile/dual-write-reconcile.json` 可随 evidence 包导出（开启时）。
- 租户隔离：路径包含 `<tenantId>/<orgId>/<sessionId>`。

