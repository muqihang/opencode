# Task 16 (P2): Visual Provenance (Message ↔ Activity Linking) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make the Activity timeline *trustworthy and controllable* by enabling “message ↔ activity” highlight + jump with a **reliable linking key** (no timestamp guessing).

**Architecture (high-level):**
1. **Trace Context (Server):** Introduce a per-turn trace context (AsyncLocalStorage) carrying `traceId` + `messageId`.
2. **Evidence Enrichment (Server):** Automatically inject `traceId` and `data.messageId` into every `EventV1` written during that turn (centralized in `EvidenceWriter.event`).
3. **Chronology Mapping (App):** Preserve `traceId` + `messageId` on synthesized `ActivityItem`s (and prevent tool pairing across turns by including `traceId` in grouping keys).
4. **UI Provenance (App):** Bidirectional “hover/focus highlight” and “Jump to message” action. (Bezier lines are explicitly out of scope.)

**Tech Stack:** Bun, TypeScript (strict), Zod, SolidJS (App), Tailwind (tokens), Kobalte Dialog.

**Non-Goals (explicit):**
- Do **not** draw Bezier/visual-thread lines in this task.
- Do **not** infer causality by timestamps alone.
- Do **not** add any “view raw artifact contents” UI (keep safe summary/pointers only).

---

## Task 0: Worktree Setup (Isolation)

**Commands:**

```bash
cd opencode-zh-build/opencode_src
git worktree add .worktrees/task16-provenance -b task16-provenance feature/opencode-custom
cd .worktrees/task16-provenance

# install (npm is not supported because of catalog:)
BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun install

git status -sb
```

**Expected:** clean worktree on branch `task16-provenance`.

---

## Task 1: [Server] Turn Trace Context + Deterministic traceId Helper

**Why this task exists:** We need a reliable correlation key and a safe way to read it from anywhere in the call graph, without plumbing through every tool call.

**Files:**
- Create: `packages/opencode/src/util/turn-trace.ts`
- Test: `packages/opencode/test/util/turn-trace.test.ts`

**Step 1: Write the failing test (RED)**

```ts
import { describe, expect, test } from "bun:test"
import { traceIdForMessageId } from "../../src/util/turn-trace"

describe("turn-trace", () => {
  test("traceIdForMessageId returns stable 16-byte hex", () => {
    const a = traceIdForMessageId("message_1")
    const b = traceIdForMessageId("message_1")
    const c = traceIdForMessageId("message_2")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{32}$/i)
  })
})
```

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/util/turn-trace.test.ts`  
Expected: **FAIL** (module/function not found).

**Step 2: Minimal implementation (GREEN)**

Create `packages/opencode/src/util/turn-trace.ts`:

```ts
import crypto from "crypto"
import { Context } from "@/util/context"

export type TurnTrace = {
  traceId: string
  messageId: string
}

const turnTrace = Context.create<TurnTrace>("turn-trace")

export const TurnTraceContext = {
  provide: turnTrace.provide,
  use: turnTrace.use,
  get(): TurnTrace | undefined {
    try {
      return turnTrace.use()
    } catch (error) {
      if (error instanceof Context.NotFound) return undefined
      throw error
    }
  },
}

export function traceIdForMessageId(messageId: string): string {
  // Deterministic, stable, and meets protocol TraceId regex: 32 hex chars.
  return crypto.createHash("sha256").update(messageId, "utf-8").digest("hex").slice(0, 32)
}
```

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/util/turn-trace.test.ts`  
Expected: **PASS**.

**Step 3: Commit**

```bash
git add packages/opencode/src/util/turn-trace.ts packages/opencode/test/util/turn-trace.test.ts
git commit -m "feat(evidence): add turn trace context helper [AI:Codex]"
```

---

## Task 2: [Server] EvidenceWriter.event Auto-injects traceId + messageId

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Modify: `packages/opencode/test/evidence/evidence-writer.test.ts`

**Step 1: Write failing test (RED)**

Add a new test case to `packages/opencode/test/evidence/evidence-writer.test.ts`:

```ts
import { TurnTraceContext } from "../../src/util/turn-trace"

test("injects traceId + messageId into events when turn context exists", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const writer = await EvidenceWriter.open({ sessionId: "ses_trace" })
      await TurnTraceContext.provide(
        { traceId: "0123456789abcdef0123456789abcdef", messageId: "message_123" },
        async () => {
          await writer.event({
            specVersion: "event/1.0",
            ts: "2026-02-01T00:00:00.000Z",
            sessionId: "ses_trace",
            severity: "info",
            actor: "tool:bash",
            type: "tool.started",
            summary: "started",
            redaction: { applied: true, policyVersion: "v1" },
          })
        },
      )

      const eventsPath = path.join(tmp.path, ".opencode", "evidence", "ses_trace", "events.jsonl")
      const lines = (await Bun.file(eventsPath).text())
        .split("\\n")
        .map((l) => l.trim())
        .filter(Boolean)
      const first = JSON.parse(lines[0]!) as any
      expect(first.traceId).toBe("0123456789abcdef0123456789abcdef")
      expect(first.data?.messageId).toBe("message_123")
    },
  })
})
```

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/evidence/evidence-writer.test.ts`  
Expected: **FAIL** (no injection yet).

**Step 2: Minimal implementation (GREEN)**

In `packages/opencode/src/evidence/writer.ts`, update the internal `event(inputEvent)` function to:
- read `TurnTraceContext.get()`
- if `traceId` is missing, inject from context
- if `data.messageId` is missing, inject from context
- keep “caller provided fields” highest priority (never overwrite existing `traceId` or existing `data.messageId`)

Pseudo-shape:

```ts
import { TurnTraceContext } from "@/util/turn-trace"

const ctx = TurnTraceContext.get()
const enriched = {
  ...inputEvent,
  traceId: inputEvent.traceId ?? ctx?.traceId,
  data: ctx?.messageId
    ? { ...(inputEvent.data ?? {}), ...(inputEvent.data?.messageId ? {} : { messageId: ctx.messageId }) }
    : inputEvent.data,
}
const eventData = EventV1.parse(enriched)
```

Run the same test again. Expected: **PASS**.

**Step 3: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/evidence-writer.test.ts
git commit -m "feat(evidence): inject traceId + messageId into events [AI:Codex]"
```

---

## Task 3: [Server] Provide TurnTraceContext in Session Loop

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts`

**Step 1: Add minimal “provide context” wiring**

At the point where `lastUser` is known (inside `Prompt.loop`), wrap the “do work for this step” block in:

```ts
import { TurnTraceContext, traceIdForMessageId } from "@/util/turn-trace"

const turnTrace = { traceId: traceIdForMessageId(lastUser.id), messageId: lastUser.id }
await TurnTraceContext.provide(turnTrace, async () => {
  // existing step logic (tool exec, routing, workbench, etc)
})
```

**Note:** Keep the scope tight: only wrap the code that performs side effects and tool/workbench/routing calls for this iteration.

**Step 2: Verify via a “real emitter” smoke test**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/sandbox` (or full suite if quickest)  
Expected: **PASS**.

Manual smoke:
- Run a session and trigger a tool call (bash/read_file).
- Confirm `.opencode/evidence/<sessionId>/events.jsonl` contains `traceId` + `data.messageId`.

**Step 3: Commit**

```bash
git add packages/opencode/src/session/prompt.ts
git commit -m "feat(session): propagate turn trace context to evidence events [AI:Codex]"
```

---

## Task 4: [App] Chronology Engine Preserves traceId/messageId + Groups by traceId

**Files:**
- Modify: `packages/app/src/lib/chronology/types.ts`
- Modify: `packages/app/src/lib/chronology/engine.ts`
- Modify: `packages/app/src/lib/chronology/engine.test.ts`

**Step 1: RED — add provenance expectations**

Extend `engine.test.ts`:

```ts
test("propagates traceId + messageId onto ActivityItem", () => {
  const events: EventV1[] = [
    {
      specVersion: "event/1.0",
      ts: "2026-02-01T00:00:00.000Z",
      sessionId: "ses_test",
      traceId: "0123456789abcdef0123456789abcdef",
      severity: "info",
      actor: "tool:bash",
      type: "tool.started",
      summary: "started",
      data: { messageId: "message_123" },
      redaction: { applied: true, policyVersion: "v1" },
    },
  ]
  const items = synthesize(events)
  expect(items[0]?.traceId).toBe("0123456789abcdef0123456789abcdef")
  expect(items[0]?.messageId).toBe("message_123")
})
```

Run: `cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test ./src/lib/chronology/engine.test.ts`  
Expected: **FAIL** (types/engine missing fields).

**Step 2: GREEN — update types + engine**

In `types.ts`, add:

```ts
export type ActivityItem = {
  // ...
  traceId?: string
  messageId?: string
}
```

In `engine.ts`:
- Use a helper to safely extract `messageId` from `EventV1.data`.
- When creating an ActivityItem, set `traceId` and `messageId` from the associated events.
- Update tool pairing key to include traceId (avoid pairing across turns):

```ts
function openKey(e: EventV1) {
  return `${e.traceId ?? "no-trace"}:${e.actor}`
}
```

Run test again. Expected: **PASS**.

**Step 3: Commit**

```bash
git add packages/app/src/lib/chronology/types.ts packages/app/src/lib/chronology/engine.ts packages/app/src/lib/chronology/engine.test.ts
git commit -m "feat(app): add provenance fields to Activity items [AI:Codex]"
```

---

## Task 5: [App] Visual Provenance UX (Highlight + Jump)

**Files:**
- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/components/activity/activity-panel.tsx`
- Modify: `packages/app/src/components/activity/activity-stream.tsx`
- Modify: `packages/app/src/components/activity/activity-card.tsx`

**Step 1: Add provenance state to Session page**

In `pages/session.tsx`:
- Add a signal/store for `provenanceMessageId` (string | undefined).
- On each message wrapper (the `div` that already has `data-message-id`), add:
  - `onMouseEnter` / `onMouseLeave` → set/clear `provenanceMessageId`
  - `onFocusIn` / `onFocusOut` for keyboard
- When `provenanceMessageId === message.id`, apply a subtle highlight (border/outline/backdrop) that is consistent with the token system.

**Step 2: Wire ActivityPanel callbacks**

Update `ActivityPanel`/`ActivityStream`/`ActivityCard` props so the dialog can:
- highlight ActivityCards that match the hovered message
- highlight the hovered message when hovering ActivityCards
- jump to message from an ActivityCard action

Suggested props:
- `highlightMessageId?: () => string | undefined`
- `onHighlightMessageId?: (id: string | undefined) => void`
- `onJumpToMessageId?: (id: string) => void`

In `openActivity()` (Session page), pass:
- `highlightMessageId={() => provenanceMessageId()}`
- `onHighlightMessageId={setProvenanceMessageId}`
- `onJumpToMessageId={(id) => { /* close dialog + scrollToMessage */ }}`

**Step 3: Implement ActivityCard interactions**

In `activity-card.tsx`:
- On hover/focus of a card, call `onHighlightMessageId(item.messageId)` (if present)
- On leave/blur, clear highlight (only if currently highlighted to avoid fighting message hover)
- Add a small “Jump” affordance when `item.messageId` exists:
  - Click should `dialog.close()` and then call `onJumpToMessageId(item.messageId)`

**Step 4: Manual acceptance checks**

1) Open a session, ask: “Analyze package.json”.
2) Open Activity dialog and hover a “Tool: …” card → corresponding message block highlights.
3) Hover the message block → corresponding Activity items highlight.
4) Click “Jump” on an Activity card → Activity dialog closes and scrolls to the message.

**Step 5: Commit**

```bash
git add packages/app/src/pages/session.tsx packages/app/src/components/activity/activity-panel.tsx packages/app/src/components/activity/activity-stream.tsx packages/app/src/components/activity/activity-card.tsx
git commit -m "feat(app): add message ↔ activity provenance highlight + jump [AI:Codex]"
```

---

## Task 6: Verification (Evidence Before Claims)

Run:

```bash
cd packages/opencode
BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test

cd ../app
BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck

# optional if present
BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test
```

Expected: all PASS.

---

## Integration (Finishing the Branch)

When implementation and verification are complete, use `superpowers:finishing-a-development-branch` and present the 4 options.

**Important project constraint:** Do **not** remove worktrees/branches unless explicitly requested (worktrees are intentionally preserved until the broader phase is fully validated).

