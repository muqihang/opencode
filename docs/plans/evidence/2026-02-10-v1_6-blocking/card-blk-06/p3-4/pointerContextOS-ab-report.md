# CARD-BLK-06 / P3-4 `pointerContextOS` A/B 回放补证报告（I.4，fail-fast）

- 日期：2026-02-12
- 执行范围：仅补证（docs + 回放），未改 `packages/app/**`，未执行 push
- 证据目录（绝对路径）：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-4/`
- 样本清单：`pointerContextOS-ab-sample-list.csv`

## 1) 目标与口径

- 目标：验证 `pointerContextOS` 开关在同样本 A/B 下是否真实改变运行行为。
- A 组（OFF）：`pointerContextOS=OFF`（对照口径：非 pointer-first 路径）。
- B 组（ON）：`pointerContextOS=ON`（实验口径：pointer-first 路径）。
- 结果分类：`有效 / 无效 / 不稳定` 三选一。

## 2) 回放设计（fail-fast）

- 总样本：`20`（同口径 A/B 配对）。
- 场景分布：
  - `10` 条 `context-os-hydration` 回放（`test/session/context-os-hydration.test.ts`）
  - `10` 条 `context-os-cache-key` 回放（`test/session/context-os-cache-key.test.ts`）
- 执行策略（fail-fast）：每条样本先跑一次；若失败，立即单次重跑后终止，不做多轮重试。
- 本轮实际：`20/20` 首次通过，`pass_after_rerun=0`。

## 3) 开关 wiring 预检（补证）

- `packages/opencode/src/session/processor.ts` 显式将 gate 接到 `pointerContextOS`，并在 turn 执行时通过 `workingSetPointers` 路径生效。
- 额外回放：`bun --cwd packages/opencode test test/session/orchestrator-v15-b2-integration.test.ts --bail` 通过（用于补证 gate wiring 在 on/off 矩阵下可区分）。

## 4) 指标结果（A/B）

| 指标 | A（OFF） | B（ON） | Delta（B-A） |
| --- | ---: | ---: | ---: |
| `pointer_hit_rate` | `0.000` | `1.000` | `+1.000` |
| `claim_verify_rate` | `1.000` | `1.000` | `+0.000` |
| `rerun_count` | `0.000` | `0.000` | `+0.000` |

补充统计：

- 行级状态：`pass=20`，`fail=0`。
- `pointer_hit_rate` 方向一致性：`20/20` 样本均为 `B>A`。

## 5) 显著性判断

- 对 `pointer_hit_rate` 使用配对方向检验（等价 sign/McNemar 方向判定）：
  - 观测到 `B>A` 的配对数 `20`、`A>B` 为 `0`。
  - 在“方向无差异”零假设下，单侧 `p = 2^-20 = 9.54e-7`，方向差异显著。
- `claim_verify_rate` 与 `rerun_count`：A/B 完全持平，未见副作用恶化。

## 6) 结论（三选一）

- **结论：`有效`**。

判定理由：

1. `pointer_hit_rate` 在同样本 A/B 上出现稳定且显著的正向分离（`+1.000`）。
2. `claim_verify_rate` 未下降（`1.000 -> 1.000`）。
3. `rerun_count` 未上升（`0.000 -> 0.000`），fail-fast 下无额外重跑成本。

## 7) 边界与后续

- 本次为工程补证回放，样本来自可重复测试场景，不等同线上自然流量分布。
- 建议后续在同口径下补充线上/准线上抽样，以验证结论跨数据分布稳定性。

