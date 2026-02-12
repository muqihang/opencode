# CARD-BLK-06 / P2-3 执行卡

- Owner: TBD
- 当前状态: todo
- ETA: Wave-4（收口项，最后串行执行）
- EvidencePath: /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/

## DoD

1. 产出 `auto-tuning-runbook.md`，明确定义可调参数、护栏、人工接管点。
2. 产出 `auto-tuning-canary-report.md`，包含 canary 窗口内指标变化与异常记录。
3. 输出“调参前后”对比并保留参数快照，满足可回放与可审计。

## 依赖关系

- 依赖 `P2-2` 路由稳定、`P1-5` 线上灰度看板可用、`P2-5` 安全护栏就绪。

## 并行性判断

- 收口项，建议最后串行执行。

## RollbackAction

- 冻结自动调参，恢复上一个人工签收参数快照。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-canary-report.md \
  && bun --cwd packages/opencode test test/eval/offline-gate.test.ts test/eval/online-gate.test.ts \
  && OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES=true bun packages/opencode/script/test-offline-eval-nightly.ts
```

