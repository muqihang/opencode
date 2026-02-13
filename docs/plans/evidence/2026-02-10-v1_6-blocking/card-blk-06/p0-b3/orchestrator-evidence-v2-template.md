# orchestrator_evidence_v2 注入模板（P0-B3 最小实现）

## 目标

- 将主脑注入从 `orchestrator` 升级为 `orchestrator_evidence_v2`。
- 保证注入主体优先承载证据，而不是状态噪音。
- 在预算受限时保持稳定、可预期的降级路径。

## 模板结构

```text
<orchestrator_evidence_v2>
mode: assist|heavy
verdict_json: { ...critic-verdict/2.0... }
evidence_digest:
- [E1] path=... sha=... anchor=... summary=...
- [E2] path=... sha=... anchor=... summary=...
- [E3] path=... sha=... anchor=... summary=...
missing_digest:
- requirement_id: reason
instruction_to_main_brain:
- fact claims MUST map to evidence ids
- if verdict=insufficient, answer with unknown-first
notes:
- broker / worker notes（预算允许时）
</orchestrator_evidence_v2>
```

## 字段约束

- `verdict_json`：必须是可 `JSON.parse` 的单行 JSON，schema 对齐 `critic-verdict/2.0`。
- `evidence_digest`：至少保留 3 条证据摘要；每条包含 `path + sha + anchor + summary`。
- `missing_digest`：无缺口时写 `- none`，避免结构缺失。
- `instruction_to_main_brain`：保留“claims 映射证据 + insufficient 走 unknown-first”约束。

## 噪音过滤

以下调试词不得进入注入：

- `from_model=`
- `to_model=`
- `gate_reason=`

