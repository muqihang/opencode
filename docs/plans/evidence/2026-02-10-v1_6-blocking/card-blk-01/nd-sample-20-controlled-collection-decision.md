# ND-SAMPLE-20 受控采集执行决策（S03~S20）

- 日期：`2026-02-11`
- 决策角色：`Exec-AI-PMO`（仅 CARD-BLK-06）
- 决策目标：在不改变 20 条门槛前提下，将样本来源方式从“等待自然样本”升级为“test 工作区受控运行采集”。
- 不变约束：不改阈值、不改决策口径、不改业务代码。
- Canonical 依据：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/governance-canonical-index.md`

## 1) 执行决策（立即生效）

1. 样本门槛保持不变：总门槛仍为 `20/20`。
2. 来源策略升级：S03~S20 改为受控采集来源 workspace=`/Users/muqihang/chelingxi_workspace/test`。
3. 执行人固定：`Exec-AI-SECURE`；抄送：`应用层负责人`。
4. 采集目标固定：补齐 `S03~S20`（18条），并保留每条 `message_id/session_id + input/output/replay 三联绝对路径`。

## 2) 时间窗与检查点

- `T0`（启动时刻）：`2026-02-11 12:13:28 CST`
- `T0+60m` 检查点：`2026-02-11 13:13:28 CST`
- `T0+120m` 检查点：`2026-02-11 14:13:28 CST`
- 截止时间：`2026-02-11 18:00:00 CST`

| 检查点 | 检查范围 | 通过标准 | 未通过动作 |
|---|---|---|---|
| T0+60m | S03~S20 采集进度 | 至少完成首批可验证回填（message/session + 三联） | 由 Exec-AI-PMO 发起一次催办，锁定阻塞条目 |
| T0+120m | S03~S20 采集进度 | 未闭环条目显著下降并形成逐条回填记录 | 由 Exec-AI-PMO 升级架构总控，要求按条清缺 |
| 截止时间 | 全量 20 条门槛 | 达到 `20/20` 才可进入统计 | 若仍 `<20/20`，维持 `No-Go + Red` 升级 |

## 3) 回填入口与证据约束

- 执行包：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-request-pack-2026-02-11.md`
- 回填入口：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv`
- 字段要求（逐条）：`sample_id,message_id,session_id,input_abs_path,output_abs_path,replay_abs_path,source_workspace,collected_at,provider_owner,status,verify_exists`
- 校验要求：`verify_exists` 仅允许 `yes/no`。

## 4) 失败处理（冻结）

- 任一条缺 `message_id/session_id` 或三联路径：该条 `status=blocked`，必须记录升级动作。
- 截止时间仍 `<20/20`：维持 `No-Go`，并执行 `Red` 升级，不得进入 CARD-BLK-01 统计。

## 5) Need-Decision

- 是否确认应用层负责人实名并按受控采集时间窗执行（建议：确认，立即生效）。
