# P3 M1 Context Pack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a call-scoped Context Pack SSOT for every model invocation, write `context-pack.json` artifacts, and emit `context.pack_built` events with explainable segments/totals.

**Architecture:** Add a small Context Pack builder in `session/` that converts system/messages/tools into segments with token estimates, then wire it into `LLM.stream` to write the artifact and event via `EvidenceWriter`. Use existing `ContextPack` Zod schema and `stableJson` for deterministic output.

**Tech Stack:** Bun, TypeScript, Zod, `EvidenceWriter`, `ContextPack` protocol.

### Task 1: Add Context Pack builder contract tests

**Files:**
- Create: `packages/opencode/test/session/context-pack-builder.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { ContextPack } from "../../src/protocol/context-pack"
import { ContextPackBuilder } from "../../src/session/context-pack"
import { tool, jsonSchema, type ModelMessage } from "ai"

describe("session.context-pack", () => {
  test("build returns schema-valid pack with consistent totals", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]

    const tools = {
      hello: tool({
        description: "say hi",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "ok", title: "", metadata: {} }),
      }),
    }

    const pack = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_test",
      model: {
        providerID: "openai",
        id: "gpt-test",
        limit: { context: 4096, input: 2048, output: 1024 },
      },
      system: ["System"],
      messages,
      tools,
      maxOutputTokens: 1024,
    })

    const parsed = ContextPack.parse(pack)
    const total = parsed.segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0)

    expect(parsed.totals.segments).toBe(parsed.segments.length)
    expect(parsed.totals.tokenEstimate).toBe(total)
  })

  test("schema rejects totals mismatch", () => {
    const pack = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_test",
      model: {
        providerID: "openai",
        id: "gpt-test",
        limit: { context: 4096, input: 2048, output: 1024 },
      },
      system: ["System"],
      messages: [{ role: "user", content: "Hello" }],
      tools: {},
      maxOutputTokens: 1024,
    })

    expect(() =>
      ContextPack.parse({
        ...pack,
        totals: { ...pack.totals, segments: pack.totals.segments + 1 },
      }),
    ).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/context-pack-builder.test.ts`
Expected: FAIL with "Cannot find module '../../src/session/context-pack'" or missing export.

### Task 2: Implement Context Pack builder

**Files:**
- Create: `packages/opencode/src/session/context-pack.ts`

**Step 1: Write minimal implementation**

```ts
import { ContextPack, type ContextPack as ContextPackType } from "@/protocol/context-pack"
import type { Provider } from "@/provider/provider"
import type { ModelMessage, Tool } from "ai"
import { Token } from "@/util/token"
import { ulid } from "ulid"

export const ContextPackBuilder = {
  build(input: {
    sessionId: string
    messageId: string
    model: Pick<Provider.Model, "providerID" | "id" | "limit">
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, Tool>
    maxOutputTokens?: number
  }): ContextPackType {
    const now = new Date().toISOString()
    const packId = ulid()
    const maxTokens = Math.max(1, input.model.limit.context || 1)
    const output = input.maxOutputTokens ?? input.model.limit.output
    const rawBudget = input.model.limit.input ?? maxTokens - output
    const budgetTokens = Math.max(1, Math.min(maxTokens, rawBudget))

    const preview = (text: string) => text.trim().slice(0, 200)

    const toolNames = Object.keys(input.tools).sort().join("\n")

    const messageText = (message: ModelMessage) => {
      if (typeof message.content === "string") return message.content
      if (Array.isArray(message.content)) {
        return message.content
          .map((part) => {
            if (typeof part === "string") return part
            if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
              return part.text
            }
            return JSON.stringify(part)
          })
          .filter((value) => value)
          .join("\n")
      }
      return ""
    }

    const systemText = input.system.join("\n\n").trim()
    const historyText = input.messages.map(messageText).filter((value) => value).join("\n")

    const segments: ContextPackType["segments"] = []

    if (systemText) {
      segments.push({
        id: "seg:system",
        kind: "system",
        priority: "p0",
        tokenEstimate: Token.estimate(systemText),
        sources: [],
        preview: preview(systemText),
      })
    }

    if (toolNames) {
      segments.push({
        id: "seg:tools",
        kind: "tools",
        priority: "p1",
        tokenEstimate: Token.estimate(toolNames),
        sources: [],
        preview: preview(toolNames),
      })
    }

    if (historyText) {
      segments.push({
        id: "seg:history",
        kind: "history_summary",
        priority: "p1",
        tokenEstimate: Token.estimate(historyText),
        sources: [],
        preview: preview(historyText),
      })
    }

    const total = segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0)

    return ContextPack.parse({
      specVersion: "context-pack/1.0",
      contextPackId: packId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      createdAtUtc: now,
      model: { providerId: input.model.providerID, modelId: input.model.id },
      window: { maxTokens, budgetTokens },
      tokenEstimate: { method: "approx", version: "v1" },
      versions: { systemTemplate: "v1", toolsTemplate: "v1", capsuleSchema: "v1", stableJson: "v1" },
      ledger: { mode: "full" },
      segments,
      totals: { segments: segments.length, tokenEstimate: total },
    })
  },
}
```

**Step 2: Run test to verify it passes**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/context-pack-builder.test.ts`
Expected: PASS

### Task 3: Wire Context Pack build + artifact + event into LLM stream

**Files:**
- Modify: `packages/opencode/src/session/llm.ts`

**Step 1: Write failing test**

No additional tests required beyond builder contract; ensure integration covered by existing session/evidence tests.

**Step 2: Implement minimal integration**

- Import `ContextPackBuilder`, `EvidenceWriter`, and `stableJson`.
- Before `streamText` call, build the Context Pack from `system`, `input.messages`, `tools`, `input.model`, and `maxOutputTokens`.
- Write artifact to `.opencode/artifacts/<sessionId>/context/<contextPackId>/context-pack.json` via `EvidenceWriter.artifact`.
- Emit `context.pack_built` event with `contextPackId`, `artifact`, `window`, and `totals.tokenEstimate`.

**Step 3: Run package tests**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/opencode/src/session/context-pack.ts \
  packages/opencode/src/session/llm.ts \
  packages/opencode/test/session/context-pack-builder.test.ts

git commit -m "feat: build context pack per model call"
```
