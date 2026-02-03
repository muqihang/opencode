# Context Compaction v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把现有 compaction 从“能压缩”升级为“可审计、可回放、可缓存、可降级”的 **Context Compiler v2**：压缩发生但不制造事实；长内容外置为可追溯 artifacts；运行时上下文保持短、稳定、可解释。

**Architecture:** 在现有 `SessionCompaction`（结构化 artifacts + 事件闭环）基础上，新增 `Capsule`（Warm SSOT）与 `Handoff`（主/子会话协作传递）的协议化产物，并把它们接入 `CacheStore`、`ContextLedger` 与 `historySummary` 注入。默认策略以 **质量/性能/稳定** 为第一原则：**不为“更短”牺牲可信**，不把“每个 worker 都 compaction”做成性能灾难。

**Tech Stack:** TypeScript、Bun（`bun test`）、Zod schema-first、`stableJson`、`sha256Text`、`EvidenceWriter`（artifacts/events/manifest）、`CacheStore`（M3 SSOT cache）、现有 `verification`/`toolbelt`（只用于可核验 claims 的门禁）。

---

## 0) 全局决策（Best practice defaults）

> 你要求：质量、性能、稳定第一 —— 我按这个原则把默认决策定死，避免“激进但脆弱”。

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
- `render(...)`：输出固定结构，严格避免“事实句子”（除非来自 known 字段）
  - 示例：`goal: unknown`、`workingSet:` + pointers 列表
  - 不要生成“我们已经修复了 X”这种不可验证断言

**Step 4: Wire into compaction**

In `packages/opencode/src/session/compaction.ts`:
- 在 `compaction.completed` 前后：
  - 写入 `capsule.session.json`（结构化）
  - 写入 `capsule.rendered.md`（注入用短文本）
  - 更新 `ContextLedger`：写 `lastCapsuleSession/lastCapsuleRendered`
  - 额外写 `capsule.updated` 事件（events.jsonl 里只放 summary + pointers）
- 同时：把 summary message 的 text part 替换为 `capsule.rendered.md`（保持现有 historySummary 注入路径不变）

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

## 5) Cache 联动（Capsule cacheable）——命中只跳过重活，不跳过证据链

### Task 5: Capsule 编译接入 `CacheStore`

**Files:**
- Modify: `packages/opencode/src/session/capsule.ts`
- Modify: `packages/opencode/src/cache/policy.ts` (if a new policy namespace is needed)
- Test: `packages/opencode/test/session/capsule-cache.test.ts`

**Step 1: Failing test: hit skips rebuild**

Create `packages/opencode/test/session/capsule-cache.test.ts`:
- Build capsule twice with same key
- Assert second build uses cache (e.g., `CapsuleStats.builds` counter increments only once)
- Assert events emitted include `cache.hit` with namespace `compaction.capsule`

**Step 2: Run failing**

Expected: FAIL

**Step 3: Implement cache path**

In `Capsule.buildSessionCached(...)`:
- Compute `key = CacheStore.key({ namespace, scope, input })`
  - input must include: policyVersion, workspaceFingerprint, toolsetFingerprint (if available), trigger, pointers fingerprint, versions
- If cache disabled: return `disabled`
- If force rebuild: return `forced_rebuild`
- On hit: return cached capsule + emit cache events
- On miss: build deterministic capsule, write to cache, emit cache events

**Step 4: Run test**

Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/session/capsule.ts packages/opencode/test/session/capsule-cache.test.ts
git commit -m "feat(compaction): cache capsule build via cache store"
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
- Modify: `packages/opencode/src/session/history-summary.ts`
- Test: `packages/opencode/test/session/history-summary.test.ts`

**Step 1: Failing test**

Add test:
- If ledger has `lastCapsuleRendered`, prefer it over summary/window
- If ledger has handoffs, append a short “handoff pointers” block (bounded)

**Step 2: Implement minimal read**

In `history-summary.ts`:
- Read `ContextLedger` (inject read dependency via input param or add a helper used by prompt flow)
- Prefer:
  1) capsule rendered (if exists)
  2) existing summary message
  3) window

**Step 3: Run tests**

Expected: PASS

**Step 4: Commit**

```bash
git add packages/opencode/src/session/history-summary.ts packages/opencode/test/session/history-summary.test.ts
git commit -m "feat(compaction): prefer compiled capsule + handoff hints in history summary"
```

---

## 8) UI 对齐（不黑盒解释）——只补充新事件类型

### Task 8: App narrative 支持 `handoff.*` / `capsule.updated`

**Files:**
- Modify: `packages/app/src/components/activity/activity-narrative.ts`
- Test: `packages/app/src/components/activity/activity-narrative.test.ts`

**Step 1: Add failing test**

Add tests that:
- `handoff.generated` maps to a neutral, actionable narrative (no blame)
- `capsule.updated` shows as low-noise info

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

