# Optional Phase: LLM-assisted Capsule（可核验建议层）设计草稿 v0.1

> 目标：在现有 deterministic `Capsule/Handoff`（不制造事实、可审计、可回放、可降级）之上，增加一个**默认关闭**的 LLM “建议层胶囊”，用来输出 *可行动* 的 `decisions/openQuestions` 清单，但必须严格遵循“可核验/可降级/可审计”的工程纪律。
>
> - 本文是**设计定案草稿**，用于后续生成可执行 implementation plan。
> - UI/视觉呈现由 Gemini 负责；本文只定义“用户要看到什么、必须传达什么语义”，不负责美术细节。

---

## 0. 一句话摘要（给产品/研发共识）

把“会话压缩”的产物从**目录/索引**升级为**可继续推进的 checklist**：LLM 只负责“提议”决策与开放问题，并为每条提议绑定证据引用（`pointers`）；引用不成立的一律标记 `unknown`（或直接丢弃），从机制上阻断幻觉进入核心上下文。

---

## 1. 背景与动机（Why now）

我们已经完成 Context Compaction v2 的 deterministic 版本（Capsule/Handoff 协议化、artifact 落盘、ledger 注入、offline export evidence chain 校验）。

现实问题仍存在：
- **可行动信息不足**：deterministic capsule 更偏“索引/证据包”，对下一轮模型和用户仍需要额外对齐“当前已决定什么、还缺什么”。
- **跨会话交接成本高**：handoff 解决了“交接有产物”，但没有提供“交接后能立刻继续干活”的结构化 checklist。
- **质量约束更严格**：我们宁愿输出 `unknown`，也不能把 LLM 的“看起来像事实”直接塞进上下文。

LLM-assisted capsule 的定位就是补齐这层“可继续推进的清单”，并把风险用门禁收敛。

---

## 2. 目标与非目标（Scope）

### 2.1 目标（Goals）

- **可行动结构**：生成结构化 `decisions[]` 与 `openQuestions[]`（MVP）供用户和模型继续执行。
- **可核验**：`known` 条目必须带证据引用（evidence pointers）；引用必须能解析到当前会话的 pointers 集合。
- **稳定优先**：每 turn 最多生成一次；失败不阻塞主流程，必须可降级。
- **可审计可回放**：落盘 artifacts + events + ledger 指针，支持复现实验与排障。
- **可缓存**：只缓存“LLM 调用结果”，不缓存 artifacts/events（审计一致性不打折）。

### 2.2 非目标（Non-goals）

- 不做自由叙述式“长摘要/复述聊天记录”
- 不让 worker 自行 compaction 或自行生成 assisted capsule（避免性能灾难与行为漂移）
- 不让 LLM 直接执行动作（只提议）
- MVP 不追求“语义级事实核查”（只做“引用不断链 + 结构门禁 + 预算门禁”）

---

## 3. 对用户的最终体现（PM 大白话版）

### 3.1 用户会看到什么（UI 语义，非美术）

在 Activity（或会话侧边栏）出现一张卡片/事件：
- 标题：**“AI 建议要点（可核验）”**
- 状态：
  - 成功：`ok=true`
  - 降级：`ok=false`，显示“已降级，原因：xxx”（不打断使用）
- 内容分两块：
  1) **已形成的决策**（Decisions）
  2) **仍待确认的问题**（Open Questions）
- 每一条都显示：
  - 短文本（不允许长段落）
  - 证据引用（可点开/展开查看对应 artifact 指针）
  - 若为 `unknown`：明确标注“需确认/未知”，并显示 `unknownReasonZh`

关键：这张卡片明确告诉用户“这是 AI 提议，不是事实记录”，并提供“出处/引用”降低误信风险。

### 3.2 对话体验是否顺畅

- 默认不开启：用户无感。
- 开启后：
  - 模型上下文注入更像 checklist（短、稳定、可控），减少反复对齐。
  - 如果生成失败：回退到 deterministic capsule / 原策略，不影响聊天继续。

---

## 4. 开关与触发策略（Rollout / Kill Switch）

### 4.1 Feature flags（定案）

- 已有：`OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT=1`
  - 允许注入 deterministic capsule + handoff hints（现状）
- 新增：`OPENCODE_EXPERIMENTAL_CAPSULE_LLM=1`
  - 允许生成并注入 LLM-assisted capsule（默认关闭）

### 4.2 触发点（定案：保守）

- 仅在 `compaction.completed` 后触发一次（或 hard/emergency compaction 完成后触发）
- 每 turn 最多一次
- 不允许在任何 worker 内部触发（遵循 “Compile once, consume many”）

### 4.3 注入优先级（建议）

1) `CAPSULE_LLM=1` 且 `assisted.ok=true`：注入 assisted 渲染文本（短 checklist + 引用）
2) 否则：注入 deterministic capsule（你们已实现）
3) 再否则：回退到 summary message / window 策略

---

## 5. 数据协议（Schema）草案

### 5.1 SSOT：`capsule-assisted/1.0`（Zod schema-first）

建议新增协议（与 `capsule-session/1.0`、`capsule-handoff/1.0` 并列），核心字段：

- `specVersion`: `"capsule-assisted/1.0"`
- `sessionId`: string
- `generatedAtUtc`: string (ISO)
- `model`: `{ provider: string; name: string }`
- `ok`: boolean
- `degradedReasonZh?`: string
- `decisions`: Item[]
- `openQuestions`: Item[]
- `pointersUsed`: `{ ref: string }[]`
- `budget`: `{ maxBytes: number; maxItems: number }`

Item 结构（decisions 与 openQuestions 共用）：
- `text`: string（必须短；建议上限 160–240 chars）
- `status`: `"known" | "unknown"`
- `evidence`: `{ ref: string }[]`
- `unknownReasonZh?`: string

### 5.2 `known/unknown` 硬规则（定案）

- `status="known"` 必须满足：
  - `evidence.length > 0`
  - 每个 `evidence.ref` 都能解析到本轮 pointers 集合中的合法 pointer
- 否则一律降级为 `status="unknown"`，并要求写 `unknownReasonZh`

> 备注：这条规则的目的不是“更聪明”，而是“更可靠”。它把幻觉的进入路径从机制上封死。

---

## 6. 产物、事件与 Ledger（可回放/可审计）

### 6.1 Artifacts（建议落盘路径）

建议沿用 compaction 目录结构（以 compactionId 归档）：
- `compaction/<id>/capsule.assisted.json`（结构化 SSOT）
- `compaction/<id>/capsule.assisted.md`（渲染文本，给 prompt 与 UI 使用）
- `compaction/<id>/capsule.assisted.input.json`（建议必做：用于复现与 cache key）
- `compaction/<id>/capsule.assisted.raw.txt`（可选：原始模型输出，排障用）

### 6.2 Events（最小集）

- `capsule.assisted.requested`
- `capsule.assisted.completed`（data: ok + artifacts pointers + model + cacheHit?）
- `capsule.assisted.degraded`（data: reasonZh + fallbackUsed）

### 6.3 ContextLedger（建议字段）

新增 merge-safe 字段（patch 更新）：
- `lastCapsuleAssistedRendered?: { path: string; sha256: string; generatedAtUtc: string; ok: boolean; model?: string }`

> 说明：ledger 存储 path 采用 base-relative（例如 `.opencode/...`）与现有设计保持一致。

---

## 7. Verifier（MVP：轻量、确定性门禁）

MVP verifier 只做三类检查：
1) schema 通过（结构正确）
2) 引用不断链：
   - 所有 `known` 条目的 `evidence.ref` 必须存在于 pointers 集合（或可解析到具体 pointer）
3) budget 通过（items/bytes 上限）

失败策略：
- 不阻塞主流程
- 写 `capsule.assisted.degraded`
- 不注入 assisted（回退到 deterministic）
- ledger 是否更新：
  - 建议：仅在 `ok=true` 时写 `lastCapsuleAssistedRendered`

---

## 8. Cache（建议做：只缓存调用结果）

- 使用 `CacheStore` 缓存 assisted 的生成结果
- cache key = hash(`capsule.assisted.input.json` + `model` + `promptVersion`)
- cache hit：跳过 LLM 重调用，但仍写 artifacts/events（审计一致性）

---

## 9. UX 与文案边界（给 Gemini 的“必须表达”清单）

Gemini 负责美感与布局，但需要确保 UI 语义满足以下约束：
- 必须明确标识：**“AI 建议（可核验）”**，避免被当成事实记录
- `unknown` 必须可见（允许折叠，但不能静默丢失），并说明“需要确认”
- 必须提供“查看引用/证据”的交互入口
- 提供“复制要点”能力（便于粘到 issue/PR/文档）

---

## 10. 成功指标（上线后判断值不值）

- assisted 生成成功率（`ok=true` 占比）
- degraded 率与原因分布（缺引用/超预算/超时/解析失败）
- 用户重复解释/模型重复追问的 proxy 指标下降
- handoff 后首轮继续推进的成功率提升（主观反馈 + 简单日志指标）

---

## 11. 风险与缓解（必须写清楚）

- 幻觉风险：通过 `known` 必须 evidence + 引用门禁 + unknown 降级收敛
- 性能风险：限定触发点（compaction 完成后一次）+ CacheStore
- 行为漂移：默认关闭开关 + 注入优先级回退
- 误用风险：UI 必须明确“建议”语义 + 引用可点击

---

## 12. Implementation Plan 生成前需要拍板的事项（已定案/待细化）

已定案：
- `known` 必须 evidence
- 只在 compaction 后触发一次
- MVP 只做 `decisions/openQuestions`
- 模型暂按计划记录（开发/测试统一模型）

待细化（不会影响是否开工，但会影响实现拆分）：
- assisted 渲染文本的具体格式（含引用呈现格式）
- budget 上限（items/bytes）初始值
- 是否把 assisted 也纳入 offline export evidence chain 校验（建议后续加；MVP 可不强制）

---

## 13. Self-review（作者自评：可执行性/一致性/缺口）

### 13.1 与现有 v2 约束的一致性
- ✅ 不改变 deterministic SSOT 的“事实不制造”原则；assisted 是独立建议层。
- ✅ 不在 worker 内触发，遵守 “Compile once, consume many”。
- ✅ 所有关键点都可通过 feature flag 灰度与 kill switch 回退。

### 13.2 可执行性（工程落地）
- ✅ 产物/事件/ledger 的落点清晰，能复用现有 artifacts/events/ledger 的基础设施。
- ✅ verifier 被限定为确定性门禁，不引入重型“事实核查系统”，风险可控。
- ⚠️ `evidence.ref` 的“ref 形式”需要对齐现有 pointers 的结构（实现时必须统一一个可解析的 ref 规范）。

### 13.3 质量风险点（需要实现阶段强约束）
- ⚠️ 渲染文本如果不限制长度，容易把长内容重新注入上下文；必须预算化（bytes/items）。
- ⚠️ “unknown 的展示策略”必须一致：不能在后端降级但 UI 静默隐藏。

### 13.4 MVP 缺口（刻意未做）
- ⏭️ next steps（可行动建议）未纳入 MVP，避免范围膨胀。
- ⏭️ offline export 对 assisted 的断链校验建议后续补齐（MVP 可先不强制）。

