# GLM-4.7 API Notes（Zhipu / ZAI）

日期：2026-01-30  
范围：GLM-4.7（OpenAI-compatible 推荐路径）

## 1) usage.cached_tokens 字段位置

- OpenAI-compatible usage 中，`cached_tokens` 常在  
  **`prompt_tokens_details.cached_tokens`**（不是顶层字段）。
- 统计层应从 `prompt_tokens_details` 读取缓存命中。

## 2) Thinking 默认开启 / 如何关闭

- GLM-4.7 **默认启用 thinking**（返回 reasoning/thinking 内容）。
- 关闭方式（OpenCode providerOptions）：  
  - `thinking: { type: "disabled" }`  
  - 或显式关闭 reasoning/think 相关选项（以 OpenAI-compatible 请求参数为准）
- **回放原则**：thinking 内容不应作为下一轮输入（避免膨胀与污染）。

## 3) Tool Calling 语义

- 语义与 OpenAI 兼容：  
  - assistant 产生 `tool_calls`  
  - tool 结果以 `tool` role + `tool_call_id` 回传
- schema 建议保持稳定、字段严格。

## 4) 推荐路径

- **优先走 OpenAI-compatible** 路径，便于与 OpenCode 统一处理。
