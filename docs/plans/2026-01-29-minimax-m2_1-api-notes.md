# MiniMax M2.1 API Notes

日期：2026-01-30  
范围：MiniMax M2.1（Anthropic-compatible 优先）

## 1) Anthropic-compatible Prompt Caching

- 推荐使用 **Anthropic-compatible** 接口进行缓存控制：
  - 消息层使用 `cache_control`（如 `ephemeral`）
  - usage/metadata 中会返回 **cache_read / cache_write tokens**（例如 `cache_read_input_tokens` / `cache_write_input_tokens` 或等价字段）
- OpenCode 统计应以 Anthropic-compatible 字段为准。

## 2) Tool Use + Interleaved Thinking 回放原则

- M2.1 可能出现 **thinking 与 tool call 交错** 的输出。  
- 回放历史时：
  - **不回放 thinking 内容**（避免污染与膨胀）
  - 保持 tool call / tool result 的顺序与配对

## 3) OpenAI-compatible Cache 文档不可靠

- OpenAI-compatible 的缓存说明处于“coming soon”状态，**不应作为缓存方案**。  
  P1.6 仅以 Anthropic-compatible 缓存为准。
