# CARD-BLK-06 治理层 Need-Decision：I.1 unknown 风险升级单

- 日期：`2026-02-11`
- 角色：`Exec-AI-PMO`（仅 CARD-BLK-06）
- 触发来源：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/contract_delivery_vs_compliance.md`
- 约束：不改阈值、不改决策口径、不改业务代码

## 触发事实（来自统计草案）

- `contract_present=unknown (20/20)`
- `prompt_hash=unknown (20/20)`
- 当前仅可输出统计草案，不可 Final 主因签收。

## ND-I1-UNKNOWN-01（contract_present 可判别证据补齐）

- **Need-Decision ID**：`ND-I1-UNKNOWN-01`
- **目标**：补齐 message 级 `contract_present` 可判别证据（yes/no，不得 unknown）。
- **Owner（执行）**：`Exec-AI-SECURE`
- **Owner（签收）**：应用层负责人（实名）
- **SLA**：`2026-02-12 12:00 CST`
- **升级链路**：`Exec-AI-PMO -> 架构总控 -> Red 升级并维持 No-Go`
- **通过条件**：20 条样本的 `contract_present` 全量可判别，unknown 清零。

## ND-I1-UNKNOWN-02（prompt_hash 可判别证据补齐）

- **Need-Decision ID**：`ND-I1-UNKNOWN-02`
- **目标**：补齐 message 级 `prompt_hash` 可判别证据（可追溯且可核验）。
- **Owner（执行）**：`Exec-AI-SECURE`
- **Owner（签收）**：应用层负责人（实名）
- **SLA**：`2026-02-12 12:00 CST`
- **升级链路**：`Exec-AI-PMO -> 架构总控 -> Red 升级并维持 No-Go`
- **通过条件**：20 条样本的 `prompt_hash` 全量可判别，unknown 清零。

## 治理门禁（冻结）

- 在 `ND-I1-UNKNOWN-01/02` 任一未关闭前，`CARD-BLK-01` 仅允许“统计草案”状态。
- 未关闭前禁止 Final 主因签收。
