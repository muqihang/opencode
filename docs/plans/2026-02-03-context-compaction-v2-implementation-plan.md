# Context Compaction v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把现有 compaction 从“能压缩”升级为“可审计、可回放、可缓存、可降级”的 **Context Compiler v2**：压缩发生但不制造事实；长内容外置为可追溯 artifacts；运行时上下文保持短、稳定、可解释。

**Architecture:** 在现有 `SessionCompaction`（结构化 artifacts + 事件闭环）基础上，新增 `Capsule`（Warm SSOT）与 `Handoff`（主/子会话协作传递）的协议化产物，并把它们接入 `ContextLedger` 与 `historySummary` 注入。默认策略以 **质量/性能/稳定** 为第一原则：**不为“更短”牺牲可信**，不把“每个 worker 都 compaction”做成性能灾难。`CacheStore` 仅在“LLM-assisted capsule（可选 phase）”打开时用于缓存重调用结果。

**Tech Stack:** TypeScript、Bun（`bun test`）、Zod schema-first、`stableJson`、`sha256Text`、`EvidenceWriter`（artifacts/events/manifest）、现有 `verification`/`toolbelt`（只用于可核验 claims 的门禁）；可选：`CacheStore`（用于缓存 LLM-assisted capsule）。

---

## 0) 全局决策（Best practice defaults）

> 你要求：质量、性能、稳定第一 —— 我按这个原则把默认决策定死，避免“激进但脆弱”。

### 0.0 术语对齐（避免误改现有 “routing capsule”）

- 当前仓库里已经存在一个 `block:capsule`，它来自 `SessionPrompt` 的 `<routing>...</routing>` 注入（用于 routing evidence 指针）。  
- 本计划里的 **Capsule v2** 指的是“会话可继续执行所需的 Warm SSOT（历史压缩/编译结果）”。  
- 为了避免命名冲突与不必要风险：v2 的注入路径 **优先走 `historySummary` / `block:history_summary`**，不去重用/改写 `<routing>` capsule。

### 0.1 默认策略：**稳上线（保真优先）** + 渐进增强

- **默认不引入额外 LLM 调用来做压缩**（尤其不在每个 worker 内部做 compaction）。  
  - 先做“工程可控的压缩”：结构化 + 指针化 + 外置 artifacts + 稳定注入；
  - 需要智能摘要时，放到 **可选 Phase（feature flag）**，并且必须走 verifier/unknown 语义。
- **Compaction/Capsule 的工程纪律**：`Compile once, consume many`  
  - 每个 turn 最多一次 capsule 编译；  
  - worker 只消费 `Role Pack`（最小输入），不再二次“自我压缩”。

### 0.2 触发策略：保守阈值 + 明确降级

- 沿用现有阈值模型（soft/hard/emergency），默认保持当前 `SessionCompaction.Thresholds`。  
- `soft`：允许做“整理/产物化/缓存写入”，尽量不阻塞主流程。  
- `hard`：下一次调用前必须完成（否则降级为“仅注入指针 + unknown”，宁可质量下降也不 silent fail）。  
- `emergency`：强制最小注入（只保留 goal + pointers + openQuestions + next_steps=unknown），并写 `compaction.degraded` 事件。

### 0.3 事实/幻觉策略：压缩产物 **不制造事实**

- Capsule 里允许出现 `known/unknown` 的结构化字段；
- 只要出现 **fact claim**（事实断言），必须绑定 `pointers(path+sha256+anchor)` 并能通过 verifier；否则必须写 `unknown/unsupported`。
- 计划/建议/推测：允许不带引用，但必须明确语气（建议/可能/假设）。不然按“疑似伪装事实”降级。

### 0.4 Worker 模型（仅记录，不在本计划内实现自部署）

- 决策记录（2026-02-03）：开发/测试阶段 worker 统一调用 `GLM4.7 Flash`（API）。  
- 后续自部署评估候选：`Qwen3 4B`、`Ministral 3` 系列（另立专题与 eval 选型，不在本计划实现）。

### 0.5 Rollout / Kill Switch（稳定第一）

本计划里**有两类变更**，风险不同：

- **低风险（默认始终开启）**：产物化与事件化（新增 artifacts/events/ledger 字段）。  
  - 好处：审计/回放增强；基本不改变模型行为。
- **高风险（默认受开关保护）**：改变“注入到模型的历史内容”的选择逻辑（例如优先使用编译后的 capsule、追加 handoff hints）。  
  - 默认不启用，避免行为漂移；只在灰度/调试时打开。

建议开关（实施时对齐现有 `Flag` 风格）：
- `OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT=1`：启用 “prefer capsule from ledger + handoff hints” 的注入逻辑（默认关闭）。
- `OPENCODE_DISABLE_HANDOFF_HINTS=1`：禁用 handoff hints 注入（即使上面开启，也不注入）。

---

## 1) 执行前准备（必须）

### Task 1: 建隔离 worktree + 基线验证

**Files:**
- None

**Step 1: Create worktree**

Run (from repo root):
```bash
git worktree add -b p4-compaction-v2 .worktrees/p4-compaction-v2
```

**Step 2: Baseline tests**

Run:
```bash
cd .worktrees/p4-compaction-v2/packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test
```
Expected: PASS

Run:
```bash
cd .worktrees/p4-compaction-v2/packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck
cd .worktrees/p4-compaction-v2/packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src
```
Expected: PASS

**Step 3: Commit nothing**

Expected: `git status -sb` clean.

---

## 2) 协议化（Capsule / Handoff）——先把“可审计资产”做实

### Task 2: 新增 Capsule/Handoff 协议（Zod schema-first）

**Files:**
- Create: `packages/opencode/src/session/capsule-protocol.ts`
- Test: `packages/opencode/test/session/capsule-protocol.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/session/capsule-protocol.test.ts`:
```ts
import { describe, expect, test } from "bun:test"
import { CapsuleSession, CapsuleHandoff } from "@/session/capsule-protocol"

describe("capsule-protocol", () => {
  test("parses minimal capsule session", () => {
    const parsed = CapsuleSession.parse({
      specVersion: "capsule-session/1.0",
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      goal: { status: "unknown" },
      decisions: [],
      openQuestions: [],
      workingSet: { pointers: [] },
      notes: [],
    })
    expect(parsed.specVersion).toBe("capsule-session/1.0")
  })
})
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/capsule-protocol.test.ts
```
Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

Create `packages/opencode/src/session/capsule-protocol.ts` with:
- `CapsuleValue`（`known|unknown|derived` 预留，但 v1 先用 `known|unknown`，保持简单）
- `Pointer`（path/sha256/kind + 可选 anchor）
- `CapsuleSession`（goal/decisions/openQuestions/workingSet.pointers/notes）
- `CapsuleHandoff`（childSessionId + summary fields + pointers）

**Step 4: Run test to verify it passes**

Run same command; Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/session/capsule-protocol.ts packages/opencode/test/session/capsule-protocol.test.ts
git commit -m "feat(compaction): add capsule protocol (session/handoff)"
```

---

## 3) 状态与索引（ContextLedger 扩展）——让注入/协作不靠扫目录

### Task 3: 扩展 `ContextLedger` 保存 capsule/handoff 指针

**Files:**
- Modify: `packages/opencode/src/session/context-ledger.ts`
- Test: `packages/opencode/test/session/context-ledger.test.ts`

**Step 1: Write failing test for new fields**

Append tests to `packages/opencode/test/session/context-ledger.test.ts` (or create if missing) that:
- writes ledger with `lastContextPackId` + `lastCapsulePath` + `handoffs[]`
- reads it back and asserts fields persist

**Step 2: Run test to see failure**

Run:
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/context-ledger.test.ts
```
Expected: FAIL (schema rejects unknown keys)

**Step 3: Implement minimal schema extension**

Update Zod schema in `packages/opencode/src/session/context-ledger.ts`:
- Add optional fields:
  - `lastCapsuleSession?: { path: string; sha256: string }`
  - `lastCapsuleRendered?: { path: string; sha256: string }`
  - `handoffs?: Array<{ childSessionId: string; capsulePath: string; capsuleSha256: string; importedAtUtc: string }>`

Keep strict parsing but accept the new fields.

**Step 3.1: Make writes merge-safe (critical)**

当前 `ContextLedger.write({ lastContextPackId })` 会覆写整个文件。  
一旦我们引入 `lastCapsule*` / `handoffs[]`，如果不改写入策略，就会发生：
- `LLM.stream` 写 `lastContextPackId` → 把 `lastCapsule*` 直接覆盖丢失
- 或 compaction 写 `lastCapsule*` → 把 `lastContextPackId` 覆盖丢失

因此必须把写入改成 **read → merge → write**（并建议加锁，避免并发覆盖）：
- 建议新增 `ContextLedger.update({ sessionId, patch })`，内部：
  1) `read(sessionId)` 得到当前值
  2) merge patch（只更新传入字段）
  3) 写回
- `ContextLedger.write({ sessionId, lastContextPackId })` 可保留，但实现内部应调用 `update(...)`，避免重复逻辑。

在测试里必须覆盖“更新 A 字段不会清空 B 字段”。

**Step 4: Re-run test**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/session/context-ledger.ts packages/opencode/test/session/context-ledger.test.ts
git commit -m "feat(compaction): extend context ledger for capsule/handoff pointers"
```

---

## 4) Capsule 生成（deterministic first）——先做到“稳定可控”

### Task 4: 新增 CapsuleBuilder（不调用 LLM）

**Files:**
- Create: `packages/opencode/src/session/capsule.ts`
- Modify: `packages/opencode/src/session/compaction.ts`
- Test: `packages/opencode/test/session/capsule.test.ts`

**Step 1: Write failing tests**

Create `packages/opencode/test/session/capsule.test.ts`:
- Given minimal inputs (sessionId, trigger, last user preview, pointers list),
  - `Capsule.buildSession()` returns `CapsuleSession` with stable sorting
  - `Capsule.render()` returns small deterministic text (no hallucinated facts)

Skeleton:
```ts
import { describe, expect, test } from "bun:test"
import { Capsule } from "@/session/capsule"

describe("Capsule", () => {
  test("renders deterministic capsule text", () => {
    const built = Capsule.buildSession({
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      goal: { status: "unknown" },
      pointers: [{ path: "a.json", sha256: "0".repeat(64), kind: "artifact" }],
    })
    const text = Capsule.render(built)
    expect(text.includes("pointers")).toBeTrue()
  })
})
```

**Step 2: Run to fail**

Run:
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/capsule.test.ts
```
Expected: FAIL (module not found)

**Step 3: Implement Capsule module**

Create `packages/opencode/src/session/capsule.ts`:
- `buildSession(...)`：只做确定性拼装（sort pointers by path+sha+anchor）
- pointers 的来源（v0 最小闭环，避免“编造 sha256”）：
  - 必须包含：本次 compaction 写入的 artifacts（`compaction.input.json` / `facts.json` / `capsule.rendered.md` / `compaction.report.json`）
  - 可选包含：`ContextLedger.lastContextPackId` 对应的 `context/<id>/context-pack.json`（仅当能在 `EvidenceWriter.manifest()` 中查到对应条目的 `sha256` 时才加入；查不到就不要塞一个假的 sha）
- `render(...)`：输出固定结构，严格避免“事实句子”（除非来自 known 字段）
  - 示例：`goal: unknown`、`workingSet:` + pointers 列表
  - 不要生成“我们已经修复了 X”这种不可验证断言

**Step 4: Wire into compaction**

In `packages/opencode/src/session/compaction.ts`:
- 在 `compaction.completed` 前后：
  - 写入 `compaction/<compactionId>/capsule.session.json`（结构化）
  - 写入 `compaction/<compactionId>/capsule.rendered.md`（注入用短文本）
  - 更新 `ContextLedger`：用 `ContextLedger.update(...)` 写 `lastCapsuleSession/lastCapsuleRendered`（不得覆盖丢失 `lastContextPackId` 等字段）
  - 把 **新 capsule artifacts 的 pointer** 挂到既有 `compaction.completed` 事件的 `data.artifacts` 中（避免新增事件噪声）
- 同时：把 summary message 的 text part 设置为“渲染后的 capsule 文本内容”（与写入 `capsule.rendered.md` 的内容一致），**不要把文件路径当作文本塞进 message**（保持现有 historySummary 注入路径不变）

**Step 5: Run tests**

Run:
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/capsule.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add packages/opencode/src/session/capsule.ts packages/opencode/src/session/compaction.ts packages/opencode/test/session/capsule.test.ts
git commit -m "feat(compaction): emit capsule artifacts and ledger pointers (deterministic)"
```

---

## 5) Capsule 预算（稳定第一）——压缩必须变短，不能反向膨胀

### Task 5: Capsule 预算与稳定截断（防止“压缩反而撑爆上下文”）

**Files:**
- Modify: `packages/opencode/src/session/capsule.ts`
- Test: `packages/opencode/test/session/capsule.test.ts`

**Step 1: Write failing tests (budget + stable truncation)**

Extend `packages/opencode/test/session/capsule.test.ts` with assertions:
- `Capsule.render()` 输出必须小于某个上限（建议 `MAX_BYTES <= 16_000`，避免 historySummary 过大）
- 当 pointers 数量过多时必须 **稳定截断**（例如只保留 top N，并写入 `(+M more)` 这类摘要）
- 截断后仍需保持确定性（同输入 → 同输出）

**Step 2: Run tests to see failure**

Expected: FAIL

**Step 3: Implement budgeted render**

In `Capsule.render(...)`:
- Add explicit constants (v1):
  - `MAX_BYTES` (e.g. 16_000)
  - `MAX_POINTERS` (e.g. 40–80)
- Sort pointers deterministically, take first `MAX_POINTERS`, render them
- If truncated: include a final line that reports truncated count
- If text still exceeds `MAX_BYTES`: degrade to a smaller “pointer-only” capsule (goal + counts + topK pointers)

**Step 4: Run tests**

Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/session/capsule.ts packages/opencode/test/session/capsule.test.ts
git commit -m "feat(compaction): budget capsule render and stable truncation"
```

---

## 6) 主/子会话协作（Handoff）——可审计传递，不等同记忆

### Task 6: 子会话 finalize 时生成 `capsule.handoff.json`

**Files:**
- Modify: `packages/opencode/src/session/finalizer.ts`
- Modify: `packages/opencode/src/session/context-ledger.ts`
- Test: `packages/opencode/test/session/handoff.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/session/handoff.test.ts`:
- Create a fake parent/child session IDs
- Simulate finalize path by calling a new helper (extractable pure function) that builds `CapsuleHandoff`
- Assert:
  - pointer list sorted
  - no fact claims invented
  - resulting artifact paths are under parent session artifacts

**Step 2: Run failing**

Expected: FAIL

**Step 3: Implement minimal handoff builder**

In `finalizer.ts`:
- After merge (ok/no_changes/conflict), always write to parent evidence:
  - artifact: `handoff/<childSessionId>/capsule.handoff.json`
  - event: `handoff.generated` (info/warn)
- Content should be deterministic and safe:
  - `childSessionId`
  - `appliedFiles` (if ok)
  - `conflictArtifacts` (if conflict)
  - pointers to child evidence pack alias artifact (already exists) + patch/changeset pointers if present
  - `decisions/openQuestions` 留空或 unknown（v0 不做 LLM 摘要）
- Update `ContextLedger` to append `handoffs[]` entry (bounded, e.g. keep last 10)
  - 必须用 `ContextLedger.update(...)` 做 merge-safe 写入（不能覆盖丢失其它字段）

**Step 4: Optional: auto-import safe subset**

If implementing in v0:
- “import” = 把 handoff pointers 注入到下一轮 historySummary 的一小段
- 不修改用户可见聊天记录（避免 UI 意外）

**Step 5: Run tests**

Expected: PASS

**Step 6: Commit**

```bash
git add packages/opencode/src/session/finalizer.ts packages/opencode/test/session/handoff.test.ts packages/opencode/src/session/context-ledger.ts
git commit -m "feat(compaction): emit handoff capsule on child finalization"
```

---

## 7) Prompt 注入（GUI 无感，但可审计）——“轻量提示 + 审计懒加载”

### Task 7: 把 handoff/capsule 渐进注入到 `historySummary`

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts`
- Modify: `packages/opencode/src/session/history-summary.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Test: `packages/opencode/test/session/history-summary.test.ts`

**Step 1: Failing test**

Add test:
- 默认（开关关闭）时：保持现有逻辑（summary → window），不改变行为
- 当 `OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT=1` 时：
  - If ledger has `lastCapsuleRendered`, prefer it over summary/window
  - If ledger has handoffs, append a short “handoff pointers” block (bounded)
- 当 `OPENCODE_DISABLE_HANDOFF_HINTS=1` 时：即使开启 experimental，也不注入 handoff hints

**Step 2: Implement minimal read**

In `prompt.ts`:
- 优先复用现有 `Flag` 体系（新增 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT` / `Flag.OPENCODE_DISABLE_HANDOFF_HINTS`）
- 当 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_CONTEXT` 开启时：
  1) `await ContextLedger.read(sessionId)` 读取 `lastCapsuleRendered` / `handoffs[]`
  2) 若存在 `lastCapsuleRendered`：
     - 拼出 `.opencode/artifacts/<sessionId>/<path>`，用 `Bun.file(...).text()` 读取为 `preferredText`
     - 读取失败 → `preferredText = ""`（降级回原逻辑，不 crash）
  3) 若允许 handoff hints（未设置 disable）：
     - 将最近 N 条 handoff 指针渲染为一个短文本块 `handoffText`（必须有上限，避免反向膨胀）
  4) 调用 `SessionHistorySummary.build({ messages, preferredText, handoffText })`

In `history-summary.ts`:
- 保持纯函数，不读文件系统
- 在 build 内实现 prefer 顺序：
  1) `preferredText`（若提供且非空）
  2) existing summary message
  3) window
- 若提供 `handoffText`：追加到最终 summary 末尾（并计入 MAX_BYTES 限制）

**Step 3: Run tests**

Expected: PASS

**Step 4: Commit**

```bash
git add packages/opencode/src/session/history-summary.ts packages/opencode/test/session/history-summary.test.ts
git commit -m "feat(compaction): prefer compiled capsule + handoff hints in history summary"
```

---

## 8) UI 对齐（不黑盒解释）——只补充新事件类型

### Task 8: App narrative 支持 `handoff.*`

**Files:**
- Modify: `packages/app/src/components/activity/activity-narrative.ts`
- Test: `packages/app/src/components/activity/activity-narrative.test.ts`

**Step 1: Add failing test**

Add tests that:
- `handoff.generated` maps to a neutral, actionable narrative (no blame)

**Step 2: Implement narrative mapping**

**Step 3: Run UI tests**

Run:
```bash
cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src
```
Expected: PASS

**Step 4: Commit**

```bash
git add packages/app/src/components/activity/activity-narrative.ts packages/app/src/components/activity/activity-narrative.test.ts
git commit -m "feat(ui): narrative for capsule/handoff events"
```

---

## 9) Evals 护栏（可回归）——把“不漂移/不断链”变成门禁

### Task 9: Offline eval 增加 capsule/handoff checks

**Files:**
- Modify: `packages/opencode/src/eval/offline.ts`
- Modify: `packages/opencode/src/evidence/chain.ts` (if needed)
- Test: `packages/opencode/test/evidence/chain-missing.test.ts` (extend) or create `packages/opencode/test/eval/offline-compaction.test.ts`

**Step 1: Failing test**

Add a test that:
- given an eval export dir missing `capsule.session.json` (but referenced), `verifyEvidenceChain` fails with a readable reason

**Step 2: Implement checks**

In offline eval runner:
- ensure capsule artifacts (if present) are included in pack manifest
- ensure pointers resolve in export directory

**Step 3: Run tests**

Expected: PASS

**Step 4: Commit**

```bash
git add packages/opencode/src/eval/offline.ts packages/opencode/test/eval/offline-compaction.test.ts
git commit -m "test(eval): add capsule/handoff evidence checks"
```

---

## 10) 最终验证（必须） + 合并策略

### Task 10: Full verification

**Step 1: Run opencode tests**
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test
```
Expected: PASS

**Step 2: Run app checks**
```bash
cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck
cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src
```
Expected: PASS

**Step 3: Choose integration option**

Use `superpowers:finishing-a-development-branch` and pick one:
1) Merge back to `feature/opencode-custom`
2) Push + PR
3) Keep branch as-is
4) Discard

---

## Optional Phase (默认不做): LLM-assisted capsule (must be verifiable)

> 只有在 deterministic v2 跑稳、并且我们有足够的证据链与降级体验后，再打开这一段。

- Add feature flag: `OPENCODE_EXPERIMENTAL_CAPSULE_LLM=1`
- Use worker model `GLM4.7 Flash` to propose `decisions/openQuestions` candidates
- Run verifier on any fact-like claims; failure -> unknown + degraded event
- Cache (optional, recommended): 仅对 LLM-assisted 结果接入 `CacheStore`（避免重复调用/重复花 token），命中只跳过“重调用”，不跳过 artifacts/events
