# [V1] Single-Session Real LLM Workers Production Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade single-session orchestrator workers from rule-only placeholders to real small-model workers with production-grade reliability, observability, safety boundaries, and visible worker activation in UI/TUI.

**Architecture:** Keep the current control plane (`features -> plan -> worker runner -> tool broker -> main LLM injection`) and replace worker compute with structured small-model calls (`generateObject` + strict schema + verifier + cache). Add first-class worker lifecycle events and a low-noise UI badge (“worker triggered this turn”) keyed by `sessionID + messageID`, while preserving strict read-only/no-ask/no-write boundaries.

**Tech Stack:** Bun, TypeScript, Zod protocol contracts, AI SDK `generateObject`, `CacheStore`, `EvidenceWriter`, Bus global event stream, Web UI (`@opencode-ai/ui`), TUI sync store.

---

## 0) Scope and non-goals

### In scope
- Real small-model invocation for orchestrator workers in single-session `assist/heavy` path.
- Three workers (phased): `evidence_critic`, `retrieval_planner`, `patch_planner`.
- Worker lifecycle observability (artifacts/events/metrics).
- UI/TUI indicator that clearly shows worker trigger and state.
- Safety/cost/performance guardrails for production rollout.

### Out of scope (this plan)
- Multi-session subagent orchestration redesign.
- Replacing main `LLM.stream` behavior outside orchestrator path.
- New external storage backends.

---

## 1) Baseline facts (must preserve)

1. Orchestrator is gated by `OPENCODE_EXPERIMENTAL_ORCHESTRATOR` and build primary agent path:
   - `packages/opencode/src/session/processor.ts`
   - `packages/opencode/src/flag/flag.ts`
2. Current worker path does not call LLM; `evidence_critic` is rule-based:
   - `packages/opencode/src/session/orchestrator/worker-spec.ts`
   - `packages/opencode/src/session/orchestrator/workers/evidence-critic.ts`
3. Worker runtime shell already exists (cache + schema verification + degraded fallback):
   - `packages/opencode/src/session/orchestrator/worker-runner.ts`
4. Structured small-model pattern exists and is reusable (`generateObject` + timeout + cache):
   - `packages/opencode/src/session/capsule-assisted.ts`
5. UI turn-level addon slot already exists:
   - `packages/ui/src/components/session-turn.tsx`

---

## 2) Production target SLO / guardrails

### Reliability
- Worker-triggered turns complete without fatal interruption ≥ 99.9%.
- Worker failure degrades gracefully (no hard fail of main turn) 100%.

### Latency
- P50 added latency from workers ≤ 350ms (`chat` unaffected, `assist` bounded).
- P95 added latency ≤ 1200ms with default budget.

### Cost
- Worker token overhead bounded by `rolePack.budget.maxOutputTokens`.
- Cache hit ratio target ≥ 35% in repeated retrieval/evidence tasks.

### Quality
- Evidence-required tasks: unsupported factual claims reduced by ≥ 40% vs baseline.
- Verification-required tasks: `unknown without pointer` responses increase (expected) before hallucinated assertions.

---

## 3) Target architecture

### 3.1 Worker runtime layer

Add a reusable `WorkerLLM` helper used by each worker compute function:
- Resolve model via `Provider.getSmallModel(providerID)` with config override.
- Invoke `generateObject` (never `LLM.stream`).
- Enforce timeout/retry/token caps.
- Parse with strict Zod output schema.
- Return `LlmWorkerResult` only.

Files:
- Create: `packages/opencode/src/session/orchestrator/worker-llm.ts`
- Modify: `packages/opencode/src/session/orchestrator/worker-spec.ts`
- Modify: `packages/opencode/src/session/orchestrator/worker-runner.ts`

### 3.2 Worker set

- `evidence_critic` (phase 1): check evidence sufficiency, emit retrieval/verification requests.
- `retrieval_planner` (phase 2): structure high-signal retrieval requests.
- `patch_planner` (phase 3): output file-scoped plan only (no writes/tools).

Files:
- Modify: `packages/opencode/src/session/orchestrator/workers/evidence-critic.ts`
- Create: `packages/opencode/src/session/orchestrator/workers/retrieval-planner.ts`
- Create: `packages/opencode/src/session/orchestrator/workers/patch-planner.ts`
- Modify: `packages/opencode/src/session/orchestrator/plan.ts`
- Modify: `packages/opencode/src/protocol/orchestrator-plan.ts`

### 3.3 Tool broker policy enforcement

Broker must consume plan-level policy instead of static allowlist:
- enforce `allowed` kinds
- enforce `bounceMax=1`
- keep non-interactive behavior (no ask)

Files:
- Modify: `packages/opencode/src/session/orchestrator/tool-broker.ts`
- Modify: `packages/opencode/src/session/orchestrator/index.ts`
- Modify: `packages/opencode/src/protocol/llm-worker-result.ts`

### 3.4 Visible worker debug indicator

Introduce worker lifecycle bus event + turn-scoped status store:
- `orchestrator.worker.status` event with phase + counts
- store by `sessionID + messageID`
- render compact badge in web `session-turn addon`
- render compact status line in TUI session view

Files:
- Create: `packages/opencode/src/session/orchestrator/event.ts`
- Modify: `packages/opencode/src/session/orchestrator/worker-runner.ts`
- Modify: `packages/app/src/context/global-sync.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- Modify: `packages/ui/src/components/session-turn.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

---

## 4) Implementation tasks (bite-sized, test-first)

### Task 1: Add worker lifecycle event contract

**Files:**
- Create: `packages/opencode/src/session/orchestrator/event.ts`
- Test: `packages/opencode/test/session/orchestrator-event.test.ts`

**Step 1: Write failing test**
- Assert event schema accepts `planned/running/completed/degraded/skipped` and rejects unknown phase.

**Step 2: Implement schema + BusEvent definition**
- Define payload with: `sessionID`, `messageID`, `planID`, `workerID`, `phase`, `attempt`, `latencyMs?`, `cache?`, `reason?`.

**Step 3: Run focused test**
- Run: `cd packages/opencode && bun test test/session/orchestrator-event.test.ts`

---

### Task 2: Introduce `worker-llm` helper

**Files:**
- Create: `packages/opencode/src/session/orchestrator/worker-llm.ts`
- Test: `packages/opencode/test/session/worker-llm.test.ts`

**Step 1: Write failing tests**
- Timeout produces degraded result.
- Schema mismatch produces degraded result.
- Success returns parsed object.

**Step 2: Implement minimal helper**
- `resolveSmallModel()` using provider config.
- `runStructured()` using `generateObject` + timeout.

**Step 3: Run focused tests**
- Run: `cd packages/opencode && bun test test/session/worker-llm.test.ts`

---

### Task 3: Upgrade `evidence_critic` to real LLM worker

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/workers/evidence-critic.ts`
- Modify: `packages/opencode/src/session/orchestrator/worker-spec.ts`
- Test: `packages/opencode/test/session/orchestrator-evidence-critic.test.ts`

**Step 1: Write failing tests**
- Empty pointers => toolRequests contain retrieval.
- Non-empty pointers => no mandatory retrieval request.
- Unsafe output gets sanitized by runner verifier.

**Step 2: Implement LLM-backed compute**
- Keep output schema strict.
- Keep notes bounded.
- No direct tool execution.

**Step 3: Run targeted tests**
- Run: `cd packages/opencode && bun test test/session/orchestrator-evidence-critic.test.ts test/session/orchestrator-worker-contract.test.ts`

---

### Task 4: Wire worker lifecycle events in runner

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/worker-runner.ts`
- Test: `packages/opencode/test/session/orchestrator-worker-runner-events.test.ts`

**Step 1: Write failing tests**
- Start/completed events emitted on success.
- Start/degraded emitted on error.
- Cache hit includes cache metadata.

**Step 2: Implement event emission**
- Emit planned/running/completed/degraded/skipped with consistent fields.

**Step 3: Run tests**
- Run: `cd packages/opencode && bun test test/session/orchestrator-worker-runner-events.test.ts`

---

### Task 5: Enforce plan tool policy in broker

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/index.ts`
- Modify: `packages/opencode/src/session/orchestrator/tool-broker.ts`
- Test: `packages/opencode/test/session/orchestrator-tool-broker-policy.test.ts`

**Step 1: Write failing tests**
- Reject request kind not in `plan.toolPolicy.allowed`.
- Enforce bounceMax=1 (no second broker cycle).

**Step 2: Implement policy plumbing**
- Pass policy from turn runner to broker.
- Remove static hardcoded allowlist path.

**Step 3: Run tests**
- Run: `cd packages/opencode && bun test test/session/orchestrator-tool-broker*.test.ts`

---

### Task 6: Fix mode decision and worker reachability

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/features.ts`
- Modify: `packages/opencode/src/session/orchestrator/plan.ts`
- Test: `packages/opencode/test/session/orchestrator-plan.test.ts`

**Step 1: Write failing tests**
- `deep + high complexity` can produce `heavy`.
- file parts influence write/exec detection.

**Step 2: Implement deterministic gating improvements**
- Keep fork safety priority.
- Make heavy reachable with explicit reasons.

**Step 3: Run tests**
- Run: `cd packages/opencode && bun test test/session/orchestrator-plan.test.ts`

---

### Task 7: Add web UI worker badge

**Files:**
- Modify: `packages/app/src/context/global-sync.tsx`
- Modify: `packages/ui/src/components/session-turn.tsx`
- Test: `packages/app/src/components/session/worker-indicator.test.tsx`

**Step 1: Write failing test**
- Given worker lifecycle event, turn addon shows “worker triggered”.

**Step 2: Implement store + render**
- Store keyed by `sessionID:messageID`.
- Render compact badge with phase and hover details.

**Step 3: Run test**
- Run: `cd packages/app && bun test src/components/session/worker-indicator.test.tsx`

---

### Task 8: Add TUI worker status hint

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Test: `packages/opencode/test/cli/tui/orchestrator-worker-status.test.tsx`

**Step 1: Write failing test**
- TUI session route renders worker state during active turn.

**Step 2: Implement compact hint**
- Single-line status (no spam), phase-only in default view.

**Step 3: Run tests**
- Run: `cd packages/opencode && bun test test/cli/tui/orchestrator-worker-status.test.tsx`

---

### Task 9: Add retrieval planner + patch planner workers

**Files:**
- Create: `packages/opencode/src/session/orchestrator/workers/retrieval-planner.ts`
- Create: `packages/opencode/src/session/orchestrator/workers/patch-planner.ts`
- Modify: `packages/opencode/src/session/orchestrator/worker-spec.ts`
- Modify: `packages/opencode/src/session/orchestrator/plan.ts`
- Test: `packages/opencode/test/session/orchestrator-workers-v2.test.ts`

**Step 1: Write failing tests**
- Planner workers return valid structured output.
- No direct tool execution side effects.

**Step 2: Implement workers**
- Retrieval planner: emit structured retrieval requests.
- Patch planner: emit change plan notes only.

**Step 3: Run tests**
- Run: `cd packages/opencode && bun test test/session/orchestrator-workers-v2.test.ts`

---

### Task 10: Protocol and SDK sync

**Files:**
- Modify: `packages/opencode/src/session/status.ts` (only if status schema extension is adopted)
- Modify: `packages/opencode/src/server/routes/global.ts` (ensure event schema exposure)
- Modify: `packages/sdk/js/src/v2/gen/types.gen.ts` (generated)

**Step 1: Regenerate SDK types**
- Run: `./packages/sdk/js/script/build.ts`

**Step 2: Verify API typing compiles**
- Run: `cd packages/sdk/js && bun test`

---

### Task 11: End-to-end orchestration integration and rollout flags

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/src/config/config.ts`
- Test: `packages/opencode/test/session/orchestrator-integration-v2.test.ts`

**Step 1: Add flags**
- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS`
- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE`
- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE`

**Step 2: Wire shadow/canary behavior**
- Shadow mode runs workers but does not inject output.

**Step 3: Run integration tests**
- Run: `cd packages/opencode && bun test test/session/orchestrator-integration-v2.test.ts`

---

### Task 12: Verification, documentation, and rollout checklist

**Files:**
- Create: `docs/plans/2026-02-07-single-session-real-llm-workers-rollout.md`
- Modify: `docs/plans/2026-02-03-single-session-orchestration-design.md` (status appendix)
- Modify: `docs/plans/2026-02-04-single-session-orchestration-implementation-plan.md` (progress notes)

**Step 1: Define launch gates**
- Gate A: internal dogfood only (`deep` mode, 1 worker)
- Gate B: canary 5% `auto`
- Gate C: default on

**Step 2: Add incident fallback runbook**
- one-click disable flags, cache bypass, degrade messaging.

**Step 3: Verify full suite**
- Run: `cd packages/opencode && bun test`
- Run: `cd packages/app && bun test`
- Run: `cd packages/opencode && bun test test/eval/offline-regression.test.ts`

---

## 5) Rollout strategy

### Phase A: Shadow (no behavior impact)
- Enable worker LLM calls in shadow mode.
- Compare worker outputs vs rule-worker outputs.
- Collect latency/cost/error distributions.

### Phase B: Assist canary
- Enable `evidence_critic` injection for `deep` mode only.
- Badge visible in internal builds.

### Phase C: Multi-worker canary
- Enable `retrieval_planner` with strict budgets.
- Keep `patch_planner` in read-only planning mode.

### Phase D: Production default
- `auto` mode defaults to real workers under gating.
- Keep kill-switch and shadow fallback permanently.

---

## 6) Risk matrix and mitigations

1. **Latency spikes**
- Mitigation: strict timeout, per-worker concurrency cap, cache-first.

2. **Cost drift**
- Mitigation: token caps, adaptive disable when cache hit high, budget alarms.

3. **Hallucinated worker output**
- Mitigation: schema + verifier + evidence policy + unknown-by-default.

4. **UI noise**
- Mitigation: compact badge, aggregate multi-worker states.

5. **Regression in fork safety**
- Mitigation: dedicated integration tests for write/exec escalation path.

---

## 7) Definition of done (production)

- Real small-model worker path active behind flag and canary.
- Worker lifecycle visible in web + TUI for active turns.
- No write/exec/ask privileges in worker path.
- `assist/heavy` worker orchestration deterministic and replayable.
- Full CI green and offline regression updated.

---

Plan complete and saved to `docs/plans/2026-02-07-single-session-real-llm-workers-production-implementation-plan.md`.

Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?

