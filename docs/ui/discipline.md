# Axiom UI Engineering Constitution（P3/P4）
> **Status**: Living Document（活文档，随 P3/P4 迭代）  
> **Philosophy**: Magic in the Soul, Physics in the Bone（灵在魂，理在骨）  
> **Scope**: GUI（`packages/app`, `packages/desktop`）& TUI（`packages/opencode`）  
> **Goal**: Guide P3/P4 UI development to align with the "Living Organism" design language while maintaining strict engineering discipline.

---

## 1. The Core Law (Hard Constraints)
> **Non-negotiable engineering baselines.**

1.  **No Hardcoded Values**:
    *   ❌ `color: #050509`, `box-shadow: 0 4px...`, `border-radius: 99px`
    *   ✅ Use existing semantic tokens / vars first:
        *   `bg-background-base`, `bg-surface-base`, `text-text-base`, `border-border-weak-base`, `shadow-xs-border-base`, `rounded-xl`
        *   or `bg-[var(--background-base)]` / `text-[var(--text-base)]` / `border-[var(--border-weak-base)]`
    *   ✅ Future design tokens (e.g. `--bg-void`, `--beam`, `--tick`) are allowed **only after they are defined** via theme overrides (see `IMPLEMENTATION_PLAN.md`).
2.  **Human View vs. Audit View**:
    *   **Human View** (Default): "Product Narrative". Verbs + Objects. No raw JSON, no UUIDs, no timestamps (unless relative).
        *   **Locale rule**: Microcopy must match the user's language (产品默认中文；英文仅作为可选/开发参考).
    *   **Audit View** (Lazy): "Engineering Reality". Raw data, full logs, absolute timestamps. *Must be lazy-loaded.*
3.  **Visual Throttling**:
    *   High-frequency events must be throttled.
    *   **Minimum Duration**: Any "Living" state (Thinking/Processing) must be visible for at least **800ms** to prevent "flash anxiety".
4.  **Failure is Blocking**:
    *   Failed steps must **auto-expand**. Success steps can auto-collapse.
5.  **Performance Red Line**:
    *   **Shared Clock**: Never use `setInterval` inside list items. Use a single global `Signal` for all relative time updates.
    *   **Clean Up**: All timers/animations must dispose on component unmount (HMR safe).
6.  **Accessibility (A11y)**:
    *   **Reduced Motion**: All animations must respect `prefers-reduced-motion` (fallback to fade/static).

---

## 2. Aesthetic Constraints (Visual Vibe)
> **How to make it feel like "Axiom".**

### 2.1 Organic vs. Mechanical
We differentiate between "Intelligence" and "Tooling".
*   **Organic (Magic)**: Used for AI reasoning, routing, and intent understanding.
    *   *Visuals*: Soft gradients, breathing (opacity/glow), fluid transitions.
    *   *Tokens*: `--beam-*`, `--effect-glow`.
*   **Mechanical (Physics)**: Used for tool execution, file operations, and terminal outputs.
    *   *Visuals*: Crisp lines, solid state changes, monospaced data.
    *   *Tokens*: `--tick-*`, `--border-line`.

### 2.2 Texture Strategy (Emission vs. Reflection)
*   **Night Mode (Emission)**:
    *   Backgrounds must sit *behind* the `TextureOverlay` (Fractal Noise, 4% opacity).
    *   Elements rely on **Glow** and **Contrast**.
*   **Day Mode (Reflection)**:
    *   Backgrounds must use the `PaperGrain` overlay (Multiply mode).
    *   Elements rely on **Shadow** and **Borders**.
    *   *Constraint*: Do not invert colors blindly. Day mode shadows should be subtle (`shadow-sm`), not harsh black.

### 2.3 Information Hierarchy
Don't build a "Log Waterfall". Build a "Narrative Stream".
*   **Headline**: 1 per Turn. Large, Human-readable. (e.g., "Analyzing project structure...")
*   **Summary**: The result. (e.g., "Found 3 misconfigured files.")
*   **Artifact**: The proof. (e.g., The file card, the code snippet). *Embedded, not appended.*

---

## 3. Motion Principles (Physics)
> **If it moves, it must have mass.**

### 3.1 Motion Budget
*   **Allowed**:
    *   Micro-indicators (Beam, Tick, Dots).
    *   Layout transitions (Expand/Collapse).
    *   New item entry (Slide up).
*   **Forbidden**:
    *   Full-page background shifts.
    *   Constant large-area blurring (Performance killer).

### 3.2 Curves & Timing
*   **Float Up**: `cubic-bezier(0.16, 1, 0.3, 1)` (600ms). Use for new content entry.
*   **Breathe**: `ease-in-out` (2-3s). Use for "Thinking" states.
*   **Snap**: Spring Physics (`stiffness: 400, damping: 25`). Use for "Done" states.

### 3.3 Future Sprint: Micro-Interactions (Placeholder)
*P3/P4 implementation note: Reserve architectural space for these (design target), but do **not** let them block feature delivery.*
*   **Neuro-Link Jitter**: Triggered by token stream signals.
*   **Liquid Morph**: Layout projection from Beam to Card.
*   **Haptic Ripple**: Visual feedback on task completion.

---

## 4. Microcopy System (The Voice)
> **Speak like an Architect, not a Debugger.**

### 4.1 Verb Structure
*   ✅ **Verb + Object + Context**
    *   中文（默认）：`正在分析 src/ 下的 3 个文件…` / `正在重构 auth.ts…`
    *   English（可选）："Analyzing 3 files in `src/`..." / "Refactoring `auth.ts`..."
*   ❌ **Engineering Jargon**
    *   "Running tool: file_search..."
    *   "Step 1 completed."

### 4.2 Anxiety Management
*   **0-2s**: `正在思考…`（即时反馈）
*   **2-8s**: `正在分析依赖关系…`（给出具体对象）
*   **>8s**: `耗时较长，但仍在处理中…`（安抚 + 不制造焦虑）

### 4.3 The "Confirmation" Beat
*   When a long task finishes, **pause for 1-2s** showing the "Success" state (Tick) before collapsing or moving on. Let the user feel the "Snap".

---

## 5. Do's & Don'ts (Implementation Examples)

| Feature | ❌ Engineering Style (Don't) | ✅ Product Style (Do) |
| :--- | :--- | :--- |
| **Tool Execution** | Show raw JSON: `{"tool": "read", "args": "..."}` | Show Narrative Card: "Reading `package.json`..." |
| **Success State** | Text: "Exit Code: 0" | Visual: Blue Tick + `已完成`（仅失败显示 exit code） |
| **Timestamps** | `2026-02-01T10:00:00Z` | `Just now` or `2s ago` (Hover for absolute) |
| **File Paths** | `/Users/admin/project/src/index.ts` | `~/project/.../src/index.ts` (Smart truncate) |
| **Error Logs** | Dump full stack trace to main view | Summary: "Connection failed" + [View Logs] button |
| **Loading** | Spastic spinner (100ms loop) | Slow, rhythmic Pulse Beam (2-3s loop) |

---

## 6. PR Self-Check (Copy-Paste this)

Before submitting your UI PR, verify:

```markdown
- [ ] **Token Check**: No hardcoded colors/shadows? (Used `var(--bg-void)`, etc.)
- [ ] **Motion Safety**: Did I test with `prefers-reduced-motion` enabled?
- [ ] **Narrative**: Does the UI read like human language (中文优先), not JSON?
- [ ] **Throttle**: Do loading states last at least 800ms?
- [ ] **Theme**: Did I verify both Light and Dark modes?
```
