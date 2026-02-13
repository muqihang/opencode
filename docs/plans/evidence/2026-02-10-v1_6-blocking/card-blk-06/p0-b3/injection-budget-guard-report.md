# injection budget guard 报告（P0-B3 最小实现）

## 变更范围

- 代码：`packages/opencode/src/session/orchestrator/index.ts`
- 测试：`packages/opencode/test/session/orchestrator-integration-v2.test.ts`
- 未触及：`packages/app/**`

## 守卫策略

注入预算按近似 token 计（`ceil(chars / 4)`），预算上限 `900`。

### 1) Notes 先裁剪

- 先过滤路由调试噪音（`from_model/to_model/gate_reason`）。
- 丢弃超长 notes（作为预算噪音）。
- 若仍超预算，继续从尾部裁剪 notes，直到预算内或 notes 清空。

### 2) 低密度证据后裁剪

- 证据按密度排序（`snippets > hits > artifacts`）。
- 预算仍超限时，从低密度尾部裁剪。
- 强制保留最少 3 条证据摘要，满足 DoD。

### 3) 语义稳定性

- 不改 dual-pass 判定路径。
- 不改 `unknown-first` 触发语义。
- 超预算只影响注入内容长度，不改变 orchestrator turn 的 degrade 判定语义。

## RED -> GREEN 证据

- RED：新增断言后，`orchestrator_evidence_v2` 标签不存在而失败。
- GREEN：最小实现后，断言通过：
  - 注入含 `>=3` 条 `evidence_digest`。
  - `verdict_json` 字段存在且可解析为 `critic-verdict/2.0`。
  - 超长 notes 被稳定剔除，且调试噪音不注入。

## 风险

- token 估算采用 `chars/4` 近似，和真实 tokenizer 可能有偏差。
- 当检索证据稀疏时，模板会使用 fallback evidence 占位以满足最小条数。

