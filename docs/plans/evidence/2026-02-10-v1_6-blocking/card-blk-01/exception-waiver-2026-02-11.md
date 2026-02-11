# CARD-BLK-01 Exception Waiver（2026-02-11）

- 范围约束：仅治理文档收口；不改阈值、不改规则、不改业务代码。
- 决策背景：`CARD-BLK-01` 在统计草案层面可继续推进，但 `provider-wire` 证据尚未补齐。

## 1) Decision Snapshot

- Decision: `Conditional Go (Exception)`
- D2 Execution Gate: `Go`（仅限 D2 统计执行）
- Final Gate Status: `No-Go (unchanged)`
- Blocker: `ND-I1-PROVIDER-WIRE-01 (open)`
- Risk Acceptance Owner: `muqihang`
- Decision Effective Time: `2026-02-11 20:30:00 CST`
- Expiration/Review Time: `2026-02-12 12:00:00 CST`

## 2) Scope of Exception

- 仅放行当前迭代的 `D2` 统计执行与治理推进。
- 本例外放行不等于 `CARD-BLK-01` Final 主因签收，不得将状态标记为 Final Go。
- 唯一阻断项保持不变：`ND-I1-PROVIDER-WIRE-01`。

## 3) Rollback Trigger

- 到 `2026-02-12 12:00:00 CST` 若 `provider-wire` 仍未达到 `20/20 complete`，立即恢复并维持 `Red + Final No-Go`。
- 任一必填字段存在 `unknown/na/n/a/tbd`，视为未补齐，不得触发 Final 签收。

## 4) Required Backfill Fields（必须 20/20）

1. `provider_request_id`
2. `provider_prompt_hash`
3. `provider_prompt_snapshot_ref`
4. `provider_sent_at_utc`
5. `provider_model_id`
6. `provider_audit_log_ref`
7. `receiver_signoff_name`
8. `receiver_signoff_at_cst`

## 5) Audit Trail Links（绝对路径）

- Tracker：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/owner-signoff-tracker-2026-02-11.md`
- Checklist：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/blocking-clearance-checklist.md`
- Canonical：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/governance-canonical-index.md`
- Progress Report：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-progress-report-2026-02-11.md`
- Intake：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-intake-2026-02-11.csv`
- Contract Draft：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/contract_delivery_vs_compliance.md`

## 6) Gate Boundary（保持冻结）

- `D2 统计执行 = Go`（基于例外放行，带风险接受）。
- `CARD-BLK-01 Final = No-Go`（不变，禁止误写成 Final Go）。
- `ND-I1-PROVIDER-WIRE-01 = open`（唯一阻断，未关闭）。
- 不新增其他阻断项，不调整阈值定义。
