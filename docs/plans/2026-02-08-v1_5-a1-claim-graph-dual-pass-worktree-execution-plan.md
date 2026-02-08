# [V1.5-A1] Claim Graph Gate + Dual-pass Worktree Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver V1.5-A1 reliability milestone with production-safe Claim Graph Gate and Dual-pass Synthesis under strict single-session orchestrator boundaries.

**Architecture:** Implement A1 in three isolated git worktrees with strict file ownership to avoid merge contention: (1) claim graph protocol and gate core, (2) dual-pass orchestration path, (3) evidence/events/flags and E2E guardrails. The coordinator branch performs no feature coding, only integration merges (`--no-ff`), gate verification, and rollback handling.

**Tech Stack:** Bun, TypeScript, Zod protocol contracts, orchestrator runtime, verification pipeline, evidence events/artifacts, feature flags.

---

## 0) Preconditions and operating rules

- Base branch: `feature/opencode-custom`.
- Merge policy: `git merge --no-ff` only; no history rewrite.
- Safety policy: no delete/reset/clean/rebase/force-push/sudo/chmod -R/chown -R.
- Scope policy: only A1 (`Claim Graph Gate + Dual-pass`), no unrelated fixes.
- Verification policy: every status claim must include fresh command output and exit code.

---

## 1) Worktree topology and ownership

### Coordinator (integration only)

- Workspace: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src`
- Branch: `feature/opencode-custom`
- Responsibility:
  - create/review/merge worktree branches
  - run cross-worktree integration gates
  - make release decision and rollback actions
  - no feature edits except conflict-resolution glue during merge

### Worktree A: Claim Graph Gate Core

- Path: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-claim-graph`
- Branch: `codex/a1-claim-graph-gate`
- File ownership:
  - Create: `packages/opencode/src/protocol/claim-graph.ts`
  - Create: `packages/opencode/src/verification/claim-graph.ts`
  - Modify: `packages/opencode/src/verification/index.ts`
  - Create: `packages/opencode/test/session/claim-graph-gate.test.ts`
  - Create: `packages/opencode/test/verification/claim-gate-regression.test.ts`
- Must not touch:
  - `packages/opencode/src/session/orchestrator/index.ts`
  - `packages/opencode/src/evidence/events.ts`
  - `packages/opencode/src/flag/flag.ts`

### Worktree B: Dual-pass Synthesis

- Path: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-dual-pass`
- Branch: `codex/a1-dual-pass`
- File ownership:
  - Create: `packages/opencode/src/protocol/dual-pass.ts`
  - Create: `packages/opencode/src/session/orchestrator/dual-pass.ts`
  - Modify: `packages/opencode/src/session/orchestrator/index.ts`
  - Modify: `packages/opencode/src/protocol/orchestrator-plan.ts` (only if needed for dual-pass config contract)
  - Create: `packages/opencode/test/session/dual-pass-protocol.test.ts`
  - Create: `packages/opencode/test/session/dual-pass-degrade.test.ts`
- Must not touch:
  - `packages/opencode/src/verification/index.ts`
  - `packages/opencode/src/flag/flag.ts`
  - `packages/opencode/src/evidence/events.ts`

### Worktree C: Evidence, Flags, and A1 E2E wiring

- Path: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-evidence-flags`
- Branch: `codex/a1-evidence-flags`
- File ownership:
  - Modify: `packages/opencode/src/evidence/chain.ts`
  - Modify: `packages/opencode/src/evidence/events.ts`
  - Modify: `packages/opencode/src/flag/flag.ts`
  - Modify: `packages/opencode/src/session/orchestrator/features.ts`
  - Modify: `packages/opencode/src/session/processor.ts` (only A1 flag wiring)
  - Create: `packages/opencode/test/evidence/dual-pass-citation-integrity.test.ts`
  - Create: `packages/opencode/test/session/turn-gate-e2e.test.ts`
- Must not touch:
  - `packages/opencode/src/session/orchestrator/dual-pass.ts`
  - `packages/opencode/src/verification/claim-graph.ts`

---

## 2) Bootstrap commands (coordinator)

### Task 1: Create three isolated worktrees

**Step 1: Sync and verify base branch**

Run:
```bash
git -C /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src branch --show-current
git -C /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src status --short --branch
```

Expected: on `feature/opencode-custom`, clean tree.

**Step 2: Create worktree A**

Run:
```bash
git -C /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src worktree add -b codex/a1-claim-graph-gate /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-claim-graph feature/opencode-custom
```

**Step 3: Create worktree B**

Run:
```bash
git -C /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src worktree add -b codex/a1-dual-pass /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-dual-pass feature/opencode-custom
```

**Step 4: Create worktree C**

Run:
```bash
git -C /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src worktree add -b codex/a1-evidence-flags /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-evidence-flags feature/opencode-custom
```

**Step 5: Verify topology**

Run:
```bash
git -C /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src worktree list
```

---

## 3) Parallel execution tasks

### Task 2A: Implement Claim Graph Gate (Worktree A)

**Step 1: Write failing tests**

- `packages/opencode/test/session/claim-graph-gate.test.ts`
  - pass/degrade/block threshold behavior
  - unsupported/conflict metrics calculation
- `packages/opencode/test/verification/claim-gate-regression.test.ts`
  - high-risk unsupported claims cannot pass
  - unknown-first fallback is preserved

**Step 2: Run failing tests**

Run:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-claim-graph/packages/opencode
bun test test/session/claim-graph-gate.test.ts test/verification/claim-gate-regression.test.ts --bail
```

**Step 3: Implement minimal protocol + gate core**

- Add `claim-graph/1.0` protocol contract.
- Add claim graph builder + gate decision logic in verification path.
- Keep existing verification semantics; add A1 behavior behind new flags (wired later by Worktree C).

**Step 4: Run focused gate tests**

Run:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-claim-graph/packages/opencode
bun test test/session/claim-graph-gate.test.ts test/verification/claim-gate-regression.test.ts test/verification/*.test.ts --bail
```

**Step 5: Commit**

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-claim-graph
git add packages/opencode/src/protocol/claim-graph.ts packages/opencode/src/verification/claim-graph.ts packages/opencode/src/verification/index.ts packages/opencode/test/session/claim-graph-gate.test.ts packages/opencode/test/verification/claim-gate-regression.test.ts
git commit -m "feat(a1): add claim graph gate core and regression coverage"
```

### Task 2B: Implement Dual-pass Synthesis (Worktree B)

**Step 1: Write failing tests**

- `packages/opencode/test/session/dual-pass-protocol.test.ts`
  - draft -> critic -> final protocol contract
- `packages/opencode/test/session/dual-pass-degrade.test.ts`
  - critic timeout/failure fallback to degraded draft or unknown-first

**Step 2: Run failing tests**

Run:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-dual-pass/packages/opencode
bun test test/session/dual-pass-protocol.test.ts test/session/dual-pass-degrade.test.ts --bail
```

**Step 3: Implement minimal dual-pass flow**

- Add `dual-pass/1.0` protocol contract.
- Add orchestrator dual-pass runtime module.
- Integrate into `runOrchestratorTurn` only for A1 on-risk conditions.
- Keep fallback path explicit and replay-safe.

**Step 4: Run focused dual-pass tests**

Run:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-dual-pass/packages/opencode
bun test test/session/dual-pass-protocol.test.ts test/session/dual-pass-degrade.test.ts test/session/orchestrator-*.test.ts --bail
```

**Step 5: Commit**

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-dual-pass
git add packages/opencode/src/protocol/dual-pass.ts packages/opencode/src/session/orchestrator/dual-pass.ts packages/opencode/src/session/orchestrator/index.ts packages/opencode/src/protocol/orchestrator-plan.ts packages/opencode/test/session/dual-pass-protocol.test.ts packages/opencode/test/session/dual-pass-degrade.test.ts
git commit -m "feat(a1): add dual-pass synthesis protocol and fallback path"
```

### Task 2C: Wire evidence/events/flags and E2E (Worktree C)

**Step 1: Write failing tests**

- `packages/opencode/test/evidence/dual-pass-citation-integrity.test.ts`
  - dual-pass output citation/pointer integrity
- `packages/opencode/test/session/turn-gate-e2e.test.ts`
  - A1 flag path enforces gate decisions end-to-end

**Step 2: Run failing tests**

Run:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-evidence-flags/packages/opencode
bun test test/evidence/dual-pass-citation-integrity.test.ts test/session/turn-gate-e2e.test.ts --bail
```

**Step 3: Implement wiring**

- Add A1 feature flags:
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1`
  - `OPENCODE_EXPERIMENTAL_CLAIM_GRAPH_GATE`
  - `OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS`
- Add evidence event payload fields for claim graph decision and dual-pass fallback.
- Wire feature extraction + processor gating (no orchestrator logic rewrite here).

**Step 4: Run focused wiring tests**

Run:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-evidence-flags/packages/opencode
bun test test/evidence/dual-pass-citation-integrity.test.ts test/session/turn-gate-e2e.test.ts test/evidence/*.test.ts test/session/orchestrator-*.test.ts --bail
```

**Step 5: Commit**

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/wt-a1-evidence-flags
git add packages/opencode/src/evidence/chain.ts packages/opencode/src/evidence/events.ts packages/opencode/src/flag/flag.ts packages/opencode/src/session/orchestrator/features.ts packages/opencode/src/session/processor.ts packages/opencode/test/evidence/dual-pass-citation-integrity.test.ts packages/opencode/test/session/turn-gate-e2e.test.ts
git commit -m "feat(a1): wire claim-gate and dual-pass events flags and e2e coverage"
```

---

## 4) Coordinator integration and merge order

### Task 3: Merge and reconcile in deterministic order

Merge order is fixed to minimize conflicts:
1. `codex/a1-claim-graph-gate`
2. `codex/a1-dual-pass`
3. `codex/a1-evidence-flags`

For each branch:

**Step 1: Merge with no-ff**

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src
git checkout feature/opencode-custom
git merge --no-ff <branch-name>
```

**Step 2: Run incremental gate after each merge**

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode
bun test test/session/orchestrator-*.test.ts test/verification/*.test.ts --bail
```

If failed: stop merging and return issue to owning worktree branch.

---

## 5) Release gate commands (must all pass)

### Task 4: Full A1 acceptance gate

Run in coordinator workspace:

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode
bun test test/session/claim-graph-gate.test.ts test/verification/claim-gate-regression.test.ts test/session/turn-gate-e2e.test.ts --bail
bun test test/session/dual-pass-protocol.test.ts test/session/dual-pass-degrade.test.ts test/evidence/dual-pass-citation-integrity.test.ts --bail
bun test test/verification/*.test.ts test/evidence/*.test.ts test/session/orchestrator-*.test.ts --bail
bun test --bail

cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/app
bun test
```

Additional stability check:

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode
bun test test/session/orchestrator-*.test.ts --bail
bun test test/session/orchestrator-*.test.ts --bail
bun test test/session/orchestrator-*.test.ts --bail
```

---

## 6) Rollback matrix (no history rewrite)

### Runtime rollback (preferred)

1. Disable dual-pass only:
   - `OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS=false`
2. If claim gate regression is detected:
   - keep `unknown-first` on
   - disable claim graph structure path:
     - `OPENCODE_EXPERIMENTAL_CLAIM_GRAPH_GATE=false`
3. Emergency A1 off-switch:
   - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1=false`

### Code rollback (if required)

- Use forward revert commit(s), never reset/rebase.
- Revert order (newest first):
  1. `codex/a1-evidence-flags` merge commit
  2. `codex/a1-dual-pass` merge commit
  3. `codex/a1-claim-graph-gate` merge commit

For each revert:

```bash
git checkout feature/opencode-custom
git revert -m 1 <merge_commit_sha>
```

Then run:

```bash
cd packages/opencode && bun test --bail
cd packages/app && bun test
```

---

## 7) Exit criteria checklist

- [ ] A1 flags exist and are wired behind orchestrator feature path.
- [ ] Claim graph gate yields pass/degrade/block with test coverage.
- [ ] Dual-pass has deterministic fallback (`degraded` or `unknown-first`) and test coverage.
- [ ] Evidence events and artifacts contain replayable gate decision and fallback reasons.
- [ ] All release gate commands pass with fresh logs.
- [ ] Merge commits are `--no-ff`; no history rewrite performed.
