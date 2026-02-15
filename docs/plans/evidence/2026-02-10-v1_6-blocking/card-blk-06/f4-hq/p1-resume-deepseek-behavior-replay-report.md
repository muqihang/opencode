# P1 Resume + DeepSeek Behavior Replay Report

## Execution Metadata
- Task code: `F4-HQ-P1-RESUME-DEEPSEEK-BEHAVIOR-01`
- Worktree: `.worktrees/v16-f4-hq-p1-resume-deepseek-behavior`
- Branch: `codex/v16-f4-hq-p1-resume-deepseek-behavior`
- Baseline gate: `git merge-base --is-ancestor 5a8bcd10d HEAD` -> passed

## RED Phase Evidence

### RED-1 (target suite)
Command:
```bash
cd .worktrees/v16-f4-hq-p1-resume-deepseek-behavior/packages/opencode
bun test test/secure-output/secure-output.test.ts test/session/llm.test.ts test/session/orchestrator-secure-output-policy.test.ts test/session/orchestrator-turn.test.ts test/session/processor-secure-output-stream.test.ts --bail
```
Result:
- Exit code: `1`
- Failure:
  - `secure-output > strict: verification report binds provided contextPackId (never unknown)`
  - Expected `ctx-bind-01`, received `unknown`

### RED-2 (llm governance tests)
Command:
```bash
cd .worktrees/v16-f4-hq-p1-resume-deepseek-behavior/packages/opencode
bun test test/session/llm.test.ts --bail
```
Result:
- Exit code: `1`
- Failure:
  - `session.llm.deepseek sampling governance > strict/normal profiles diverge at parameter level for reasoner mode`
  - `LLM.resolveDeepseekSamplingPolicy` was undefined in old behavior

## GREEN Phase Evidence

### GREEN-1 typecheck
Command:
```bash
cd .worktrees/v16-f4-hq-p1-resume-deepseek-behavior/packages/opencode
bun run typecheck
```
Result:
- Exit code: `0`

### GREEN-2 target suite
Command:
```bash
cd .worktrees/v16-f4-hq-p1-resume-deepseek-behavior/packages/opencode
bun test test/secure-output/secure-output.test.ts test/session/llm.test.ts test/session/orchestrator-secure-output-policy.test.ts test/session/orchestrator-turn.test.ts test/session/processor-secure-output-stream.test.ts --bail
```
Result:
- Exit code: `0`
- Summary: `48 pass / 0 fail`

## Key Behavior Replays

### R1 secure-output checkpoint uses real contextPackId
- Replay:
  - strict fact claim path with explicit contextPackId `ctx-bind-01`.
  - verify generated `verification.report.json.contextPackId` equals provided value, not `unknown`.
- Outcome: pass.

### R2 strict missing contextPackId fail-closed
- Replay:
  - strict fact claim path without contextPackId.
  - assert `secure_output.fail_closed` event and reason code `context_pack_id_missing`.
  - assert degraded reason_codes includes same code.
- Outcome: pass.

### R3 DeepSeek strict/normal profile governance
- Replay:
  - reasoner mode with gate off => `normal` profile keeps `topK` + top-level sampling.
  - reasoner mode with gate on => `strict` profile drops `topK` and top-level sampling params.
- Outcome: pass.

### R4 v16 deepseek thinking observable behavior branch
- Replay:
  - `orchestrator_v16_deepseek_thinking=true` drives strict profile in reasoner/thinking mode.
  - assert policy exposes audit fields (`modeResolved`, `profile`, `reasonCodes`, `audit.topLevel`, `audit.optionDropped`).
  - runtime emits `deepseek.sampling_profile` event with impact details.
- Outcome: pass.

## Changed Components (high level)
- `secure-output/worker`: contextPackId validation + strict fail-closed + reason/event.
- `session/processor`: forwards real contextPackId + v16 deepseek gate to LLM stream.
- `provider/transform`: explicit DeepSeek mode/profile sampling sanitization.
- `session/llm`: policy resolver + sampling branch + auditable event + contextPackId return.
- tests: RED assertions and GREEN verification for R1-R4.

## Risks & Mitigations
- Risk: stricter strict-mode checkpoint requirement may degrade flows that bypass context pack handoff.
  - Mitigation: processor now forwards contextPackId from LLM stream.
- Risk: strict profile can alter DeepSeek response variance.
  - Mitigation: gated by `orchestrator_v16_deepseek_thinking`; observability event allows auditing.
