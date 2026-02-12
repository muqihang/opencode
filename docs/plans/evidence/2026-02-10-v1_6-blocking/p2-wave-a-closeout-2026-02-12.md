# V1.6 P2 Wave-A Closeout（2026-02-12，append-only）

- 执行时间：`2026-02-12 17:11:03 +0800`
- 执行分支：`feature/opencode-custom`
- 当前基线：`4b76387dce6fefc8943e7c48f159059f9dc6726a`
- 适用范围：`CARD-BLK-06 / P2 当前阶段（P2-1 + P2-2 + P2-4）` 闭环追加（不改历史正文）
- 关联文档：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/p2-wave-plan-2026-02-12.md`
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/governance-canonical-index.md`
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/blocking-clearance-checklist.md`

## 1) 合并链路与关键 commit（Wave-A）

1. `0e9de905e52f5a1971515f1542dcca18159efc42`
   - 时间：`2026-02-12 16:16:00 +0800`
   - 说明：`merge(v1.6): 合并 p2-1/freshness-metadata`
2. `8f4e6b2802f909410d4a36b271c433fbaab29ba1`
   - 时间：`2026-02-12 16:33:21 +0800`
   - 说明：`feat(v1.6): add hybrid lc-rag routing with orchestrator fallback`
3. `8aa8e95652de91c49696f503c56836760042c42a`
   - 时间：`2026-02-12 16:32:38 +0800`
   - 说明：`feat(v1.6): scaffold l0-l1-l2 storage layering with dual-write reconcile`
4. `a5228a79643e4ca803717c3f2ca3dca40e29b03c`
   - 时间：`2026-02-12 16:49:26 +0800`
   - 说明：`merge(v1.6): 合并 p2-2/hybrid-routing`（父链含 `0e9de905e` 与 `8f4e6b2802...`）
5. `4b76387dce6fefc8943e7c48f159059f9dc6726a`
   - 时间：`2026-02-12 17:02:00 +0800`
   - 说明：`merge(v1.6): 合并 p2-4/storage-layering`（父链含 `a5228a796...` 与 `8aa8e95652...`）

> Wave-A 合并主链：`0e9de905e -> a5228a796 -> 4b76387dc`；关键功能 commit：`8f4e6b2802...`、`8aa8e95652...`。

## 2) P2-1 / P2-2 / P2-4 门禁命令与 exit code 摘要

| 门禁项 | 命令 | exit code | 结果摘要 |
|---|---|---:|---|
| P2-1 freshness gate | `test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-1/freshness-metadata-spec.md && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-1/freshness-gate-report.md && bun --cwd packages/opencode test test/retrieval/code.test.ts test/retrieval/runner.test.ts` | `0` | `4 pass / 0 fail` |
| P2-2 hybrid-routing gate | `test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/hybrid-routing-policy.md && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/routing-ab-report.md && bun --cwd packages/opencode test test/session/llm.test.ts test/session/orchestrator-tool-broker.test.ts test/retrieval/e2e.test.ts` | `0` | `19 pass / 0 fail` |
| P2-4 storage-layering gate | `test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-4/storage-layering-design.md && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-4/dual-write-reconcile-report.md && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-4/migration-playbook.md && bun --cwd packages/opencode test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts` | `0` | `11 pass / 0 fail` |

## 3) 当前阶段判定（GO/BLOCKED）

- 当前阶段判定：`GO（P2 wave-a，本地）`
- 判定依据：`P2-1 / P2-2 / P2-4` 三条门禁命令均 `exit code = 0`。
- 边界声明：该结论仅覆盖 `wave-a` 当前阶段，不等同 `P2` 全量最终签收。

## 4) 剩余待办（未纳入本阶段签收）

1. `P2-5 本地安全与留存治理`
   - 当前状态：`todo`
   - 约束：可并行准备，但最终签收依赖 `P2-4` 接口冻结。
2. `P2-3 自动策略学习`
   - 当前状态：`todo`
   - 约束：收口项，需在 `P2-2` 稳定且 `P2-5` 护栏就绪后串行执行。

## 5) 风险与回滚口径（沿 BLK-06）

- 口径冻结：沿用 `CARD-BLK-06`，`append-only` 记录，不改阈值、不改历史结论。
- 风险 1（freshness 偏移）：若 `P2-1` 新评分引发误判，执行回滚为“关闭 freshness 评分开关，回退既有检索排序，保留观测落盘”。
- 风险 2（hybrid-routing 漂移）：若 `P2-2` 路由策略异常，执行回滚为“强制回退 orchestrator 主链，LC 仅保留诊断模式”。
- 风险 3（storage-layering 一致性）：若 `P2-4` 双写或迁移异常，执行回滚为“停用双写/新读路径，恢复 `L0` 单层读写并保留迁移日志”。
- 风险 4（阶段未全闭环）：`P2-5` 与 `P2-3` 尚未签收，任何后续门禁命令非 `0` 即将阶段状态从 `GO` 回切为 `BLOCKED`。

## 6) 历史结论覆盖声明（append-only）

- 本文为 `P2 wave-a` 增量闭环记录，仅解释“当前阶段状态”。
- 历史 `No-Go/Blocked` 条目全部保留原文，不删除、不改写。
