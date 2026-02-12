# CARD-BLK-06 / P3-11 执行卡（I.12）

- Owner: `Exec-AI-SECURE` + 平台负责人（待实名）
- 当前状态: `todo`
- 任务目标: 本地持久层权限策略跨平台一致性验证
- 是否仅补证/可能需要最小实现: `可能需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-11/`

## DoD

1. 产出 `local-persistence-permission-matrix.md`。
2. 产出 `permission-cross-os-regression.md`。
3. 明确是否需要平台特化 fallback。

## 依赖关系

- 建议在 `I.9` 字段集结论后执行。

## RollbackAction

- 跨平台不一致时回退最保守权限策略并暂停默认开启。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-11/local-persistence-permission-matrix.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-11/permission-cross-os-regression.md \
  && bun --cwd packages/opencode test test/permission/next.test.ts test/file/path-traversal.test.ts
```
