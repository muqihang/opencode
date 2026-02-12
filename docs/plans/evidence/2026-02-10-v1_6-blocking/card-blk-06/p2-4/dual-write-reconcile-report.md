# P2-4 Dual-Write Reconcile Report（MVP）

- 日期：2026-02-12
- 卡片：`CARD-BLK-06 / P2-4`
- Owner：`P2-4-STORAGE-LAYERING-01`
- 范围：最小双写对账骨架（可审计）

## 1) 报告目的

验证在 `layered + dual_write + reconcile` 开启时，EvidenceWriter 可生成结构化对账结果，并将报告落盘到 L2 审计层。

## 2) 报告文件路径

- 工作区内落盘路径模板：
  - `.opencode/evidence-layering/<tenantId>/<orgId>/<sessionId>/dual-write-reconcile.json`
- 本次测试 session：`export_reconcile`

## 3) 报告结构

`specVersion: storage-dual-write-reconcile/1.0`

关键字段：

- `summary.total`
- `summary.matched`
- `summary.mismatched`
- `results[]`
  - `path`
  - `primaryPath`
  - `mirrorPath`
  - `expectedSha256`
  - `primarySha256`
  - `mirrorSha256`
  - `status`
  - `match`

## 4) 对账判定（MVP）

- `match`：主副本 SHA 一致。
- `mismatch`：主副本 SHA 不一致，或预期 SHA 与主写不一致。
- `missing_mirror`：镜像缺失。
- `missing_primary`：主写缺失。
- `mirror_disabled`：镜像关闭，视为非失败。
- `unmapped`：路径不在镜像映射范围，视为非失败。

## 5) 执行证据（TDD）

### RED

- 失败用例：`writer.reconcile is not a function`

### GREEN

通过用例：

- `test/evidence/export-tenant-compat.test.ts`
  - `writes auditable dual-write reconcile report when storage layering is enabled`

用例断言：

- 对账报告文件存在。
- `summary.mismatched === 0`。
- `results` 至少存在一条 `match === true` 记录。

## 6) 结论（MVP）

- 双写对账最小实现已具备可审计产出。
- 默认路径未改（可回退），仅在 feature flag 开启时启用分层对账行为。

