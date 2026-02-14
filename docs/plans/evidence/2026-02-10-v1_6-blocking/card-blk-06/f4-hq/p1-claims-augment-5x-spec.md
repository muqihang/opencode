# P1 Claims Augment 5X Spec

## Scope
- Card: `F4-HQ-P1-CLAIMS-AUGMENT-5X-01`
- Branch: `codex/v16-f4-hq-p1-claims-augment-5x`
- Worktree: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-claims-augment-5x`
- Constraints:
  - local-only
  - no destructive git operations
  - no changes in `packages/app/**`
  - fail-fast for typecheck/test/build/doc-write/commit

## Implemented Enhancements (5/5)

### 1) 自动事实提取与声明草稿
- Added strict-only auto-draft in `packages/opencode/src/secure-output/worker.ts`:
  - Extracts legal inline `file:line` / `file:line-line` references from user-visible text when `<assistant_claims_json>` is absent.
  - Synthesizes minimal fact claims payload and re-enters existing normalization + verification pipeline.
  - Emits `secure_output.claims_drafted` event for auditability.

### 2) 智能指针自动化（path/sha/anchor）
- Unified pointer normalization path in `packages/opencode/src/secure-output/worker.ts`:
  - path normalization (`\` -> `/`, trim leading `./`)
  - safe-root check before pointer promotion
  - placeholder sha256 auto-fill from safe roots
  - fail-closed when sha cannot be safely completed
  - anchor normalization from string/object to canonical object payload

### 3) 声明验证反馈（可审计）
- Added structured reference-check feedback for failed verification in `packages/opencode/src/secure-output/worker.ts`:
  - writes `secure-output/<message>.reference-check.json`
  - emits `reference_check.feedback` with
    - `invalid_refs_count`
    - `reason_codes`
- Added strict reference-check fail-closed artifact in `packages/opencode/src/session/processor.ts`:
  - writes `reference-check/<message>.failed.json`
  - enriches `reference_check.failed` event with `invalid_refs_count` + `reason_codes`.

### 4) 上下文感知声明粒度（intent-aware contract）
- Introduced contract resolver in `packages/opencode/src/session/secure-output-contract.ts`:
  - strict contract for verification-like intents (`verification/summary/handoff/audit` etc.)
  - lightweight contract for normal chat
- Integrated resolver into main stream path:
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/llm.ts`
- Extended non-main title/summary flows to pass strict summary-intent contract:
  - `packages/opencode/src/session/summary.ts`
  - `packages/opencode/src/session/prompt.ts`

### 5) 与主流程深度集成（strict claims seed）
- Added strict-mode claims seed generation/injection:
  - seed parser + renderer in `packages/opencode/src/session/secure-output-contract.ts`
  - integrated into orchestrator turn return system in `packages/opencode/src/session/orchestrator/index.ts`
- Seed is injected only for strict intents and sourced from broker pointers and/or working-set pointer strings.

## Compatibility
- P0 constraint preserved: frontend stream mask still removes `<assistant_claims_json>` from user-visible deltas (verified by existing stream-mask tests).
- Existing secure-output, orchestrator, and llm pathways remain backward-compatible with optional fields.

## Test Coverage Added/Updated
- `packages/opencode/test/secure-output/secure-output.test.ts`
  - strict auto-draft from inline refs
  - structured reference-check artifact/event assertions
- `packages/opencode/test/session/llm.test.ts`
  - normal chat lightweight contract default
  - explicit strict contract override path
- `packages/opencode/test/session/orchestrator-turn.test.ts`
  - strict path claims seed injection
  - non-strict path no seed
- `packages/opencode/test/session/orchestrator-secure-output-policy.test.ts`
  - lightweight default + strict override assertions
