# P3-9 / I.9 - anchor-snapshot provider 覆盖矩阵

- Date: 2026-02-12
- Scope: 本地仓库静态证据 + 既有测试覆盖度审计
- Branch: `codex/v16-p3-9-anchor-coverage`
- Mode: local-only, fail-fast, no-push

## 1) 字段基线（anchor-snapshot）

`Pointer` 字段集由协议统一定义：

- `path`
- `sha256`
- `kind`
- `anchor`（可选）

证据：

- `packages/opencode/src/session/capsule-protocol.ts:25`
- `packages/opencode/src/session/capsule-protocol.ts:31`

## 2) Provider 覆盖矩阵（>=3）

Provider 归一化入口（sdk 包名 -> provider key）：

- OpenAI -> `openai`
- Anthropic -> `anthropic`
- Gemini/Google -> `google`

证据：

- `packages/opencode/src/provider/transform.ts:23`
- `packages/opencode/src/provider/transform.ts:30`
- `packages/opencode/src/provider/transform.ts:33`

| Provider | 映射存在 | Pointer 字段集适用 | 现有 anchor 断言 | 结论 |
|---|---|---|---|---|
| openai | 是 | `path/sha256/kind/anchor` | 否（未发现 provider 维度 anchor 断言） | 结构可用，测试覆盖不足 |
| anthropic | 是 | `path/sha256/kind/anchor` | 否（未发现 provider 维度 anchor 断言） | 结构可用，测试覆盖不足 |
| google (gemini) | 是 | `path/sha256/kind/anchor` | 否（未发现 provider 维度 anchor 断言） | 结构可用，测试覆盖不足 |

补充证据（测试现状）：

- `packages/opencode/test/session/capsule-protocol.test.ts:16`（当前仅覆盖 `specVersion`）
- `packages/opencode/test/session/capsule-protocol.test.ts:30`（当前仅覆盖 `specVersion`）
- `packages/opencode/test/session/capsule.test.ts:19`（fixture 含 `anchor`）
- `packages/opencode/test/session/capsule.test.ts:23`（断言仅覆盖 `path`）
- `packages/opencode/test/session/capsule.test.ts:24`（断言仅覆盖 `kind`）
- `packages/opencode/test/session/llm-sticky-session-headers.test.ts:5`（openai 分支存在）
- `packages/opencode/test/session/llm-sticky-session-headers.test.ts:14`（anthropic 分支存在）
- `packages/opencode/test/session/llm-sticky-session-headers.test.ts:23`（google 分支存在）

## 3) 结论（字段集“可维持 / 需扩展”）

### 可维持

- 协议字段集 `path/sha256/kind/anchor` 已在 `Pointer` 层统一定义，可继续作为 anchor-snapshot 最小稳定集合。

### 需扩展

- 需补齐 provider 维度（openai/anthropic/google）对 `anchor` 的断言覆盖，当前仅能证明“字段定义存在”，尚不能证明“按 provider 回放一致”。

## 4) 最小变更建议（如进入实现）

1. 在 `packages/opencode/test/session/capsule-protocol.test.ts` 增加 provider 参数化样例（至少 openai/anthropic/google），断言 `anchor` 在快照序列化与反序列化前后保持一致。
2. 在 `packages/opencode/test/session/capsule.test.ts` 增加 `anchor` 字段断言，避免 fixture 仅存在但未验。

## 5) 回滚动作

若补测后仍发现不一致：

1. 维持 provider 白名单（仅放行已验证 provider）。
2. 暂停未验证 provider 的 anchor 参与 compaction 恢复链路。
3. 保持 `P0-A6 anchor-snapshot/1.0` 口径，待补证通过后再扩面。
