# DeepSeek V3.2 API Notes

日期：2026-01-30  
范围：DeepSeek V3.2 / DeepSeek Reasoner（OpenAI-compatible）

## 1) KV / Disk Cache（命中字段 + 前缀规则）

- **命中字段**：DeepSeek usage 里常见 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`（有些版本只返回 hit）。  
  我们应将 **hit 视为 cache.read** 计入统计。
- **Prefix 特性**：命中依赖稳定前缀；前缀越一致、越长，命中越稳定。
- **过期 / 构建延迟**：首次请求或短时间内可能 **hit=0**；disk cache 有冷启动与 TTL 过期。
- **实践建议**：
  - **稳定前缀**：系统提示、工具 schema、固定上下文尽量不变。
  - **动态后置**：用户动态内容、时间戳、随机 ID 放到尾部。
  - **避免抖动**：减少每轮重排/增删系统块，避免缓存失效。

## 2) Thinking Mode（reasoning_content 回放规则）

- DeepSeek Reasoner 会返回 `reasoning_content`（思考链 / reasoning）。
- **不要回放到下一轮**：  
  - 会造成 prompt 膨胀、降低缓存命中；  
  - 可能污染后续思考（模型把自身思考再当输入）。

## 3) Tools（严格模式 / Beta Base URL / Schema 约束）

- **严格模式**：tool schema 需完整且严格（`required`、`additionalProperties: false`）。  
  违规字段会导致 tool call 失败或被模型忽略。
- **Beta Base URL**：部分工具调用能力要求 **beta base URL**（按官方文档建议）。
- **Schema 约束**：保持 schema 稳定，避免频繁变动导致缓存失效。

## 4) Anthropic Compat

- DeepSeek 提供 Anthropic-compatible 接口，但 **`cache_control` 对 DeepSeek 可能无效**。  
  在 P1.6 中不要把它当作可靠缓存方案。
