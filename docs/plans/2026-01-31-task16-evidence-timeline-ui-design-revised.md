# Design Plan V3: The Semantic Chronology ("Liquid Interface")

> **Designer's Note:** This revision elevates the previous "Narrative Stream" concept to a "World-Class" standard, focusing on fluid motion, semantic grouping, and a "Luminous Matte" visual language that mimics high-end physical instruments.

## 1. Design Philosophy: "Liquid Chronology"

**The Shift:** From "Discrete Events" to "Fluid Context."
**Core Concept:** The user is watching a *thought process*, not a log file. The UI must feel alive, breathing with the agent's cognition.
**Aesthetic:** **"Luminous Matte"**.
*   **Surface:** Avoid cheap transparency. Use deep, matte backgrounds (`bg-surface-base`) with subtle top-borders (`border-t-white/5`) to simulate light catching the edge.
*   **Depth:** Use inner shadows and rim lighting to depress active elements into the surface, making them feel like precision-milled slots.
*   **Typography:** Strict separation.
    *   *Narrative:* System Sans (SF Pro/Inter), tracking tight (-0.01em).
    *   *Data:* System Mono (SF Mono/JetBrains), size reduced (0.9em), opacity lowered until interaction.

## 2. Information Architecture: The "Lens" Model

We replace the "Accordion" with a **"Lens"** model. Focus expands context; lack of focus collapses it to a heartbeat.

### Level 1: The "Heartbeat" (Collapsed State)
*   **Visual:** A single, pill-shaped **"Activity Bar"** spanning the width of the container, but low height (4px -> 24px on hover).
*   **Animation:** A gradient pulse (`animate-pulse-slow`) travels horizontally across the bar when busy.
*   **Content:**
    *   *Idle:* Invisible or a thin hairline separator.
    *   *Active:* `[ ● Processing... ]` (Tiny, 10px text, centered).
*   **Interaction:** Hovering "inflates" the bar into **Level 2**.

### Level 2: The "Semantic Chain" (Timeline View)
*   **Visual:** A vertical spine (The "Neural Thread") connecting discrete "Atoms" (events).
*   **Grouping:** We do not show raw events. We show **"Molecules"** (Logical groupings).
    *   *Scenario:* Agent runs `ls`, then `cat file.ts`, then `grep "foo"`.
    *   *Display:* A single **"Investigation"** block containing 3 atoms.
*   **Layout:**
    *   **Left:** Timestamp & Duration (minimalist, `text-text-tertiary`).
    *   **Center:** The Event Atom (Icon + Summary).
    *   **Right:** Action triggers (Replay, Copy, Inspect).

### Level 3: The "Inspection Crystal" (Detail View)
*   **Interaction:** Clicking an Atom *does not* expand it vertically (shifting layout is jarring).
*   **Action:** It opens a **"Crystal Overlay"** (Popover/Drawer) anchored to the Atom, floating above the content with a backdrop blur (`backdrop-blur-md`).
*   **Purpose:** Deep inspection of large JSON/Logs without breaking the chat flow.

## 3. Visual Specifications (The "Apple" Standard)

### 3.1 The "Atom" Component

**Structure:**
```tsx
<div className="group relative pl-8 pr-4 py-2 transition-all duration-300 hover:bg-surface-hover">
  {/* The Thread (drawn via SVG or border) */}
  <div className="absolute left-4 top-0 bottom-0 w-px bg-border-weak group-last:bottom-1/2" />
  
  {/* The Node Point */}
  <div className="absolute left-[13px] top-3.5 size-1.5 rounded-full bg-border-strong ring-4 ring-background-base transition-colors group-hover:bg-accent-primary" />
  
  {/* Content Container */}
  <div className="flex items-center justify-between gap-3">
    
    {/* Icon & Title */}
    <div className="flex items-center gap-2.5">
      <div className="flex items-center justify-center size-6 rounded bg-surface-strong border border-white/5 shadow-inner">
        <Icon name="terminal" className="size-3 text-icon-secondary" />
      </div>
      <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">
        Execute <span className="font-mono text-xs opacity-75">npm test</span>
      </span>
    </div>

    {/* Metadata (Hidden until hover) */}
    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-2">
      <Badge variant="outline" size="xs">2.4s</Badge>
      <Badge variant="success" size="xs">Passed</Badge>
    </div>
  </div>
</div>
```

**Polishing Details:**
*   **Icons:** Use stroke-width 1.5px. consistent sizing.
*   **Borders:** No full borders. Use `box-shadow` for hairline separation to avoid "grid" look.
*   **Colors:**
    *   *Command:* `slate-400` (Neutral)
    *   *File:* `amber-400/80` (Warm)
    *   *Network:* `sky-400/80` (Cool)
    *   *Error:* `rose-500` (Urgent)

### 3.2 The "Artifact" Chip

Files are precious. Treat them like jewels.

```tsx
<div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-surface-strong border border-white/5 hover:border-accent-primary/30 transition-colors cursor-pointer select-none">
  <FileIcon ext="ts" className="size-3.5" />
  <span className="text-xs font-medium text-text-secondary">utils.ts</span>
  <span className="text-[10px] text-text-quaternary font-mono">4kb</span>
</div>
```

## 4. Motion Design (The "Fluidity")

**Principles:**
1.  **No Teleportation:** Everything comes from somewhere. New events slide in from the bottom `y: 10, opacity: 0`.
2.  **Squish & Stretch:** When the "Heartbeat" expands to "Timeline", use a spring animation (stiffness: 300, damping: 30).
3.  **Stagger:** List items load with a 30ms stagger delay.

**Tech:** `framer-motion` (React) or `Motion One` (Generic). If standard CSS is required: use `transition-all duration-300 ease-[0.23,1,0.32,1]` (Cubic Bezier for "Expo Out").

## 5. Event Synthesis Strategy (The "Brain")

We need a smarter transformer than just grouping start/end.

**The `ChronologyEngine`:**
1.  **Deduplication:** If the agent reads the same file 3 times in 1 second, collapse to `Read "utils.ts" (x3)`.
2.  **Noise Reduction:** Ignore `cd` commands unless they fail.
3.  **Heuristics:**
    *   If `tool.name === "bash"` AND `output` contains "Error", tag as `status: 'failure'`.
    *   If `tool.name === "read_file"`, pre-fetch the content for the "Inspection Crystal".

## 6. Implementation Stages

### Stage 1: The Engine (No UI)
*   Build `ChronologyEngine` class.
*   Input: `Event[]` -> Output: `SemanticGroup[]`.
*   Tests: Feed it raw JSON logs, verify it groups correctly (e.g., "Install Package" group contains `npm install` + `output` + `exit code`).

### Stage 2: The Skeleton (Low Fidelity)
*   Implement `Timeline` component using standard HTML/CSS.
*   Focus on the **Layout Stability** (ensure expanding/collapsing doesn't cause scroll jumps).

### Stage 3: The Polish (High Fidelity)
*   Apply the "Luminous Matte" styling.
*   Implement the custom Icons.
*   Add the "Heartbeat" animation.

### Stage 4: The Magic (Motion)
*   Add entry animations.
*   Add hover states with layout projection.

## 7. Handover Checklist
*   [ ] `ChronologyEngine` unit tests passing.
*   [ ] `Timeline` component isolated in Storybook/Playground.
*   [ ] "Luminous Matte" color tokens added to Tailwind config (if missing).
*   [ ] Icons exported as SVG sprites for performance.

---
*Created by: Gemini (Design Lead)*
