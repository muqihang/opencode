# Gemini + Antigravity API Notes

日期：2026-01-30  
范围：Gemini（Google / Sub2API）+ Antigravity（平台路由）

## 1) Gemini Cache：Cached Content（显式）

- Gemini 的缓存主要是 **Cached Content（显式创建）**。  
- **P1.6 不实现自动化**，仅记录机制；后续由 **P3** 接入自动化流程。

## 2) Antigravity 平台说明

- Antigravity 在我们栈里是 **平台层**，上游为 `v1internal`。
- 支持 **Gemini + Claude**（以 Sub2API 的映射为例）。

## 3) 会话稳定策略

- **stickySessionHeaders + `session_id` header** 用于稳定上游账号/会话。  
  本次 P1.6 Core 已实现该机制。

## 4) OpenCode 配置片段（可复制）

```json
{
  "provider": {
    "gemini": {
      "name": "Gemini (Sub2API)",
      "npm": "@ai-sdk/google",
      "options": {
        "baseURL": "http://127.0.0.1:18080/v1beta",
        "apiKey": "sk-***"
      },
      "models": {
        "gemini-3-flash": { "name": "Gemini 3 Flash" },
        "gemini-3-pro-high": { "name": "Gemini 3 Pro High" }
      }
    },
    "antigravity-claude": {
      "name": "Antigravity (Claude)",
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "http://127.0.0.1:18080/antigravity/v1",
        "apiKey": "sk-***",
        "stickySessionHeaders": true
      },
      "models": {
        "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" },
        "claude-opus-4-5-thinking": { "name": "Claude Opus 4.5 Thinking" }
      }
    }
  }
}
```
