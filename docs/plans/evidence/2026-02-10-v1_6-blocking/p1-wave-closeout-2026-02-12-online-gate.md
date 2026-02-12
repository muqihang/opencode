# V1.6 P1 Online-Gate Closeout（2026-02-12，append-only）

- 执行时间：`2026-02-12`
- 执行分支：`feature/opencode-custom`
- 适用范围：`BLK-06 / P1 online-gate` 增量闭环（仅补充当前状态，不改历史正文）
- 关联文档：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/p1-wave-closeout-2026-02-12.md`

## 1) 本轮 commit 链（增量）

1. `0ef097f4`
   - 说明：`merge(v1.6): 合并 p1/eval-50-nightly`
2. `e717bd24`
   - 说明：`merge(v1.6): 合并 p1/online-dashboard-alert`
3. `727e04d8`
   - 说明：`fix(v1.6): skip baseline h2 breaches on empty online-gate windows`

> 注：本条按 append-only 记录新增链路，历史链路（如 `4b013eac -> 1d23cc4b -> 447e2861 -> 65684f09`）保持原文不改。

## 2) P1 总门禁命令列表 + 结果摘要（exit code）

| 门禁项 | 命令 | exit code | 结果摘要 |
|---|---|---:|---|
| C2 | `bun --cwd packages/opencode test test/session/orchestrator-workers-v2.test.ts test/session/orchestrator-evidence-critic.test.ts test/session/orchestrator-integration-v2.test.ts` | `0` | `21 pass / 0 fail` |
| C3 | `bun --cwd packages/opencode test test/session/llm.test.ts` | `0` | `8 pass / 0 fail` |
| C4 | `bun --cwd packages/opencode test test/session/orchestrator-turn.test.ts` | `0` | `5 pass / 0 fail` |
| C5（eval-50-nightly 相关） | `bun --cwd packages/opencode test test/eval/offline-gate.test.ts test/eval/offline-regression.test.ts` | `0` | `11 pass / 0 fail` |
| C6（online-dashboard-alert + online-gate） | `bun --cwd packages/opencode test test/eval/online-gate.test.ts` | `0` | `4 pass / 0 fail` |
| G1（nightly gate） | `OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES=true bun packages/opencode/script/test-offline-eval-nightly.ts`（在临时目录执行） | `0` | `offline eval nightly completed / passed: yes` |
| G2（online dashboard/alert gate） | `bun packages/opencode/script/build-online-gate-dashboard.ts --evidenceDir=<tmp> --artifactsDir=<tmp> --dashboard=<tmp> --summary=<tmp> --alert=<tmp>`（在临时目录执行） | `0` | `status: warn / gatePassed: no`（非 fail） |

## 3) 当前判定（GO/BLOCKED）

- 当前判定：`GO（本地）`
- 判定依据：本轮 `P1` 总门禁命令 exit code 全部为 `0`，无 `fail` 级门禁。
- 风险提示：`G2` 为 `warn`（`gatePassed: no`），但未触发 `fail`，不构成当前阻断。

## 4) 非阻塞噪音项（offline-eval 产物）与处理建议

- 噪音项（工作区产物，未纳入本次 docs 提交）：
  - `packages/opencode/offline-eval-report.json`（modified）
  - `packages/opencode/offline-eval-summary.md`（modified）
  - `packages/opencode/offline-eval-nightly-report.json`（untracked）
  - `packages/opencode/offline-eval-nightly-summary.md`（untracked）
- 当前判定：`非阻断`，不影响本条 BLK-06 文档闭环与当前 `GO（本地）` 结论。
- 处理建议：
  1. 产物清理与本次 docs 变更解耦，后续单独清理或单独提交；
  2. 若需保留，按一次完整 offline-eval/nightly 重跑后再提交产物；
  3. 在发布检查清单中保留“offline-eval 产物脏文件”显式核对项，避免误入发布提交。

## 5) 历史结论覆盖声明（append-only）

- 历史 `No-Go` 仅为时点证据，本条为增量覆盖说明。
- 覆盖关系仅用于解释“当前状态”，不删除、不改写历史正文，不影响审计可追溯性。
