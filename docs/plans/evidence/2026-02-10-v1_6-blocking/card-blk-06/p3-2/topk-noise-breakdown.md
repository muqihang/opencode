# topK 噪声构成补证（I.2，>=50 样本）

- 卡片：`CARD-BLK-06 / P3-2`
- 生成时间（UTC）：`2026-02-12 13:19:20Z`
- 样本量：`60`（top5 命中，前 12 个非空 retrieval run 中截取）
- 标注文件：`topk-noise-labeled.csv`
- 结论：`立即调整 topK/rerank`

## 1) 数据来源与抽样口径

- 来源工件：`/Users/muqihang/chelingxi_workspace/test/.opencode/artifacts/local/default/ses_*/retrieval/*/hits.json`
- 抽样规则：按路径排序后顺序取样，累计到 `60` 条即停止；每个 run 取 `rank 1~5`。
- 标注标签：`snippet_valid / path_noise / invalid`。
- 冲突定义：`label_l1 != label_l2`（规则标注与复核标注不一致）。

## 2) 总体统计

| 指标 | 数值 |
| --- | --- |
| 样本总数 | 60 |
| snippet_valid | 0 (0.0%) |
| path_noise | 60 (100.0%) |
| invalid | 0 (0.0%) |
| 冲突率 | 0/60 = 0.0% |
| top5 正文占比（snippet_valid） | 0.0% |

## 3) 来源维度（source）

| source | 样本数 | snippet_valid | path_noise | invalid | 正文占比 |
| --- | ---: | ---: | ---: | ---: | ---: |
| tree | 60 | 0 | 60 | 0 | 0.0% |

## 4) rank 维度（1~5）

| rank | 样本数 | snippet_valid | path_noise | invalid | 正文占比 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 12 | 0 | 12 | 0 | 0.0% |
| 2 | 12 | 0 | 12 | 0 | 0.0% |
| 3 | 12 | 0 | 12 | 0 | 0.0% |
| 4 | 12 | 0 | 12 | 0 | 0.0% |
| 5 | 12 | 0 | 12 | 0 | 0.0% |

## 5) 高频 origin 路径（前 10）

- `config.json`: 12 次
- `data/cases/case_discount_vip.json`: 12 次
- `data/cases/case_risk_sy.json`: 12 次
- `data/cases/v2/case_alpha_sy_sanction.json`: 12 次
- `data/cases/v2/case_beta_margin_and_export.json`: 12 次

## 6) 结论与建议

- 冲突率 `0.0%`，未触发 `>15%` 扩样门槛。
- top5 正文占比仅 `0.0%`，显著低于既有口径 `>=80%`。
- **建议结论：`立即调整 topK/rerank`**（topK 样本正文占比远低于 80% 且冲突率未触发扩样门槛）。
- 建议动作：
  1. 在 rerank 前置“正文片段优先”策略，降低纯路径命中靠前概率；
  2. 对 `source=tree` 且 `snippet` 仅路径字符串的命中施加降权；
  3. 变更后复跑同口径样本，目标 `snippet_valid@5 >= 0.80`。

## 7) 风险说明

- 当前可用运行时工件中 `source` 仅出现 `tree`，未观测到 `code/workbench`。
- 因 source 覆盖受限，本结论更偏向“tree 通道噪声”而非全链路最终判定；建议下一轮补充 `code/workbench` 样本做交叉验证。
