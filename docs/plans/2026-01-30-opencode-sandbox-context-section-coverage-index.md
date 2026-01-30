# OpenCode Sandbox Context Design - Section Coverage Index (P0-P4)

**Goal:** Provide a single, greppable index that maps the master design doc (Section 1+) to phase plans (P0-P4),
so future planning/execution does not miss any requirement.

**Source of truth (design):**
- `docs/plans/2026-01-25-opencode-sandbox-context-design.md`

**Phase plan files (execution plans):**
- P0: `docs/plans/2026-01-28-opencode-sandbox-context-p0-implementation-plan.md`
- P0.5: `docs/plans/2026-01-28-opencode-sandbox-context-p0_5-quick-patch-implementation-plan.md`
- P1: `docs/plans/2026-01-28-opencode-sandbox-context-p1-implementation-plan.v2.md`
- P1.5: `docs/plans/2026-01-28-opencode-sandbox-context-p1_5-implementation-plan.md`
- P1.6: `docs/plans/2026-01-29-opencode-sub2api-token-economy-p1_6-implementation-plan.md`
- P2: `docs/plans/2026-01-30-opencode-sandbox-context-p2-implementation-plan.md`

---

## Note on "Section 22/23"

As of **2026-01-30**, the master design doc has explicit headings through **Section 23**:
- Section 22: `Open Questions`
- Section 23: `外部参考`

---

## Phase -> Section Coverage (High-Level)

### P0 (DONE)

Primary intent: soft execution sandbox + Evidence Pack v1 + BashTool unified execution + git worktree isolation.

Design sections covered:
- Section 13: Execution Sandbox (soft backend, runner API skeleton)
- Section 14: BashTool in sandbox
- Section 15: Evidence Pack v1 (pack/manifest/events)
- Section 8.1: events.jsonl as SSOT (basic writer)
- Section 2.2: workdir isolation via git worktree (baseline)
- Section 17.1: minimal `config show --effective` (optional stretch)
- Section 11: PoC v1 "minimum loop" definition (baseline artifacts layout)

### P0.5 (DONE)

Primary intent: harden P0 determinism + view rendering + explicit enforcement flags.

Design sections covered:
- Section 15: canonical JSON / pack.md view template
- Section 2.3.5: canonicalization discipline (determinism)
- Section 13: explicit backend/enforcement recorded into evidence
- Section 5: Pointers-not-Paste enforcement for large outputs (tool output discipline)

### P1 (DONE)

Primary intent: PythonTool + child session sandbox consistency + micro-pack.

Design sections covered:
- Section 14.1: PythonTool "script registry" as an allowlisted execution surface
- Section 14: PythonTool in sandbox (runner args, registry wiring, input/output contract)
- Section 15: micro-pack schema + writer support
- Section 2.1: child sessions "each enter sandbox" (micro-pack emission)
- Section 8.1: protocol.violation event (evidence never silently breaks)
- Section 17: config schema (python config as strict schema)

### P1.5 (DONE)

Primary intent: close P0/P1 gates (no silent evidence loss, explainable boundaries, export, approvals).

Design sections covered:
- Section 8.1: `evidence.write_failed` event (no silent loss)
- Section 15: richer provenance + first-class patch artifacts
- Section 2.2: isolated workdir change-set becomes a first-class artifact
- Section 13.1.1: ExecPolicy eval artifact (`execpolicy.eval.json`) for explainability
- Section 12 + Section 6: safe export allowlist + no symlink traversal
- Section 1 / invariants: approval consolidation (max 1 approval per tool run)

### P1.6 (DONE)

Primary intent: token economy + sticky sessions + deterministic injection (OpenCode/oh-my/Sub2API alignment).

Design sections covered:
- Section 3.2: provider prompt caching alignment via deterministic prefix + local fingerprint
- Section 16.4: prefix determinism and injection stability (cache-friendly)
- Section 5: "Pointers-not-Paste" and budget-based pointerization for large injected content
- Section 7: oh-my-opencode orchestration safety (no cross-session injection, deterministic ordering)

### P2 (IN PROGRESS)

Primary intent: make parallel usable end-to-end (isolated->merge, shared write coordination, routing protocol skeleton).

Design sections covered (explicitly listed in the P2 plan "Design Coverage Index"):
- Section 2.2: workdir modes + merge semantics
- Section 18: post-merge gates -> `checks[]`
- Section 15.4: micro-pack -> macro-pack merge algorithm
- Section 2.3.*: routing worker protocol skeleton (schemas, canonicalization, defaults, scheduling)
- Section 13.2.1 (P2): file workbench upgrades (PDF pages/OCR/Office)
- Section 14.2: Python supply chain offline-first (wheelhouse/lock-hash)
- Section 3.1: P0-P2 must not require Redis
- Section 20.2: graph is optional accelerator; must degrade gracefully
- Section 5.2: undo evidence linkage (P1/P2)

---

## Section -> Phase Mapping (Status)

Legend:
- DONE: implemented by completed phases (P0/P0.5/P1/P1.5/P1.6)
- IN PROGRESS: currently in P2 plan
- PLANNED: expected to land in P3/P4 (no plan file yet)
- SPEC/ONGOING: design/process section (may not correspond to a single phase)

| Section | Title (short) | Status | Covered By | Notes / Remaining Work |
|---|---|---|---|---|
| 1 | Architecture | DONE (as architecture decisions) | P0+ | Ongoing; no single phase "finishes" it |
| 1.1 | Execution boundary | PARTIAL | P0/P1/P1.5 + (P3) | Execution side done; Context Builder/Cache Store depth is P3 |
| 2 | Multi-agent parallel + isolation | IN PROGRESS | P1 + P2 | P1 covers child micro-pack; P2 covers parallel writes/merge & routing skeleton |
| 3 | Context control + cache hits | PARTIAL | P1.6 + (P3) | Provider/cache alignment done in P1.6; context-pack SSOT is P3 |
| 4 | Evidence Pack inspiration mapping | SPEC/ONGOING | P0/P1/P2 indirectly | This is design rationale; implementation tracked in Section 15 tasks |
| 5 | Codex/GPT practices alignment | PARTIAL | P0.5/P1.5/P1.6 + P2 + (P3/P4) | Many mechanisms are in; remaining: more evals/telemetry/governance |
| 6 | Boundary between sandbox/context/cache | PARTIAL | P1.5 + P2 + (P3/P4) | Export safety and workdir modes are in; remaining: deeper cache boundary & remote archiving |
| 7 | oh-my-opencode multi-agent mechanisms | PARTIAL | P1.6 + P2 | Orchestration safety in P1.6; universal child finalizer in P2 |
| 8 | Observability + audit (OTel + evidence) | PARTIAL | P0/P1.5 + (P4) | events.jsonl is done; OTel/GenAI semconv is P4 |
| 9 | Upstream sync strategy | SPEC/ONGOING | (opencode-zh-build tooling) | Process-level; not a single phase. Ensure it stays consistent with Evidence provenance |
| 10 | UPSTREAM.lock.json spec | PARTIAL (tooling exists) | (opencode-zh-build tooling) + (P2.x suggested) | `update_opencode_zh.sh` supports writing it; ensure it's present + linked into evidence/CI |
| 11 | PoC definition + roadmap | SPEC/ONGOING | P0+ | Checkboxes in Section 11.2 reflect current progress |
| 12 | Threat model + default security | PARTIAL | P1.5 + (P4) | Baseline: deny/allowlist + audit. Hard sandbox + enterprise policy is P4 |
| 13 | Execution Sandbox detailed design | PARTIAL | P0/P1/P1.5 + P2 + (P4) | Soft backend now; P4 adds hard backends + capability truthfulness |
| 14 | BashTool + PythonTool norms | PARTIAL | P0/P1 + P2 | P2 adds Python supply chain + file workbench upgrades |
| 15 | Evidence Pack v1 | IN PROGRESS | P0/P0.5/P1/P1.5 + P2 | Macro merge (15.4) and richer checks/claims/risks are P2 |
| 16 | Context engineering | PLANNED (core) | P1.6 partial + (P3) | P3 owns context-pack SSOT, counters, compaction linkage |
| 17 | Config + governance | PARTIAL | P0/P1 + P2 + (P4) | P4 owns enterprise requirements/managed defaults + maturity flags |
| 18 | Gates + regression strategy | IN PROGRESS | P2 | P2 introduces post-merge gates and `checks[]`; P3 adds evals/counters |
| 19 | Ops + solo experience | PLANNED | P4 | Retention, indexing/search, self-heal workflows |
| 20 | Commercial direction (multi-tenant/mobile) | PLANNED (most) | P2 constraints + P4 | Some constraints already inform P2; real productization is P4 |
| 21 | Design review risk list + reinforcement | SPEC/ONGOING | (track across phases) | Use as a checklist for P3/P4 planning to avoid "design drift" |
| 22 | Open Questions | SPEC/ONGOING | - | Should be revisited at each phase boundary (P2 exit / P3 start / P4 start) |
| 23 | 外部参考 | SPEC | - | Reference-only |

---

## Potential Gaps / P2.x Supplement Candidates (P2 complete -> before P3)

These are "should not be forgotten" items that are either strongly recommended by the design doc or become high-leverage
before starting P3 context engineering.

1) **Section 10 - UPSTREAM.lock.json present + integrated**
   - Ensure the lock file exists in `opencode-zh-build/UPSTREAM.lock.json` after updates.
   - Add a minimal CI/local check so "missing lockfile" fails fast.
   - Link it into Evidence Pack provenance (as an artifact pointer, or fields in `environment.repo`).

2) **Section 13.2.1 (P1 baseline) - File workbench baseline parity**
   - The master design splits "资料工作台" into P1 and P2 scopes.
   - P2 Task 11 explicitly says: verify baseline exists; implement missing P1 pieces if needed.
   - If P2 execution ends up skipping Task 11, move it into a P2.x supplement and block P3 until it is done.

3) **Open Questions checkpoint (Section 22)**
   - Freeze decisions that affect determinism/SSOT before implementing Context Pack in P3.

---

## Future Phases - Required Section Coverage Checklist

### P3 (Context Pack + deterministic context engineering)

P3 plan MUST explicitly cover (at least):
- Section 16 (all core subsections): context-pack schema SSOT, counters, explainability, token budgets, compaction linkage
- Section 3 (cache store + provider prompt caching normalization): local fingerprint SSOT, cache hit observability
- Section 5 (remaining Codex-alignment mechanisms around explainability + eval discipline)
- Section 8 (telemetry linkage as far as needed for counters; full OTel still P4)
- Section 18.1 (minimal evals / guardrails), if not already sufficiently covered by P2 gates
- Section 17.1/17.3 (config layering + feature flags needed for P3 rollout safety)

### P4 (Hard sandbox + enterprise governance + OTel + retention/archival)

P4 plan MUST explicitly cover (at least):
- Section 13 (hard sandbox backends + truthful capability declaration)
- Section 8.2 (OTel GenAI semconv alignment + traceId/spanId linkage into evidence)
- Section 17.2 (requirements/managed defaults governance hooks)
- Section 14.2 (supply chain + SBOM/attestation inputs, if not fully completed in P2)
- Section 19 (retention, indexing, clean-up, self-heal UX)
- Section 20 (multi-tenant/cloud/mobile "correct defaults" and boundaries)
- Section 21 (risk list mitigation follow-ups)
