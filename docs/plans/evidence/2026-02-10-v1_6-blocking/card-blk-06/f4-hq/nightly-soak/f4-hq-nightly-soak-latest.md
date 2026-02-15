# F4 HQ Nightly Soak

## Gate Status
- restart_resume_monotonicity: true | resume checkpoints monotonic
- strict_reference_gate: true | no violations and fail-closed enabled
- assisted_compaction_guardrails: true | degraded path guarded and fallback safe

## Metrics
- nightly_soak_pass_rate: 0.997
- restart_resume_regression: 0

## Replay Snippet
- nightly_run: bun run ./packages/opencode/script/f4-hq/nightly-soak.ts --source docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/nightly-soak-input.json
- artifact_location: docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/nightly-soak/f4-hq-nightly-soak-latest.md
- decision_criteria: all three gates must be true; any false gate blocks release.
- exit_code: 0
