# CARD-BLK-06 / P3-9 执行卡（I.9）

- Owner: `Exec-AI-SESSION` + provider 适配负责人（待实名）
- 当前状态: `todo`
- 任务目标: `anchor-snapshot` 字段覆盖与恢复一致性验证
- 是否仅补证/可能需要最小实现: `可能需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-9/`

## DoD

1. 产出 `anchor-snapshot-provider-coverage.md`（至少 3 种 provider）。
2. 产出 `anchor-recovery-consistency-report.md`（至少 2 种 compaction 路径）。
3. 给出字段集“可维持/需扩展”结论。

## 依赖关系

- 依赖 `P0-A6 anchor-snapshot/1.0` 可回放。

## RollbackAction

- 一致性不达标则维持 provider 白名单并限制 compaction 路径。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-9/anchor-snapshot-provider-coverage.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-9/anchor-recovery-consistency-report.md \
  && bun --cwd packages/opencode test test/session/capsule-protocol.test.ts test/session/compaction-structured.test.ts
```
