# P1 Claims Augment 5X Regression Report

## Environment
- Date: 2026-02-14
- Workspace: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-claims-augment-5x`
- Dependency precondition command:
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-claims-augment-5x && bun install`
  - Exit: `0`

## RED Evidence
Command:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-claims-augment-5x/packages/opencode && bun test test/secure-output/secure-output.test.ts test/session/llm.test.ts test/session/orchestrator-turn.test.ts test/session/processor-secure-output-stream.test.ts --bail
```
Observed result:
- Exit: `1`
- Failure type: assertion failure (not dependency/env missing)
- Representative failure:
  - `Expected: "ok"`
  - `Received: "degraded"`
  - test: `secure-output > strict: auto-drafts minimal fact claims from inline file:line evidence`

## GREEN Evidence
Command:
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-claims-augment-5x/packages/opencode && bun test test/secure-output/secure-output.test.ts test/session/llm.test.ts test/session/orchestrator-turn.test.ts test/session/processor-secure-output-stream.test.ts --bail
```
Observed result:
- Exit: `0`
- Summary: `35 pass / 0 fail`

## Required Acceptance Commands

### 1) Typecheck
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-claims-augment-5x/packages/opencode && bun run typecheck
```
- Exit: `0`

### 2) Targeted tests
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-claims-augment-5x/packages/opencode && bun test test/secure-output/secure-output.test.ts test/session/llm.test.ts test/session/orchestrator-turn.test.ts test/session/processor-secure-output-stream.test.ts --bail
```
- Exit: `0`

## Risk Notes
- Contract default changed to lightweight; strict contract now intent-gated. This is intentional for R4 and covered by llm/policy tests.
- Auto-draft is strict-only and fail-closed when pointer safety/sha completion cannot be guaranteed.
- Reference-check feedback artifact/event fields are additive and backward-compatible for downstream consumers.
