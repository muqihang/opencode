# CARD-BLK-06 日报发布前校验清单（1页）

- 日期：`2026-02-10`
- 责任角色：`Exec-AI-PMO`
- 适用范围：`V1.6 阻断项每日报告` 发布前最后校验
- 约束：不改阈值、不改决策口径、不改业务代码
- Canonical 依据：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/governance-canonical-index.md`

## 发布门禁（全部通过才可发布）

| Gate ID | 校验项 | 通过标准 | 失败处理 |
|---|---|---|---|
| G-01 | 双指标齐全（`card_progress`） | 日报正文存在并填写 `card_progress（x/6）` | 退回，不得发布 |
| G-02 | 双指标齐全（`task_progress`） | 日报正文存在并填写 `task_progress（x/13）` | 退回，不得发布 |
| G-03 | Canonical 引用已写入 | 日报正文显式声明“以 canonical-index 为准”并给出绝对路径 | 退回，不得发布 |

## 发布前逐项勾检

- [ ] 已填写 `card_progress（x/6）`
- [ ] 已填写 `task_progress（x/13）`
- [ ] 已写入 canonical 声明与绝对路径
- [ ] 未改阈值
- [ ] 未改决策口径
- [ ] 未改业务代码

## 一票否决规则

- 缺任一项：`立即退回，不得发布`。
- 仅当以上项目全部为“已通过/已勾选”时，允许发布日报。

## 发布签核（CARD-BLK-06）

- 校验人（Exec-AI-PMO）：
- 校验时间：
- 校验结论：`通过 / 退回`
- 退回原因（如有）：
