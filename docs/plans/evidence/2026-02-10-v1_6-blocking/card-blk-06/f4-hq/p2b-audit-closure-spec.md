# P2B Audit Closure Spec

## Scope
Task: `F4-HQ-P2B-AUDIT-CLOSURE-01`

This closure extends P2 baseline (`171ce7f38`) and closes backlog gaps:
- F4-AUD-006 strict reference escalation
- F4-AUD-007 probe correlation across retrieval/compaction/secure-output
- F4-AUD-008 compaction consistency metric alignment
- F4-AUD-009 nightly soak suite evidence automation
- F4-AUD-010 unified GO pack automation

## Design Summary

### F4-AUD-006
- Added confidence-based escalation path from `normal` to `strict` in verification mode resolution.
- Added risk-signal derivation (`high_risk`, `evidence_heavy`) from response content.
- Preserved fail-closed semantics for strict reference checks.
- Standardized observability payload with `mode_resolved`, `confidence`, `reason_codes` while retaining legacy `mode`.

### F4-AUD-007
- Added deterministic `probe_correlation_id` generator in `packages/opencode/src/session/probe-correlation.ts`.
- Propagated `probe_correlation_id` into retrieval probe artifacts and retrieval start/terminal events.
- Propagated `probe_correlation_id` into secure-output artifacts/events (`claims`, `reference-check`, degraded/completed/drafted).
- Propagated `probe_correlation_id` into compaction started/quality/completed events and report artifacts.

### F4-AUD-008
- Extended compaction quality schema and payload with:
  - `contradiction_rate`
  - `anchor_consistency_score`
- Preserved compatibility fields:
  - `consistency_score`
  - `contradiction_count`
  - `reason_codes`
- Added traceable linkage to reference-check outcome in compaction report/event payload (`reference_check_*`).

### F4-AUD-009
- Added nightly soak runner:
  - `packages/opencode/script/f4-hq/nightly-soak.ts`
- Encodes and evaluates three mandatory gates:
  - `restart_resume_monotonicity`
  - `strict_reference_gate`
  - `assisted_compaction_guardrails`
- Emits markdown replay evidence including nightly command, artifact location, and decision criteria.

### F4-AUD-010
- Added unified GO pack generator:
  - `packages/opencode/script/f4-hq/go-pack.ts`
- Produces consolidated markdown + JSON at fixed path:
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack/f4-hq-go-pack-latest.md`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack/f4-hq-go-pack-latest.json`
- JSON includes `mandatory_metrics_all_green` and consolidated checks for P0/P1/P2/nightly/replay/external/mandatory gates.

## Inputs
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/nightly-soak-input.json`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/go-pack-input.json`

## Non-goals
- No changes under `packages/app/**`.
- No destructive git operations.
- No remote push.
