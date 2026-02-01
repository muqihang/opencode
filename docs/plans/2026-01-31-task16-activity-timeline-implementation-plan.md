# Task 16: Activity Timeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Implement a world-class "Activity Feed" (App + TUI) that visualizes the agent's engineering process (tools, docs, cache) without noise, replacing the raw log view with a narrative timeline.

**Architecture:**
1.  **Server:** Exposes read-only Evidence API (`events.jsonl` via cursor, `manifest.json`) to safe-guard file access.
2.  **Logic:** `ChronologyEngine` (Pure TS) synthesizes raw `EventV1` streams into semantic `ActivityItems` (e.g., "Running tests..." instead of "exec:bash").
3.  **UI:** SolidJS (App) and OpenTUI+Solid (TUI) render these items using a "Luminous Matte" aesthetic and "Stream" interaction model.

**Tech Stack:** SolidJS, Tailwind (App), OpenTUI+Solid (TUI), Zod, Bun (Server).

---

### Task 1: [Server] Evidence Reader Logic

**Files:**
- Create: `packages/opencode/src/evidence/reader.ts`
- Test: `packages/opencode/test/evidence/reader.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "@/evidence/writer"
import { EvidenceReader } from "@/evidence/reader"
import { Instance } from "@/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("EvidenceReader", () => {
  test("reads events incrementally via cursor", async () => {
    const sessionId = "test-session-1"
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Write 3 events using EvidenceWriter
        const writer = await EvidenceWriter.open({ sessionId })
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "info",
          actor: "test:writer",
          type: "test.event",
          summary: "first",
          redaction: { applied: true, policyVersion: "v1" },
        })
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "info",
          actor: "test:writer",
          type: "test.event",
          summary: "second",
          redaction: { applied: true, policyVersion: "v1" },
        })
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "info",
          actor: "test:writer",
          type: "test.event",
          summary: "third",
          redaction: { applied: true, policyVersion: "v1" },
        })

        // Read first 2
        const batch1 = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 2 })
        expect(batch1.events).toHaveLength(2)
        expect(batch1.nextCursor).toBeGreaterThan(0)

        // Read rest
        const batch2 = await EvidenceReader.readEvents(sessionId, { cursor: batch1.nextCursor })
        expect(batch2.events).toHaveLength(1)
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**
Run: `bun test packages/opencode/test/evidence/reader.test.ts`

**Step 3: Write minimal implementation**
In `packages/opencode/src/evidence/reader.ts`:
- Implement `readEvents(sessionId: string, opts: { cursor: number, limit?: number })`.
- Use `fs.open` and `read` to handle byte offsets safely.
- Parse line-by-line from the buffer.
- Implement `readManifest(sessionId: string)` returning `EvidenceManifest`.

**Step 4: Run test to verify it passes**

**Step 5: Commit**
`git add packages/opencode/src/evidence/reader.ts packages/opencode/test/evidence/reader.test.ts`
`git commit -m "feat(server): implement EvidenceReader with cursor support"`

---

### Task 2: [Server] Session Evidence Routes

**Files:**
- Modify: `packages/opencode/src/server/routes/session.ts`
- Test: `packages/opencode/test/server/session-evidence.test.ts`

**Step 1: Write the failing test**
Use `server.request()` to test:
Use `Server.App()` like existing server tests:
- `GET /session/:sessionID/evidence/events?cursor=0` -> 200 OK, returns `{ events: [], nextCursor: 0 }`
- `GET /session/:sessionID/evidence/manifest` -> 200 OK

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**
Add routes to `SessionRoutes`:
- `.get("/:sessionID/evidence/events", ...)`: Calls `EvidenceReader.readEvents`.
- `.get("/:sessionID/evidence/manifest", ...)`: Calls `EvidenceReader.readManifest`.
- Use `zod` for query param validation.
- IMPORTANT: define `operationId` values in `describeRoute` so SDK generation produces stable method names.

**Step 4: Run test to verify it passes**

**Step 5: Commit**
`git add packages/opencode/src/server/routes/session.ts`
`git commit -m "feat(server): add session evidence routes"`

---

### Task 3: [SDK] Regenerate Client

**Files:**
- Modify: `packages/sdk/js/src/v2/gen/*` (Auto-generated)
- Run: `packages/sdk/js/script/build.ts`

**Step 1: Check generation**
Run: `cd packages/opencode && bun dev generate` (Verify it produces valid OpenAPI spec with new routes).

**Step 2: Regenerate SDK**
Run: `cd packages/sdk/js && bun script/build.ts`

**Step 3: Verify**
Verify by searching generated output for the new operationIds (exact file name may differ by generator):
- Run: `rg -n "evidence.*events|evidence.*manifest" packages/sdk/js/src/v2/gen -S`

**Step 4: Commit**
`git add packages/sdk/js/src/v2/gen`
`git commit -m "chore(sdk): regenerate v2 client with evidence routes"`

---

### Task 4: [App] Chronology Engine (Logic)

**Files:**
- Create: `packages/app/src/lib/chronology/types.ts`
- Create: `packages/app/src/lib/chronology/engine.ts`
- Test: `packages/app/src/lib/chronology/engine.test.ts`

**Step 1: Write the failing test**
```typescript
import { synthesize } from "./engine"

it("groups tool.started and tool.completed into one activity", () => {
  const events = [
    { type: "tool.started", traceId: "t1", ... },
    { type: "tool.completed", traceId: "t1", ... }
  ]
  const activities = synthesize(events)
  expect(activities).toHaveLength(1)
  expect(activities[0].status).toBe("done")
})
```

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**
- Define `ActivityItem` interface in `types.ts`.
- Implement `synthesize(events: EventV1[]): ActivityItem[]` in `engine.ts`.
- Logic:
    - NOTE: current EventV1 producers may omit `traceId` in v1. Prefer deterministic matching:
      - Pair `tool.started`/`tool.completed` by a per-actor FIFO queue of open tool-runs.
      - Fall back to time window heuristics only when necessary, and document the limitation.
    - Map `tool.*` -> `ToolExecution`.
    - Map `doc.*` -> `WorkbenchActivity`.
    - Map `file.cache_hit` -> `CacheActivity`.
    - Handle "open" activities (started but not completed -> `status: running`).

**Step 4: Run test to verify it passes**

**Step 5: Commit**
`git add packages/app/src/lib/chronology/`
`git commit -m "feat(app): implement ChronologyEngine for event synthesis"`

---

### Task 5: [App] Activity Store & Hook

**Files:**
- Create: `packages/app/src/hooks/use-activity.ts`

**Step 1: Implementation**
- Create a SolidJS store/signal `activities`.
- Implement polling logic (every 1s) calling `sdk.session.evidenceEvents({ cursor })`.
- Append new events to `rawEvents` state.
- Use `createMemo` to run `synthesize(rawEvents)` when data changes.
- Export `activities()` accessor.

**Step 2: Manual Verify**
(Hard to unit test hook without render, can skip unit test if logic is covered in Task 4, verify in UI later).

**Step 3: Commit**
`git add packages/app/src/hooks/use-activity.ts`
`git commit -m "feat(app): add useActivity hook with polling"`

---

### Task 6: [App] UI Components - Chip & Stream

**Files:**
- Create: `packages/app/src/components/activity/activity-chip.tsx`
- Create: `packages/app/src/components/activity/activity-stream.tsx`
- Create: `packages/app/src/components/activity/activity-card.tsx` (The Node)

**Step 1: Implement ActivityCard**
- Props: `item: ActivityItem`.
- Render: Icon + Title + Duration + Status.
- Style: Tailwind "Luminous Matte" (e.g., `bg-surface-base border-t border-white/5`).

**Step 2: Implement ActivityStream**
- Render list of `ActivityCard` grouped by stage (if applicable) or time.
- Add `StickyHeader` for "Now" items (Running/Failed).

**Step 3: Implement ActivityChip**
- Small pill component.
- Shows: "Running: [Task Name]" or "Done (5 items)".
- Pulse animation (CSS).

**Step 4: Commit**
`git add packages/app/src/components/activity/`
`git commit -m "feat(app): add Activity UI components"`

---

### Task 7: [App] Integration - Panel & Header

**Files:**
- Modify: `packages/app/src/components/session/session-header.tsx`
- Modify: `packages/app/src/pages/session.tsx`
- Create: `packages/app/src/components/activity/activity-panel.tsx` (Container)

**Step 1: Modify Header**
- Add "Activity" button (toggle).
- Show Badge if new activities exist.

**Step 2: Add Panel to Layout**
- In `session.tsx`, add collapsible right sidebar (or Dialog for MVP if Panel is too complex to refactor layout).
- *Decision:* Use **Dialog** for v1 safety, as requested in design "B. 备选：Activity Dialog".
- Render `<ActivityStream />` inside Dialog.

**Step 3: Commit**
`git add packages/app/src/components/session/ packages/app/src/pages/`
`git commit -m "feat(app): integrate Activity Dialog into Session page"`

---

### Task 8: [TUI] Activity Command

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (Register command + slash entry)
- Create: `packages/opencode/src/cli/cmd/tui/routes/session/dialog-activity.tsx`

**Step 1: Implement DialogActivity**
- Use OpenTUI+Solid components (see existing `DialogTimeline` / `DialogSelect` patterns).
- Fetch evidence via the server API through the existing SDK client (`useSDK()` in TUI context), not direct filesystem access.
- Render grouped list (Stage Blocks) + enter to inspect pointers/redaction.

**Step 2: Register Command**
- Listen for `/activity` input.
- Open the dialog.

**Step 3: Commit**
`git add packages/opencode/src/cli/cmd/tui/`
`git commit -m "feat(tui): add /activity command and dialog"`

---

### Task 9: [Polish] P2 Enhancements (Optional but Recommended)

**Files:**
- Modify: `packages/app/src/components/activity/activity-chip.tsx`
- Modify: `packages/app/src/components/activity/activity-card.tsx`

**Step 1: Living Pulse**
- Add `animate-pulse-slow` (breathing) for `status === 'running'`.
- Add `animate-pulse-fast` (flicker) for high-frequency updates.

**Step 2: Visual Polish**
- Add `backdrop-blur` to headers.
- Refine border colors for dark mode.

**Step 3: Commit**
`git add packages/app/src/components/activity/activity-chip.tsx packages/app/src/components/activity/activity-card.tsx`
`git commit -m "style(app): apply P2 visual polish (living pulse)"`

---

### Task 10: [P2] Visual Provenance (High-Impact, Requires Reliable Linking)

> NOTE: Do NOT draw causality lines based on timestamps alone; incorrect linkage damages trust.

**Goal:** enable “message ↔ activity” highlighting/jump using a reliable linking key.

**Option A (preferred):** propagate `traceId` end-to-end for a user turn, so UI can attach ActivityItems to the correct turn.
**Option B:** add explicit `turnId/messageId` into event `data` (more invasive).

**Deliverable for P2:** start with bidirectional highlight + jump (Bezier curve is final polish after correctness + performance).

---

## Acceptance Criteria Verification

1.  **Launch App:** Open a session.
2.  **Trigger Action:** Ask agent "Analyze package.json".
3.  **Verify UI:**
    *   Header "Activity" button appears.
    *   Clicking it opens Dialog.
    *   Row appears: "Tool: read_file (package.json)" -> Status: Done.
    *   Running state is visible for active work (e.g. tool.started without tool.completed yet) and shows a pulse.
4.  **Verify TUI:**
    *   Type `/activity`.
    *   See text list of same events.
5.  **Verify Security:**
    *   Inspect network tab. API returns `summary` (redacted), not full file content.