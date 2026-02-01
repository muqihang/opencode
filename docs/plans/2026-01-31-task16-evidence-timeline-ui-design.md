# Design Plan V2: Narrative Evidence Timeline ("The World-Class Pivot")

## 1. Vision & Critique
**The Shift:** Move from a "Log Viewer" (Engineering View) to a "Narrative Stream" (Product View).
**Core Concept:** "Evidence as a Story." The user shouldn't just see *what* happened; they should feel the *flow* of the agent's work.
**Aesthetic:** "Glass, Pulse, and Thread." High-density information presented with breathing room, subtle backdrops, and connecting threads that imply causality.

## 2. Information Architecture: The "Three-Depth" Model

We abandon the simple "List vs. Modal" dichotomy for a 3-level depth model:

### Level 1: The "Pulse" (Inline Context)
*   **Location:** Inside `SessionTurn`, sandwiched between User and Assistant messages.
*   **Visual:** A **Compact Pill** (Capsule).
    *   *Running:* `[ 🔵 Thinking... (Running bash) ]` (Pulsing animation).
    *   *Done:* `[ ✅ Analyzed 4 files & ran tests ]` (Natural language summary).
*   **Interaction:**
    *   **Hover:** Shows a "Mini-Tooltip" with the last 3 actions.
    *   **Click:** Expands to **Level 2**.

### Level 2: The "Stream" (Expanded Inline)
*   **Visual:** An **Accordion** expansion within the chat stream.
*   **Layout:** A **Connected Timeline**.
    *   A vertical line (Thread) connects nodes.
    *   **Nodes:**
        *   `Tool Call`: A solid block containing command + output snippet.
        *   `File Read`: A lightweight row.
        *   `Insight`: A highlighted text block.
*   **Artifacts:** Rendered as **Mini Cards** (e.g., a file card with icon, name, and size), not just links.

### Level 3: The "Deep Dive" (Dedicated Activity Panel)
*   **Location:** Right Sidebar (New "Activity" Tab).
*   **Purpose:** Audit & Debug.
*   **Features:**
    *   Full raw JSON inspection.
    *   Filter by Trace ID / Span ID.
    *   "Time Travel" (scrubbing through the session reconstruction).

## 3. Visual Design Specifications (Tailwind + `@opencode-ai/ui`)

### 3.1 The "Stream" Item (Component: `TimelineNode`)

**Structure:**
```tsx
<div class="relative pl-6 border-l border-border-weak">
  {/* The Connector Node */}
  <div class="absolute -left-[5px] top-1 size-2.5 rounded-full bg-surface-stronger border-2 border-background-base" />
  
  {/* The Content Card */}
  <div class="group flex flex-col gap-2 p-3 rounded-lg hover:bg-surface-base transition-colors duration-200">
    {/* Header */}
    <div class="flex items-center gap-2">
      <Icon name="terminal" class="text-icon-secondary size-4" />
      <span class="text-sm font-medium text-text-base">Run: bash</span>
      <span class="ml-auto text-xs text-text-weak font-mono">2.3s</span>
    </div>

    {/* Body (Collapsible) */}
    <div class="pl-6 text-xs font-mono text-text-secondary overflow-hidden">
      <div class="bg-surface-stronger p-2 rounded border border-border-weak">
        $ npm test
        > passed
      </div>
    </div>
  </div>
</div>
```

**Color Semantics:**
*   **Tool (Execution):** `text-purple-500` / `bg-purple-500/10`
*   **Network (Routing):** `text-blue-500` / `bg-blue-500/10`
*   **File (IO):** `text-amber-500` / `bg-amber-500/10`
*   **Success:** `text-green-500`
*   **Error:** `text-red-500`

### 3.2 Artifact Cards (Component: `EvidenceCard`)
Instead of `[Link]`, render:
```tsx
<div class="flex items-center gap-3 p-2 rounded border border-border-base bg-background-base">
  <FileIcon type="json" />
  <div class="flex flex-col">
    <span class="text-sm font-medium">package.json</span>
    <span class="text-xs text-text-weak">1.2kb • Modified</span>
  </div>
  <IconButton icon="download" variant="ghost" />
</div>
```

### 3.3 Animation (Micro-interactions)
*   **Entry:** `animate-in fade-in slide-in-from-top-2` (Standard Tailwind).
*   **Pulse:** Use `animate-pulse` on the "Thinking" indicator dot.
*   **Expansion:** Use `grid-rows-[0fr] -> grid-rows-[1fr]` CSS transition technique for smooth accordion height.

## 4. TUI Design: "The Terminal Power User"

**Philosophy:** "Data Density & Keyboard Speed."

*   **Tree View:** Use indentation to show the call stack.
    ```text
    ▼ [Routing] Expert: Frontend 
      ▼ [Tool] bash: ls -la
          [Output] (12 files)
      ▶ [Tool] read: package.json
    ```
*   **Glyphs:** Use Nerd Fonts if available, fallback to high-fidelity Unicode (`◉`, `◎`, `◯`, `➜`).
*   **Spinner:** A smooth braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) for running actions.

## 5. Event Mapping & Grouping Logic

**The "Span" Concept:**
We must synthesize raw events into "Spans" for the UI.

| Raw Events | Synthesized UI Node | Visual |
| :--- | :--- | :--- |
| `tool.started` + `tool.completed` | **ToolExecution** | Card with Command (Header) + Output (Body) |
| `file.read` | **FileAccess** | Row with Filename + Icon |
| `routing.started` | **DecisionPoint** | Node with Model Name + Reasoning |
| `doc.ocr` | **ProcessingJob** | Progress Bar (if incomplete) -> Summary |

**Grouping Strategy:**
1.  **Buffer:** When `tool.started` arrives, create a "Pending Node".
2.  **Update:** When `tool.completed` matches the `actor` or `spanId`, update the "Pending Node" to "Completed" and fill in the duration/status.

## 6. Implementation Plan (Revised)

### Phase 1: The Core (Data & Models)
*   **Writer:** Ensure `events.jsonl` is robust (already done).
*   **Reader:** Implement `useEvidenceStream(sessionId)` hook in App.
    *   *Polling:* Poll `.opencode/evidence/.../events.jsonl` every 1s or use a WebSocket if available (start with polling for simplicity).
    *   *Synthesizer:* A pure function `eventsToSpans(events[])` that groups start/end pairs.

### Phase 2: The "Pulse" (Inline UI)
*   Modify `SessionTurn.tsx`:
    *   Insert `<EvidencePulse />` component.
    *   Implement the "Hover Summary" logic.

### Phase 3: The "Stream" (Expanded UI)
*   Build `<Timeline />` component using the "Thread" visual design.
*   Implement `<EvidenceCard />` for file artifacts.

### Phase 4: TUI
*   Implement `DialogActivity` using `OpenTUI`'s list/tree capabilities.

## 7. Tech Stack Upgrade?
*   **Current:** SolidJS + Tailwind is sufficient.
*   **Recommendation:** No major upgrades needed.
*   **Minor Add:** If `clsx` or `tailwind-merge` isn't present, add it for cleaner class composition in the complex Timeline components. (Check: `remeda` is present, can function similarly, but `tailwind-merge` is safer for conflict resolution).

## 8. Development Handoff
*   **New File:** `packages/app/src/components/timeline/timeline.tsx`
*   **New File:** `packages/app/src/components/timeline/evidence-card.tsx`
*   **New Hook:** `packages/app/src/hooks/use-evidence.ts`

**Final Check:** This design moves beyond "displaying logs" to "telling the story of execution," fitting the "World-Class" requirement by focusing on narrative flow, visual hierarchy, and polished micro-interactions.