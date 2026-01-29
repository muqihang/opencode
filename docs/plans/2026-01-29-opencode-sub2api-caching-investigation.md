# OpenCode + Sub2API 缓存命中差异（Codex CLI vs OpenCode）排查记录

日期：2026-01-29
范围：OpenCode（`opencode-zh-build/opencode_src`）+ Sub2API（`sub2api/`）+ 本机 OpenCode 配置（`/.opencode/opencode.json`）
状态：已复核（基于当前工作区代码与配置）

## 问题陈述

同样使用 OpenAI 的 Codex 订阅账户（通过自部署 Sub2API 网关转发），在 **Codex CLI** 里能观察到非常高的缓存命中（从而显著节约 token）。
但在 **OpenCode** 里（同样走 Sub2API），Sub2API 工作台几乎看不到缓存命中，导致 token 消耗巨大。

> 这里的“缓存命中”指 **LLM prompt caching / cached_tokens** 带来的 input tokens 折扣（不是 OAuth access_token 缓存）。

## 关键结论（TL;DR）

OpenCode 本身具备“记录 cached tokens / 计算 cache.read 成本”的能力，也具备“向 OpenAI Responses API 传 `prompt_cache_key`”的通道。
但在你当前的实际配置里：

1) OpenCode 默认使用的是 `sub2api/*` provider，而 **`prompt_cache_key` 默认不会自动注入**；
2) 同时 OpenCode 也 **没有给 Sub2API 发送 `session_id` / `conversation_id` 这类用于粘性会话的 header**；
3) Sub2API 的 OpenAI 网关在做“粘性会话（sticky session）→ 同一会话绑定同一上游账号”时，优先依赖上述 header，其次才看 body 里的 `prompt_cache_key`；

因此在 OpenCode 场景中，Sub2API 很难做到“同一会话持续命中同一上游账号/上下文缓存”，从而导致 cached_tokens 命中率显著低于 Codex CLI。

另外：设计稿中“要达到 Codex CLI 级别的高缓存命中（prefix determinism + context-pack 指纹复用）”的完整方案主要落在 **P3**（不是 P2）。

## 证据链（可对账的代码/配置点）

### A. 你当前 OpenCode 默认模型配置使用 `sub2api/*`

文件：`/.opencode/opencode.json`

- 默认模型：`"model": "sub2api/gpt-5.2-codex"`
- provider `sub2api`：
  - `"npm": "@ai-sdk/openai"`
  - `"options": { "baseURL": "http://localhost:18080/v1", "store": false, ... }`
  - **未配置 `setCacheKey: true`**

这意味着 OpenCode 在构建 OpenAI 请求时，不会自动带上 `prompt_cache_key`（除非走 `openai/*` provider 或显式开启 setCacheKey）。

### B. OpenCode 仅在 “openai provider / setCacheKey=true” 时注入 `promptCacheKey`

文件：`opencode-zh-build/opencode_src/packages/opencode/src/provider/transform.ts`

逻辑（核心判断）：

- 仅当 `model.providerID === "openai"` 或 `providerOptions.setCacheKey === true` 时：
  - `result["promptCacheKey"] = input.sessionID`

因此当 providerID 为 `sub2api` 且未显式设置 `setCacheKey=true` 时，**不会生成 `prompt_cache_key`**。

（对应逻辑位于 `ProviderTransform.options()` 附近）

### C. Sub2API 的粘性会话 hash 来源优先级：header > body

文件：`sub2api/backend/internal/service/openai_gateway_service.go`

`GenerateSessionHash()` 的优先级清单（源码注释已有写明）：

1. Header: `session_id`
2. Header: `conversation_id`
3. Body: `prompt_cache_key`（注释写了 “opencode”）

当上述字段缺失时，Sub2API 将无法生成稳定的 `sessionHash`，从而难以稳定绑定上游账号。

### D. OpenCode 当前请求头并不会给 `sub2api/*` provider 注入 `session_id` / `conversation_id`

文件：`opencode-zh-build/opencode_src/packages/opencode/src/session/llm.ts`

OpenCode 会为部分 provider 注入一些 header（例如 opencode 官方托管 provider 的 `x-opencode-session` 等），但对自定义 `sub2api` provider 并不会自动加：

- `session_id`
- `conversation_id`

因此 Sub2API 无法通过 header 获得稳定会话标识。

## 快速缓解方案（无需改代码）

> 用于快速验证“问题是否确实在会话粘性/缓存 key 注入上”，同时立刻降低 token 消耗。

方案 1（建议先试）：将 OpenCode 默认模型从 `sub2api/*` 切换到 `openai/*`（baseURL 仍指向 Sub2API）

因为 OpenCode 内置 `openai` provider 会默认注入 `promptCacheKey = sessionID`，从而产生 `prompt_cache_key`。

方案 2：在 `sub2api` provider 的 options 中显式加入：

```json
{
  "setCacheKey": true
}
```

使其走 `ProviderTransform.options()` 的 `setCacheKey` 分支，从而注入 `prompt_cache_key`。

> 这两种方案都属于“把稳定会话 key 明确传给网关/上游”的范畴，能显著提升 sticky session 与缓存命中概率。

## 设计稿覆盖情况：是否已经设计升级“高缓存命中”？

设计稿：`opencode-zh-build/opencode_src/docs/plans/2026-01-25-opencode-sandbox-context-design.md`

结论：**有设计，但核心落在 P3**：

- P3 明确交付：
  - Context Pack（schema + 指纹 + 可审计计数器）
  - scoped LRU/TTL + 命中率统计
  - prefix determinism（toolsetFingerprint、block fingerprints、MCP freeze）

P2 主要是并行与写入协调，不会自然解决 “OpenAI prompt caching 命中率”。

## 建议新增阶段：P1.6（P2 前置）做“粘性会话/缓存命中对齐”

目的：在不引入完整 P3（Context Pack）大工程的前提下，先把“同一 session 稳定命中同一上游账号/缓存上下文”做对齐，
让通过 Sub2API 的 OpenCode 也能接近 Codex CLI 的缓存命中体验。

建议方向（后续在 P1.6 计划书中展开）：

- OpenCode：对 OpenAI/OpenAI-compatible 请求补齐 `session_id` / `conversation_id` header（用于网关 sticky session）
- OpenCode：对 `@ai-sdk/openai` 且 `baseURL` 为自定义网关场景，提供更清晰的 `setCacheKey` 默认策略/文档（避免“看起来配了网关但缓存永远 miss”）
- Sub2API（可选）：增加调试日志/指标，打印 session hash 来源（header vs body），便于现场定位

---

## 补充：Gemini / Antigravity（Google 订阅链路）与缓存/节省 token 的关系

> 你提到的 “antigravity” 目前在 Sub2API 里属于一个独立的平台（platform），它不是 “模型”，而更像是：
> - **Gemini CLI / IDE Code Assist** 背后的上游服务（Sub2API 会通过 OAuth 获取 access_token，再去请求上游）。
> - 在 Sub2API 源码中，这条链路的上游 base URL 主要是 `cloudcode-pa.googleapis.com`（内部 v1internal 接口）。

### 1) 为什么在 Gemini/Antigravity 场景里“命中缓存”更难被肉眼观察？

因为 Gemini 的“省 token”机制与 OpenAI prompt caching 不同：

- OpenAI / Codex（Responses API）依赖 `prompt_cache_key` + 上游 prompt caching（`cached_tokens`）；
- Gemini 更偏向 **Cached Content（显式缓存前缀）**：
  - 需要先创建一个 cached content 资源，再在后续请求中引用它（否则不会出现明显的 `cachedContentTokenCount`）。
  - 这和 OpenAI 的“只要前缀重复就自动 cache”不是同一个机制。

因此：如果你只是把 OpenCode 的多轮 messages 直接发给 Gemini（不做 cachedContent），即便“同一个 session”，也很可能看不到类似 OpenAI 那种高命中率的 cached_tokens。

### 2) 但 Sub2API 目前在 Gemini v1beta 路由上还有一个会话粘性缺口（会放大 token 消耗）

Sub2API 的 `GeminiV1BetaModels` handler 选择账号时，需要一个稳定 session key 才能做到“同一个会话尽量绑定同一个上游账户”：

- 当前实现里，它用 `ParseGatewayRequest(body)` → `GatewayService.GenerateSessionHash(parsedReq)` 来算 session hash；
- 但 `ParseGatewayRequest` 只解析 `system/messages/metadata.user_id` 这类字段（偏 Anthropic / OpenAI-ish），
  对 Gemini 的 `contents/systemInstruction` 基本解析不到；
- 结果：Gemini 请求经常算不出稳定的 session hash，导致账号选择更像“负载均衡随机/轮询”，
  会把同一会话打散到多个 OAuth 账号上，进一步降低任何形式的“上下文复用/缓存收益”。

> 这就是为什么：你在 Sub2API 工作台能看到“多账号轮询”很好用，但在“同一会话追求稳定缓存命中”时，它反而可能成为负面因素。

### 3) Antigravity（Claude ↔ Gemini 转换）与“稳定 session”有关的关键点

- Sub2API 的 Antigravity 适配在 Claude → Gemini 的转换里，内部会生成 `sessionId`，并且支持用 `metadata.user_id` 覆盖。
- 这意味着：如果我们在 OpenCode → Sub2API 的 Anthropic 请求里给出稳定的 `metadata.user_id`
  （例如 `session_<OpenCodeSessionID>`），Antigravity 上游至少能更稳定地把请求“串起来”。

结论：P1.6 里要把 Gemini/Antigravity 纳入“节省 token”体系，除了 oh-my-opencode 的 prompt 控制外，
Sub2API 的 Gemini sticky-session 以及 OpenCode 的 session 信号传递也需要一起做。
