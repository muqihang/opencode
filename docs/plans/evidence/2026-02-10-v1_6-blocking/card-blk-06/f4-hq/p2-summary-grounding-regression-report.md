# F4-HQ-P2-EXEC-SUMMARY-GROUNDING-01 Regression Report

## 变更摘要
- 扩展 `verification intent` 识别词：总结/交接/复盘/续接/report/resume/handoff 等。
- 强化 `reference_check_policy` 文本：
  - 事实必须 `file:line`
  - 路径必须来自已提供或已读取证据，禁止编造路径/数量
  - 数量与结论无证据必须 `unknown/evidence_insufficient`
- 保持 `workers=off` 情况下 policy 仍可注入。

## RED 证据（先失败）
1. `orchestrator-features` 新增“summary/handoff intents”测试在旧实现下失败：
   - 失败点：`hasVerificationIntent` 期望 `true`，实际 `false`
2. `orchestrator-turn` 强化 policy 文本断言在旧实现下失败：
   - 失败点：缺少“路径必须来自已提供或已读取的证据”

## GREEN 证据（修复后通过）
- `orchestrator-features` 新增与既有测试全部通过。
- `orchestrator-turn` policy 注入与文本约束断言通过（包含 workers=off）。

## 规则触发前后对比
| 意图样例 | 修复前 hasVerificationIntent | 修复后 hasVerificationIntent |
|---|---:|---:|
| 请做复盘并输出结论 | false | true |
| 请写一个交接说明 | false | true |
| please provide a report | false | true |
| prepare a handoff note | false | true |
| 请给引用和证据 | true | true |

## 仍存风险
1. 模型仍可能输出低价值泛化建议（例如“建议进一步确认”这类宽泛表达）。
2. 在证据不足场景，模型可能过度保守输出 `unknown/evidence_insufficient`，影响可读性。
3. 但在本修复后，结论链路要求可追溯：事实需 `file:line`，无证据需显式标记，不再允许路径/数量编造。

## 结论
本卡修复将“总结/交接/复盘类输出”纳入强制 reference-check 口径，直接降低脱锚总结风险，并保持现有 orchestrator 执行语义不变。
