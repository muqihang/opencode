# LLM-assisted Capsule 设计评审与增强建议（兼容 Context Compaction v2）

> 目标：在不改变现有 deterministic `CapsuleSession/CapsuleHandoff`（不制造事实、可审计、可回放、可降级）的前提下，引入一个 **LLM-assisted “建议层”**，并把它做成世界级：**可审计、可验、可降级、可缓存、可导出**。
>
> 本文是对 `docs/plans/2026-02-03-llm-assisted-capsule-design.md` 的评审与增强建议；内容设计为可直接转成 implementation plan（按模块/文件拆分）。

---

## 0. 结论先行（对齐现状 + 推荐落地路径）

### 0.1 与 Context Compaction v2 的兼容性结论

现有实现的关键事实（已快速扫过相关实现文件）：
- deterministic capsule：`packages/opencode/src/session/compaction.ts` 生成 `capsule.session.json` + `capsule.md`，并写入 `ContextLedger.lastCapsuleSession/lastCapsuleRendered`。
- prompt 注入点：`packages/opencode/src/session/prompt.ts` 在 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT` 开启时读取 `ledger.lastCapsuleRendered.path` 并注入到 `SessionHistorySummary`。
- handoff：`packages/opencode/src/session/finalizer.ts` 生成 `capsule.handoff.json`，并写入 `ContextLedger.handoffs[]`；prompt 侧会读取并生成 `<handoff_hints>`。
- cache 基建：`packages/opencode/src/cache/store.ts` 提供 `CacheStore.open(...).getOrCompute(...)`，可用于 LLM 输出结果缓存。
- evidence chain 校验：`packages/opencode/src/evidence/chain.ts` 提供“缺失文件”断链检测；`packages/opencode/src/eval/offline.ts` 有 `verifyOfflineExportEvidenceChain`（当前只关心 `capsule.session.json`/`capsule.handoff.json`）。

因此：**assisted capsule 完全可以作为“额外 artifact + ledger 指针 + prompt 优先读取”的方式落地**，无需改动 `capsule-protocol.ts` 的 deterministic schema，也不破坏 Compaction v2 的 determinism。

### 0.2 推荐的最小落地形态（v1）

推荐 v1 只新增一条独立流水线：
1) 在 `compaction.completed` 之后 **异步** 触发（绝不放进现有 `SessionCompaction.process` 的 15s timeout 内）。
2) 产出 3 个必备 artifacts（+1 个可选）：
   - `compaction/<id>/capsule.assisted.input.json`（复现/缓存 key 的 SSOT 输入包）
   - `compaction/<id>/capsule.assisted.json`（结构化 SSOT，必须可验）
   - `compaction/<id>/capsule.assisted.md`（预算化渲染文本，供 prompt/UI）
   - （可选）`compaction/<id>/capsule.assisted.verify.json`（确定性 verifier 报告，强烈建议 v1 就做）
3) ledger 仅保存“最后一次可注入版本”的 pointers（类似现有 `lastCapsuleRendered`），prompt 侧按开关优先读取 assisted 渲染文本。

---

## 1. 关键不变量（硬约束固化为机制）

> 本节是“机制化约束”，不是文档愿景；所有条目都需要有可实现的门禁与降级策略。

### 1.1 `known` 必须 evidence（硬约束 1）

对 assisted capsule 的每个 item（decision/openQuestion）：
- 只要 `status="known"`：
  - 必须 `evidence.length > 0`
  - 且每个 `evidence.ref` 必须可解析到本轮可用 evidence 集合
  - 且每个引用必须通过 sha 完整性校验（见 §5.3）
- 不满足则 **强制降级为** `status="unknown"`（或丢弃该 item，见 §3 风险 1 的缓解）

### 1.2 禁止“自由叙述长摘要”（硬约束 2）

assisted capsule **只能**是预算化、结构化的 checklist：
- 只允许短句（建议 160–240 chars/条），禁止长段落
- 禁止代码块（```）、禁止“像提示注入/执行指令”的段落
- 只允许 `decisions[]`、`openQuestions[]` 两类（可选 `notes[]` 但 v1 建议不做）

### 1.3 失败不阻塞、可解释、可回放

assisted 任何失败都必须：
- **不阻塞**原有 deterministic capsule / compaction 主流程
- 产出明确的 degraded 事件（可观测 + 可统计）
- 保留输入包（input pack）与 verifier 结果（便于回放/复现）

---

## 2. 术语对齐（避免“指针/引用”混淆导致断链）

当前仓库里存在至少 3 种“指针/引用”形态（语义不同）：

1) **Capsule Pointer（deterministic）**  
   来源：`packages/opencode/src/session/capsule-protocol.ts`  
   形态：`{ kind, path, sha256, anchor? }`

2) **Evidence Manifest Entry（SSOT 清单）**  
   来源：`packages/opencode/src/protocol/evidence-manifest.ts`  
   形态：`{ kind, path, sha256, size?, createdAtUtc? }`

3) **Evidence Pack Capsule Pointer（UI/pack 摘要指针）**  
   来源：`packages/opencode/src/protocol/evidence-pack.ts`  
   形态：`string | { kind, ref, label? }`（ref 通常是 `.opencode/...` 路径）

assisted 的 `evidence.ref` 必须选定“唯一 canonical 语义”，并且能在 verifier 阶段从现有数据结构中确定性解析。

---

## 3. 设计最大 5 个风险点（每个给具体缓解）

### 风险 1：`unknown` 泛滥 → checklist 变成噪声

**触发方式：**
- LLM 输出“像事实”的句子，但 evidence 绑定失败 → 被 verifier 强制降级 unknown；如果 unknown 数量多，UI 与注入价值大幅下降。

**缓解（建议同时做）：**
1) **强制“覆盖率门槛”**：若 `knownRatio < X`（例如 < 0.4）则整体 `ok=false`，不注入（但仍落盘 + 事件可观测）。
2) **限制 unknown 数量**：unknown item 超过上限直接丢弃（例如每类最多 3 条 unknown），避免把“未知列表”注入上下文。
3) **输入包收敛证据域**：input pack 只提供“可引用证据目录（pointers）”，并要求 LLM 只能从目录里选 ref（不给它自由编 ref 的空间）。

### 风险 2：assisted 反向变成“第二个 summary”，破坏 compaction 稳定性

**触发方式：**
- `capsule.assisted.md` 变长、语义宽泛，实际等价于把聊天内容再注入一遍。

**缓解：**
1) **双预算门禁**：items budget（条数）+ bytes budget（渲染文本与 JSON 两份都算）。  
2) **格式约束**：只允许固定模板（比如“Counts + Decisions + OpenQuestions”），不允许自由段落。
3) **注入优先级严格**：prompt 侧只有在 `assisted.ok=true` 且通过 verifier 的情况下才替换 `lastCapsuleRendered`，否则回退 deterministic。

### 风险 3：ref 规范不统一 → UI/缓存/export 出现“同物不同名”

**触发方式：**
- 同一个证据被不同格式引用（相对路径、`.opencode/...`、Windows 分隔符、带/不带 anchor），导致：
  - verifier 解析不一致
  - cache key 不稳定
  - export 检查断链

**缓解：**
1) **ref 只允许 canonical 路径**（推荐方案见 §4），并在 verifier 做 `normRel`（`\\ -> /`、多 `/` 收敛）。
2) **refVersion 强制纳入**：`capsule.assisted.input.json` + cache key + artifacts 都写入 `refVersion`，任何规则变更必须 bump。

### 风险 4：sha 断链/内容漂移 → “路径存在但内容变了”无法发现

**触发方式：**
- artifact 路径存在，但文件内容被覆盖/变更（重跑生成、手动编辑、并发写入），UI 仍显示“已引用”，但证据已不是原内容。

**缓解：**
1) **sha 完整性校验 v1 必做**：对每个被引用 evidence 重新计算 sha256，与引用携带的 sha256（或 manifest sha256）比对。
2) **写入 verifier 报告**：把 mismatch 的 ref 列表写入 `capsule.assisted.verify.json`，并整体降级 `ok=false`。

### 风险 5：export/共享场景泄漏敏感信息（路径、片段、用户内容）

**触发方式：**
- assisted 可能包含文件路径、用户 intent、甚至模型输出中的敏感片段；一旦纳入 export，就可能进入分享流。

**缓解：**
1) **分层导出策略**：  
   - “安全导出（evidence export）”默认不包含 assisted（或仅包含严格红线过滤后的 `capsule.assisted.md`）。  
   - “离线复现导出（debug export）”才包含 input.json + assisted.json + verify.json（需要显式开关）。
2) **内容安全门禁**：渲染阶段禁止包含 secrets 模式（API key、token、私钥头等）与提示注入片段；命中即降级。

---

## 4. evidence.ref 的定案建议：2+ 套方案 + 推荐 1 套

> 目标：ref 必须“可解析、可校验、可导出、可缓存”，且必须兼容现有 `.opencode/...` artifact 体系与 manifest。

### 方案 A（推荐）：`ref = manifest entry path`（canonical `.opencode/...` 路径）

**定义：**
- `evidence.ref` 直接等于 `EvidenceManifest.entries[].path`（即 `.opencode/...` 相对路径）
- `evidence` 结构携带冗余字段用于 UI/校验：
  - `ref`（canonical path）
  - `sha256`（必须；用于完整性校验）
  - `kind`（可选；用于 UI/排障）
  - `anchor?`（可选；用于 UI 高亮/定位，但不参与路径解析）

**优点：**
- 与现有产物路径完全一致（`EvidenceWriter.artifact` 写入的 `Entry.path` 本身就是 `.opencode/...`）
- verifier 可直接 `Bun.file(path.join(baseDir, ref)).exists()` + sha 校验
- UI 可直接跳转/展开显示证据文件（路径可点击）
- cache key 稳定：ref 是输入包的一部分，规范化后稳定

**缺点：**
- ref 天生包含 sessionId 与目录结构；跨会话/跨导出环境需要映射（但这是现实约束，本就必须解决）

### 方案 B：`ref = artifact:<sha256>`（内容寻址）

**定义：**
- `evidence.ref = \"artifact:\" + sha256`（或 `\"sha256:\" + sha256`）
- verifier 通过 manifest 建索引 `sha256 -> path[]` 解析到实际文件

**优点：**
- 跨路径变更更稳（只要内容不变）
- export 时可更自由地重排目录

**缺点：**
- 需要额外的解析层（manifest 索引）且必须处理“同 sha 多路径”的歧义
- UI 想打开文件仍需要 path（最终还是要回到 path）

### 方案 C：`ref = sha256(stableJson({kind,path,anchor,sha256}))`（哈希引用）

**定义：**
- `ref` 是哈希字符串，实体字段仍携带 `kind/path/sha256/anchor`

**优点：**
- ref 短且固定格式；可用于 cache key、UI 列表去重

**缺点：**
- 仍然离不开 path/sha 的解析；相当于“再造一层 id”，收益有限

### 推荐结论

推荐 **方案 A**：`ref = canonical path`，并强制附带 `sha256`。  
理由：它与现有 `EvidenceWriter`/manifest/ledger/prompt 注入的路径体系天然兼容，且 verifier 最简单、最确定性。

> 关键要求：无论选哪套方案，都必须把 `refVersion` 固化进 input pack 与 cache key，确保规则变更不会导致误命中。

---

## 5. verifier “世界级最低配置”应包含哪些检查

> 目标：不做语义级事实核查，但要做到“**可靠拦截 + 可解释失败 + 可回放复现**”。

### 5.1 Schema / 类型检查（必须）

- `capsule.assisted.json` 必须通过 Zod schema（strict）
- 不允许 extra 字段（避免 prompt 注入渠道）
- `text` 字段必须满足长度上限与行数上限（见 5.4）

### 5.2 引用不断链（必须）

- 对所有 `status=\"known\"` 的 item：
  - `evidence.length > 0`
  - 每个 `evidence.ref` 必须存在于“允许引用集合”中（推荐以 manifest entries + 本轮 input pack pointers 为准）
- 解析失败的策略：  
  - item 级别降级 unknown（优先）  
  - 或整体 `ok=false`（当失败比例过高或出现关键 ref 断链）

### 5.3 sha 完整性校验（强烈建议：v1 就做）

对每个被引用的 evidence：
- 文件必须存在
- 重新计算 sha256 与 `evidence.sha256`（或 manifest sha256）一致
- 任一 mismatch：整体 `ok=false` + 记录 `sha_mismatch[]`

### 5.4 预算门禁（必须）

建议至少四种预算：
- `itemsMax`：decisions + openQuestions 总条数上限
- `unknownMax`：unknown 条数上限（防噪声）
- `charsPerItemMax`：每条最大字符数（禁止长段落）
- `bytesMax`：`capsule.assisted.md` 最大字节数（注入预算）

失败策略：超预算立即 `ok=false`，不注入；但仍落盘（便于统计/调参）。

### 5.5 内容安全策略（必须，且确定性）

建议 v1 用纯确定性规则（避免“再调一个 LLM 来审核”）：
- 禁止出现三反引号代码块（```）
- 禁止出现 `<system>`、`<tool>`、`<assistant>` 等可疑标签片段
- 禁止出现明显“执行指令”前缀（如 `rm -rf`、`curl ... | sh` 等），命中即降级
-（可选）敏感信息正则扫描（token/私钥/长 base64 等），命中即整体 `ok=false`

### 5.6 可回放性检查（强烈建议）

- input pack 必须存在且可解析
- verifier 报告必须包含：
  - `ok`、`reasonCode?`、`reasonZh?`
  - `versions`（prompt/ref/verifier）
  - `coverage`（known/unknown counts，unique refs）
  - `failures[]`（schema errors / unresolved refs / sha mismatches / budget exceeded）

### 5.7 缓存安全性检查（必须）

即便 cache hit：
- **仍然必须跑 verifier**（缓存只能跳过 LLM 调用，不能跳过门禁）
- verifier 失败：视同 degrade，并可选择清理该 cache key（避免永久污染）

---

## 6. offline export 是否必须纳入 assisted（结论 + 影响面）

### 6.1 结论

**结论：必须纳入，但要“分层导出”。**

原因（与“可审计/可回放”直接相关）：
- assisted 的核心价值在于“下一轮注入 checklist”，如果 export 不包含它，就无法离线复现“当时注入了什么”，也无法审计其证据引用与门禁结果。
- LLM 输出本身不确定：单靠 input pack 重跑无法保证得到同样的 checklist，因此“只导 input 不导 output”会让回放失真。

### 6.2 推荐的导出分层（兼容现有 `opencode evidence export`）

建议把“导出”拆成两类语义（即便命令层仍是一个，也要在实现上区分）：

1) **安全导出（Share/Safe Export）**  
   面向用户分享或外部提交：默认不导出 raw LLM 输出；仅导出：
   - `capsule.assisted.md`（已通过内容安全门禁 + 预算）
   - `capsule.assisted.verify.json`（不含敏感文本，仅含统计与失败原因）
   - 可选：`capsule.assisted.json`（如果文本已足够安全；否则只导 md）

2) **离线复现导出（Debug/Replay Export）**  
   面向内部排障/回放：导出完整链路：
   - input.json + assisted.json + verify.json + assisted.md（raw 可选）

### 6.3 影响面（需要在实现计划中显式列出）

- `packages/opencode/src/eval/offline.ts`：  
  - `isCapsuleRef` 需要扩展为识别 `capsule.assisted.*`（否则“导出不断链”永远不检查 assisted）
- `packages/opencode/src/evidence/export.ts`：  
  - 需要决定 assisted artifacts 是否属于 allowlist（以及以何种粒度）
  - 或者引入“export-manifest（导出子集 manifest）”避免“manifest 列了但没导”的歧义

---

## 7. event/ledger 字段建议（支持 UI + 观测 + 回放）

### 7.1 建议新增的事件（最小集 + 可观测字段）

事件名建议沿用现有风格（参考 `compaction.*`、`handoff.generated`）：

1) `capsule.assisted.requested`
2) `capsule.assisted.cache`（可选：在一次事件里标注 hit/miss；也可复用 cache store emit）
3) `capsule.assisted.completed`
4) `capsule.assisted.degraded`

每个事件 `data` 建议至少包含：
- 关联字段：`compactionId`、`parentId?`（触发 compaction 的 messageId）
- 版本字段：`specVersion`、`promptVersion`、`refVersion`、`verifierVersion`
- 模型字段：`providerID`、`modelID`（与现有 provider 记录方式对齐）
- 缓存字段：`cacheHit`、`cacheKey`、`cacheTier?`、`ttlMs?`、`ageMs?`
- 工程字段：`latencyMs`、`tokens?`（如果可获取）、`inputSha256`（input pack 内容 hash）
- 产物字段：`artifacts`（每个 {path, sha256, kind}）
- 覆盖率字段：`coverage`（known/unknown counts、unique evidenceRefs、unresolvedRefs）
- 降级字段（仅 degraded）：`reasonCode`（枚举）+ `reasonZh` + `fallbackUsed`

`reasonCode` 建议枚举（与设计草稿一致，但补齐 cache/verifier 维度）：
- `schema_invalid`
- `ref_unresolvable`
- `sha_mismatch`
- `budget_exceeded`
- `content_unsafe`
- `timeout`
- `provider_error`
- `cache_corrupt`（cache hit 但 verifier 失败）

### 7.2 Ledger 字段建议（merge-safe + prompt 可用）

现有：`ContextLedger` 有 `lastCapsuleRendered`。建议新增 3 个字段（保持“最后一次注入”语义）：
- `lastCapsuleAssisted?: { path: string; sha256: string }`（结构化 SSOT）
- `lastCapsuleAssistedRendered?: { path: string; sha256: string }`（注入文本）
- `lastCapsuleAssistedInput?: { path: string; sha256: string }`（回放/缓存追溯）

并新增一个轻量 meta（便于 UI 展示，不必每次读文件）：
- `lastCapsuleAssistedMeta?: { ok: boolean; generatedAtUtc: string; model?: string; compactionId?: string }`

> 约束：ledger 只在 `ok=true` 时更新 `lastCapsuleAssistedRendered`，避免把 degraded 结果注入 prompt。

---

## 8. 建议的任务拆分清单（便于生成可执行计划）

> 说明：这里只给“模块/文件”级拆分，便于后续直接转为严格的 implementation plan（含测试/命令）。

### Task 1：定义 assisted 协议与预算（schema SSOT）

**Create:**
- `packages/opencode/src/session/capsule-assisted-protocol.ts`  
  - Zod schema：`CapsuleAssisted`、`CapsuleAssistedItem`、`EvidenceRef`、`Coverage`、`Versions`
  - 固化 `specVersion`（例如 `capsule-assisted/1.0`）

**Modify (doc-only 暂不改，但计划需要标注)：**
- `docs/plans/2026-02-03-llm-assisted-capsule-design.md`（若要把推荐 ref 方案回填为定案）

### Task 2：构建 input pack（可复现 + 可缓存）

**Create:**
- `packages/opencode/src/session/capsule-assisted-input.ts`  
  - 读取 `compaction/<id>/capsule.session.json` + `ContextLedger`  
  - 从 `EvidenceManifest` 选取稳定排序的 `pointers`（top-N 策略明确、稳定）
  - 产出 `capsule.assisted.input.json` + `inputSha256`

**Modify:**
- `packages/opencode/src/session/compaction.ts`（只加“触发/排队”信息，不引入 LLM 调用）

### Task 3：LLM 调用层（可缓存、可降级）

**Create:**
- `packages/opencode/src/session/capsule-assisted-runner.ts`  
  - 输入：input pack、model、promptVersion、refVersion、budgets
  - 使用 `CacheStore`：namespace 例如 `capsule.assisted`
  - cache hit 仍跑 verifier（见 Task 4）

**Modify:**
- `packages/opencode/src/cache/store.ts`（通常无需改；只在需要新增 emit 接入时改）

### Task 4：确定性 verifier + verifier report

**Create:**
- `packages/opencode/src/session/capsule-assisted-verifier.ts`  
  - schema 校验、ref 解析、sha 校验、预算校验、内容安全校验
  - 输出：`capsule.assisted.verify.json`（建议）

**Modify:**
- `packages/opencode/src/evidence/chain.ts`（可选增强：增加 sha mismatch 版的链校验 helper）

### Task 5：artifact 落盘 + event + ledger 注入

**Create:**
- `packages/opencode/src/session/capsule-assisted-artifacts.ts`  
  - 写入 assisted.json / assisted.md / input.json / verify.json
  - 统一 kind 命名（例如 `compaction-capsule-assisted`、`compaction-capsule-assisted-input` 等）

**Modify:**
- `packages/opencode/src/session/context-ledger.ts`（新增字段并保持 merge-safe patch）
- `packages/opencode/src/session/prompt.ts`  
  - 新增 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_LLM`  
  - 注入优先级：assisted rendered（ok）> deterministic capsule.md > fallback

### Task 6：offline export / evidence export 对齐（不断链、可审计）

**Modify:**
- `packages/opencode/src/eval/offline.ts`  
  - 扩展 `isCapsuleRef`：包含 `capsule.assisted.json`/`capsule.assisted.md`（以及 verify/input 是否需要纳入）
- `packages/opencode/src/evidence/export.ts`  
  - 讨论并实现：是否 allowlist 导出 assisted artifacts（至少 md + verify）
  -（推荐）增加 `export-manifest.json`：只声明导出子集，避免“manifest 列了但没导”的语义混乱

### Task 7：最小回归测试（避免“看起来能用，但一改就坏”）

**Modify / Add:**
- `packages/opencode/src/eval/offline.ts`  
  - 增加 1 个离线 eval case：构造一个含 assisted artifacts 的 session，验证 export chain 与 verifier 结果

> 测试原则：尽量不 mock，直接跑真实实现；失败必须产出中文可读 errorZh（参考现有 evidence chain 风格）。

---

## 9. 一个需要你拍板的问题（只问 1 个，避免阻塞）

assisted 的 `evidence.ref` 我推荐方案 A（canonical `.opencode/...` path + sha）。  
你是否接受 **“ref 里包含 sessionId 与目录结构”** 作为 v1 的现实约束？  

选项：
1) 接受（v1 快速落地，后续如需跨 session 复用再引入 sha-based ref）
2) 不接受（直接上 sha-based ref，需要额外 manifest 索引与歧义处理）
