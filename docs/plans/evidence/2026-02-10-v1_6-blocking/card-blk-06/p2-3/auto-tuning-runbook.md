# Auto-Tuning Runbook（P2-3）

- generatedAt: 2026-02-12T12:20:00.000Z
- scope: card-blk-06/p2-3
- mode: advisory + canary（受控建议模式）
- autoApply: false

## 0) 模式声明（必须项）

- 本流程固定为“受控建议模式（advisory/canary），非自动落参”。
- 系统只生成建议参数与风险评估，不会自动写入线上配置。
- 任何护栏触发或人工否决时，立即执行回滚动作：**冻结建议+回到上一版人工签收参数**。

## 1) 可调参数定义

| 参数键 | 含义 | 当前人工签收值（before） | 建议区间 | 步长/离散集 | 变更风险 |
| --- | --- | --- | --- | --- | --- |
| retrieval.topK | 检索召回条数 | 8 | 6 ~ 12 | 1 | 中（影响成本与噪声） |
| rerank.minScore | 重排最小阈值 | 0.58 | 0.50 ~ 0.70 | 0.02 | 中（影响召回/精度平衡） |
| route.compensationGate | 补偿链路门控 | balanced | strict / balanced | 离散值 | 中高（影响回退触发率） |
| llm.temperature | 生成采样温度 | 0.20 | 0.10 ~ 0.35 | 0.05 | 中（影响稳定性） |
| timeout.ms | 单轮超时阈值 | 12000 | 9000 ~ 14000 | 500 | 中（影响失败率/延迟） |

约束：

- 每轮 canary 最多调整 2 个参数，避免联动放大效应。
- 不允许同一参数在单窗口内多次反向调整。
- 建议参数必须可回放：保留 before/after 与建议理由。

## 2) 护栏（offline / online）

### 2.1 Offline 护栏（先验门）

满足以下全部条件才允许进入 canary：

- 样本覆盖：离线回放样本 `>= 500`。
- 质量约束：关键任务成功率相对基线 `>= -0.3pp`。
- 幻觉约束：高风险错误率相对基线 `<= +0.2pp`。
- 成本约束：单位请求成本相对基线 `<= +3%`。

阻断动作：

- 任一条件不满足，停止推进到 online。
- 记录阻断原因并执行：**冻结建议+回到上一版人工签收参数**。

### 2.2 Online 护栏（canary 门）

canary 窗口内持续观测以下指标：

- `p95 latency` 相对基线 `<= +8%`。
- `tool error rate` 相对基线 `<= +0.2pp`。
- `fallback rate` 相对基线 `<= +1.0pp`。
- `用户负反馈率` 相对基线 `<= +0.5pp`。

触发动作：

- 任一指标连续 2 个采样周期超阈值，立即停止建议推进。
- 当班负责人执行：**冻结建议+回到上一版人工签收参数**。

## 3) 人工接管点

| 接管点 | 触发时机 | 人工动作 | 输出产物 |
| --- | --- | --- | --- |
| T0-基线签收 | canary 前 | 确认上一版人工签收参数为唯一生效基线 | `snapshots/params-manual-v_prev.json` |
| T1-建议审阅 | offline 通过后 | 审阅建议清单（before/after/reason/risk）并批准是否进入 canary | `snapshots/params-advisory-v_next.json` |
| T2-窗口值守 | canary 进行中 | 每 15 分钟人工确认护栏状态；异常可一键冻结建议 | `metrics/canary-window-*.json` |
| T3-异常处置 | 护栏触发时 | 立即执行“冻结建议+回到上一版人工签收参数”并记录事件 | `logs/anomalies-*.log` |
| T4-窗口收口 | canary 结束后 | 人工签收“采纳/拒绝/延后”，未签收不得落参 | `auto-tuning-canary-report.md` |

## 4) 执行步骤（标准流程）

1. 固化基线：导出上一版人工签收参数快照。
2. 生成建议：离线评估产出建议清单（仅建议，不应用）。
3. 离线门控：按 offline 护栏逐项判定，失败即终止。
4. 进入 canary：按 5% 流量窗口观测，不做自动写参。
5. 人工值守：每 15 分钟检查 online 护栏与异常告警。
6. 异常回退：触发阈值时执行“冻结建议+回到上一版人工签收参数”。
7. 窗口收口：形成 canary report，明确建议采纳结论。
8. 人工签收：仅在人工签收后，后续发布流程才可手动落参。

## 5) 产物路径（Evidence）

- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-canary-report.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/snapshots/params-manual-v_prev.json`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/snapshots/params-advisory-v_next.json`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/metrics/canary-window-2026-02-12.json`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/logs/anomalies-2026-02-12.log`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/logs/freeze-and-rollback-2026-02-12.md`

## 6) 执行声明

- 本 runbook 明确采用 advisory/canary 受控建议模式。
- 本 runbook 明确禁止自动落参，所有参数变更必须人工签收。
- 本 runbook 明确回滚动作为“冻结建议+回到上一版人工签收参数”。
