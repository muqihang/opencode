# P2B Audit Closure Replay Report

## Task
`F4-HQ-P2B-AUDIT-CLOSURE-01`

## Baseline
- Base ancestor verified: `171ce7f38` is ancestor of current HEAD.
- Worktree: `wt-v16-f4-hq-p2b-audit-closure`.

## RED Phase
Command:

```bash
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test \
  test/session/reference-check-grounding.test.ts \
  test/session/orchestrator-secure-output-policy.test.ts \
  test/retrieval/runner.test.ts \
  test/session/compaction-structured.test.ts \
  test/session/compaction-structured-regression.test.ts \
  test/session/compaction-restart-soak.test.ts \
  test/secure-output/secure-output.test.ts \
  test/governance/f4-hq-nightly-soak-script.test.ts \
  test/governance/f4-hq-go-pack.test.ts --bail
```

Result:
- exit code: `1`
- first failure observed from missing/new assertions (expected RED)

## GREEN Phase

### Typecheck
```bash
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck
```
- exit code: `0`

### Targeted audit suite
```bash
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test \
  test/session/reference-check-grounding.test.ts \
  test/session/orchestrator-secure-output-policy.test.ts \
  test/retrieval/runner.test.ts \
  test/session/compaction-structured.test.ts \
  test/session/compaction-structured-regression.test.ts \
  test/session/compaction-restart-soak.test.ts \
  test/secure-output/secure-output.test.ts \
  test/governance/f4-hq-nightly-soak-script.test.ts \
  test/governance/f4-hq-go-pack.test.ts --bail
```
- exit code: `0`
- summary: all selected tests pass

### Nightly soak evidence generation
```bash
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run ./script/f4-hq/nightly-soak.ts
```
- exit code: `0`
- output artifact:
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/nightly-soak/f4-hq-nightly-soak-latest.md`

Nightly replay details included in artifact:
- how nightly runs: `nightly_run` command line
- artifact location: `artifact_location`
- pass/fail criteria: `decision_criteria`

### GO pack generation
```bash
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run ./script/f4-hq/go-pack.ts
```
- exit code: `0`
- output artifacts:
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack/f4-hq-go-pack-latest.md`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack/f4-hq-go-pack-latest.json`

## Output Artifacts
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/nightly-soak-input.json`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack-input.json`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/nightly-soak/f4-hq-nightly-soak-latest.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack/f4-hq-go-pack-latest.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack/f4-hq-go-pack-latest.json`

## Backlog 对账表

| ID | Status | Evidence |
| --- | --- | --- |
| F4-AUD-006 | done | `packages/opencode/src/session/verification-mode.ts`, `packages/opencode/src/session/reference-check.ts`, `packages/opencode/src/session/processor.ts`, `packages/opencode/test/session/reference-check-grounding.test.ts`, `packages/opencode/test/session/orchestrator-secure-output-policy.test.ts` |
| F4-AUD-007 | done | `packages/opencode/src/session/probe-correlation.ts`, `packages/opencode/src/retrieval/runner.ts`, `packages/opencode/src/secure-output/worker.ts`, `packages/opencode/src/session/compaction.ts`, related tests under retrieval/session/secure-output |
| F4-AUD-008 | done | `packages/opencode/src/session/compaction-protocol.ts`, `packages/opencode/src/session/compaction.ts`, `packages/opencode/test/session/compaction-structured*.test.ts`, `packages/opencode/test/session/compaction-restart-soak.test.ts` |
| F4-AUD-009 | done | `packages/opencode/script/f4-hq/nightly-soak.ts`, `packages/opencode/test/governance/f4-hq-nightly-soak-script.test.ts`, `docs/.../nightly-soak/f4-hq-nightly-soak-latest.md` |
| F4-AUD-010 | done | `packages/opencode/script/f4-hq/go-pack.ts`, `packages/opencode/test/governance/f4-hq-go-pack.test.ts`, `docs/.../go-pack/f4-hq-go-pack-latest.{md,json}` |
