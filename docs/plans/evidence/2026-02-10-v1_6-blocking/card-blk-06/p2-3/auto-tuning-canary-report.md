# Auto-Tuning Canary Report（P2-3）

- generatedAt: 2026-02-12T13:05:00.000Z
- window: 2026-02-12 10:00 ~ 12:00（UTC+8）
- traffic: 5% canary
- mode: advisory + canary（受控建议模式）
- autoApply: false（非自动落参）

## 0) 模式与回滚声明

- 本轮仅执行“受控建议模式（advisory/canary）”，系统不自动写入生产参数。
- 所有建议均需人工签收；未签收视为不生效。
- 回滚标准动作固定为：**冻结建议+回到上一版人工签收参数**。

## 1) 本轮窗口指标

基线版本：`manual-v_prev`（上一版人工签收参数）

| 指标 | 基线 | 本轮窗口 | 变化 | 阈值 | 结果 |
| --- | --- | --- | --- | --- | --- |
| success rate | 96.1% | 96.4% | +0.3pp | 不低于 -0.3pp | 通过 |
| p95 latency | 2.80s | 2.92s | +4.3% | 不高于 +8% | 通过 |
| tool error rate | 0.62% | 0.67% | +0.05pp | 不高于 +0.2pp | 通过 |
| fallback rate | 4.20% | 4.80% | +0.60pp | 不高于 +1.0pp | 通过 |
| negative feedback | 1.80% | 1.90% | +0.10pp | 不高于 +0.5pp | 通过 |
| cost / req | 1.00x | 1.02x | +2.0% | 不高于 +3% | 通过 |

结论：窗口指标全部落在护栏内，允许继续保留“建议态”，但仍未自动落参。

## 2) 建议清单（before / after / reason / risk）

| 参数 | before（人工签收） | after（建议值） | reason | risk | 处理结果 |
| --- | --- | --- | --- | --- | --- |
| rerank.minScore | 0.58 | 0.56 | 对长尾查询召回不足，降低阈值提升可用召回 | 中：可能引入轻度噪声 | 建议保留，待下一窗口复核 |
| retrieval.topK | 8 | 9 | 少量复杂问答存在上下文缺片，增加召回条数 | 中：成本小幅上升 | 建议保留，需人工确认成本预算 |
| timeout.ms | 12000 | 11000 | 无效长尾超时占用资源，收紧超时改善吞吐 | 中高：边缘慢查询可能失败 | 本轮不采纳，继续观察 |

说明：

- 上述 `after` 均为建议值，不代表线上生效值。
- 当前线上继续使用 `manual-v_prev`，等待人工签收后才可手工落参。

## 3) 异常记录

### 3.1 事件一：fallback 短时抬升

- 时间：2026-02-12 10:47（UTC+8）
- 现象：`fallback rate` 单点达到 `5.4%`，持续 1 个采样周期。
- 研判：外部检索源瞬时抖动导致补偿链路触发增加。
- 处置：值守人标记告警并持续观察；未连续 2 个周期超阈值，不触发回滚。

### 3.2 事件二：回滚演练（预案验证）

- 时间：2026-02-12 11:30（UTC+8）
- 动作：执行桌面演练，验证应急流程可在 3 分钟内完成。
- 演练结论：可按预案完成“冻结建议+回到上一版人工签收参数”。
- 说明：该演练未触发真实参数变更。

## 4) 结论

1. 本轮 canary 达到护栏通过条件，但保持 advisory 状态，不自动落参。
2. 可继续观察建议项 `rerank.minScore=0.56` 与 `retrieval.topK=9`，并补充成本样本。
3. `timeout.ms=11000` 暂不建议进入人工签收，避免对慢查询可用性产生额外风险。
4. 若后续窗口出现连续超阈值，立即执行回滚：**冻结建议+回到上一版人工签收参数**。

## 5) 审计留档

- reportOwner: P2-3-AUTO-TUNE-ONCALL
- reviewer: P2-3-TECH-LEAD
- baselineSnapshot: `snapshots/params-manual-v_prev.json`
- advisorySnapshot: `snapshots/params-advisory-v_next.json`
- anomalyLog: `logs/anomalies-2026-02-12.log`
