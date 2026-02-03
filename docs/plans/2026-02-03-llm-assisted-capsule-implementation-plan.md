# LLM-assisted Capsule Implementation Plan（执行计划 v0.1）

> **Scope**：实现 Optional Phase：LLM-assisted capsule（可核验建议层），并按 `docs/plans/2026-02-03-llm-assisted-capsule-ui-spec.md` 的数据契约提供 UI 可消费的事件/字段。
>
> **原则**：不做“简陋 MVP”。范围聚焦（只做 decisions/openQuestions），但必须一次性落齐：ref 规范、sha 完整性门禁、内容安全门禁、输入包可复现、CacheStore 缓存、事件/ledger 观测字段、导出不断链与回归测试。

---

## 0) 输入文档（必须阅读对齐）

- 设计草稿：`docs/plans/2026-02-03-llm-assisted-capsule-design.md`
- UI 规格：`docs/plans/2026-02-03-llm-assisted-capsule-ui-spec.md`
- 评审结论：`docs/plans/2026-02-03-llm-assisted-capsule-review.md`

---

## 1) Worktree / 基线（必须）

在隔离 worktree 执行（已创建）：
- worktree：`.worktrees/p4-capsule-assisted-impl`
- branch：`p4-capsule-assisted-impl`

基线命令（修改前后都要跑）：
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test
cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck
cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src
```

---

## 2) 任务拆分（按 commit 批次）

### Commit A：执行计划与开关
- 新增 flag：`OPENCODE_EXPERIMENTAL_CAPSULE_LLM=1`
  - 文件：`packages/opencode/src/flag/flag.ts`

### Commit B：协议与 ref 规范（Zod schema-first）
- 新增协议：
  - `capsule-assisted/1.0`
  - `capsule-assisted-input/1.0`
  - `capsule-assisted-verify/1.0`
- 定案 `evidence.ref`：canonical manifest entry path（`.opencode/...` 相对路径，规范化后稳定）
- 文件建议：
  - `packages/opencode/src/session/capsule-assisted-protocol.ts`
  - （如需）`packages/opencode/src/session/capsule-assisted-ref.ts`（ref 规范化工具函数）

### Commit C：CacheStore + LLM 生成（只缓存重调用，不跳过门禁）
- 新增 cache namespace：`capsule-assisted`
  - 更新：`packages/opencode/src/cache/policy.ts`（ttl 与 policy）
- 生成流程（generateObject + schema）：
  1) 生成 input pack artifact（可复现）
  2) cache hit/miss
  3) 产出 assisted draft（只允许引用 input pack 提供的 refs）
- 文件建议：
  - `packages/opencode/src/session/capsule-assisted.ts`

### Commit D：确定性 verifier（世界级最低配置）
门禁必须包含：
- schema 校验
- ref 可解析（只能引用允许集合）
- sha256 完整性校验（路径存在≠内容可信）
- budget（items/bytes）
- 内容安全（禁三反引号代码块、禁长段落、unknown 必须有 reason）
- 产出 verifier report artifact（便于回放）

文件建议：
- `packages/opencode/src/session/capsule-assisted-verifier.ts`

### Commit E：Compaction 接入（产物落盘 + event + ledger + prompt 注入）
- 在 compaction 完成后（不阻塞主流程）触发：
  - 写 artifacts：assisted.json / assisted.md / verify.json / input.json（raw 可选）
  - 写 events：`capsule.assisted.*`（含 cacheHit/latencyMs/coverage/reasonCode）
  - ledger：仅 `ok=true` 才更新 `lastCapsuleAssistedRendered`
- prompt 注入优先级：
  - `CAPSULE_CONTEXT=1` 且 `CAPSULE_LLM=1`：优先 assisted.md（ok）
  - 否则回退 deterministic capsule.md

文件：
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/context-ledger.ts`
- `packages/opencode/src/session/prompt.ts`

### Commit F：导出不断链（export/offline）+ 回归测试
- 扩展导出 allowlist / classify：
  - capsule.session.json / capsule.handoff.json / capsule.assisted.(json|md|verify) 必须可导出（避免 manifest 声明但导出缺失）
- 扩展 offline export evidence chain 校验：纳入 assisted
- 新增真实文件系统测试（不 mock）

文件：
- `packages/opencode/src/evidence/export.ts`
- `packages/opencode/src/eval/offline.ts`
- `packages/opencode/test/eval/*`（新增/更新）

### Commit G：Activity UI（最小可用：叙事 + 详情数据契约）
- app 侧至少支持：
  - `capsule.assisted.completed/degraded/failed` 的叙事
  - 事件 data 的 `CapsulePayload`（anchors/items/status）可消费
- 文件：
  - `packages/app/src/components/activity/activity-narrative.ts`
  - `packages/app/src/components/activity/activity-narrative.test.ts`

---

## 3) 验收清单（必须全绿）

- `OPENCODE_EXPERIMENTAL_CAPSULE_LLM=0`：行为不变（不生成、不注入）
- `OPENCODE_EXPERIMENTAL_CAPSULE_LLM=1`：
  - 能生成 assisted artifacts（ok 或 degraded）
  - 引用/sha 断链时会 degraded，且不更新 ledger 注入指针
  - cache hit 仍跑 verifier
  - 导出目录 evidence chain 不断链
- 全量测试通过（见 §1 基线命令）

