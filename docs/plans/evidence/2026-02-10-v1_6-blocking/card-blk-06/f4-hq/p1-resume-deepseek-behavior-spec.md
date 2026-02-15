# P1 Resume + DeepSeek Behavior Spec

## Scope
- Task code: `F4-HQ-P1-RESUME-DEEPSEEK-BEHAVIOR-01`
- Type: local-only fix
- Target: deterministic secure-output checkpoint binding + DeepSeek profile governance + observable v1.6 deepseek thinking branch

## Old Behavior vs New Behavior

### 1) Secure-output checkpoint binding
- Old:
  - secure-output verification task-frame used `contextPackId: "unknown"`.
  - strict mode could continue to verification/degrade path without a real context checkpoint binding.
  - no explicit strict fail-closed event dedicated to missing contextPackId.
- New:
  - secure-output accepts and validates an explicit `contextPackId` (rejects empty/`unknown`).
  - strict mode missing/invalid contextPackId triggers fail-closed.
  - emits `secure_output.fail_closed` with reason code `context_pack_id_missing`.
  - verification task-frame now binds real `contextPackId`, persisted into report + events.

### 2) DeepSeek sampling governance
- Old:
  - DeepSeek thinking sanitation existed, but no explicit profile governance contract.
  - no explicit strict/normal policy object with audit impact fields.
  - orchestrator v16 deepseek flag had no hard behavior branch in sampling strategy.
- New:
  - explicit DeepSeek sampling policy resolution (`profile`, `modeResolved`, `reasonCodes`, `audit`).
  - profile tiers: `normal` / `strict`.
  - strict profile applies only when orchestrator v16 deepseek flag is enabled and mode is reasoner/thinking.
  - strict profile enforces stronger incompatible-parameter suppression (including `topK`) and drops top-level sampling params for reasoner/thinking path.

### 3) v16 deepseek thinking behaviorization
- Old:
  - `orchestrator_v16_deepseek_thinking` primarily existed as rollout gate parse.
  - no observable effect proving “hit strategy -> changed params”.
- New:
  - processor forwards resolved v16 deepseek gate into LLM stream input.
  - LLM resolves DeepSeek sampling policy using that gate and model mode.
  - emits auditable event `deepseek.sampling_profile` with `mode_resolved`, `profile`, `reason_codes`, and impact fields (`option_dropped`, `top_level`).

## contextPackId 贯通链路图（来源 -> 消费）

```text
ContextPackCache.build()
  -> pack.contextPackId
  -> LLM.stream() return payload { contextPackId }
  -> SessionProcessor text-end secure-output gate call
  -> runSecureOutput({ contextPackId, ... })
  -> runVerification(taskFrame.contextPackId = real contextPackId)
  -> verification.report.json.contextPackId
  -> secure-output / verification evidence events
```

## DeepSeek Profile 规则表

| 条件 | modeResolved | profile | provider options影响 | top-level采样影响 |
|---|---|---|---|---|
| 非 DeepSeek 模型 | `non_deepseek` | `normal` | 不变 | 不变 |
| DeepSeek chat | `chat` | `normal` | 不变 | 不变 |
| DeepSeek reasoner/thinking + v16 flag 关闭 | `reasoner`/`thinking` | `normal` | 清理不兼容参数（基础集合） | 保留 `temperature/topP/topK` |
| DeepSeek reasoner/thinking + v16 flag 开启 | `reasoner`/`thinking` | `strict` | 额外清理 `topK/top_k` 等严格集合 | 丢弃 `temperature/topP/topK` |

## v16 deepseek thinking 行为化证据与事件字段

### Behavior branch
- Input branch key: `orchestratorV16DeepseekThinking` (from rollout gate).
- Effect branch:
  - strict candidate (reasoner/thinking + flag on) => strict profile.
  - otherwise => normal profile.

### Auditable event
- Event type: `deepseek.sampling_profile`
- Actor: `session:llm`
- Key fields:
  - `mode_resolved`
  - `profile`
  - `reason_codes`
  - `orchestrator_v16_deepseek_thinking`
  - `option_dropped`
  - `top_level` (`temperature/topP/topK` kept/dropped)

## Safety Invariants
- No relaxation on reference-check gate behavior.
- No degradation of secure-output claims masking path.
- Claims verification still required for fact claims under secure-output strict path.
- Missing strict checkpoint now closes output path instead of silent fallback to unknown context.

## Risks
1. Strict mode now degrades when contextPackId is missing; callers bypassing LLM context pack build can observe stricter behavior.
2. DeepSeek strict profile drops top-level sampling in reasoner/thinking when v16 gate is on; output style/variance may shift.
3. Additional observability event volume increases for DeepSeek sessions.

## Rollback Plan
1. Functional rollback:
   - disable `orchestrator_v16_deepseek_thinking` to restore normal DeepSeek profile path.
2. Code rollback:
   - revert secure-output contextPackId fail-closed block + policy resolver integration in LLM/processor.
3. Safe rollback guard:
   - keep existing targeted tests and replay report, re-run RED/GREEN before and after rollback.
