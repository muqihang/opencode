# P2.5 Global UI Review (Session Experience)

## 5 World-Class Bad Experience Points (Sorted by Impact)

1.  **Monolithic Component Structure (`MessagePart.tsx`)**
    -   **Why:** `MessagePart.tsx` handles everything from text rendering, tool registry, tool display logic, permission prompts, to system reminders. It's over 700 lines and mixing concerns. This makes "polishing" one part risky as it might break others.
    -   **Impact:** High maintenance cost, fragility, difficult to A/B test UI changes.

2.  **Inconsistent I18n Strategy**
    -   **Why:** Some components (like `TurnActivity`) use hardcoded Chinese strings, while `MessagePart` uses `useI18n`. Even within `MessagePart`, some tools have hardcoded English or Chinese fallback.
    -   **Impact:** "Mixed language" feel (English headers with Chinese content), impossible to fully localize, unprofessional appearance.

3.  **Primitive Log/Output Rendering**
    -   **Why:** Tool outputs (logs, file lists) are rendered as Markdown. While flexible, it's slow for large outputs and lacks "Log Viewer" features (search, line numbers, sticky scroll). `TruncatedMarkdown` is a band-aid.
    -   **Impact:** Performance bottlenecks on large diffs/logs, poor developer experience when debugging via UI.

4.  **Visual Hierarchy Flattening**
    -   **Why:** Everything is a "card" or a "bubble". Nested tasks, tool calls, and system messages often blend together. The distinction between "Agent thinking", "Tool executing", and "System notifying" is weak (reliant on small icons).
    -   **Impact:** User cognitive load increases; they have to "read" to know what's happening instead of "glancing".

5.  **Interaction Latency/Feedback**
    -   **Why:** We rely on `TEXT_RENDER_THROTTLE_MS` (100ms) to hide rendering cost. Real-time typing feel is compromised for safety. Large updates cause layout shifts.
    -   **Impact:** The app feels "heavy" or "laggy" compared to native terminals or optimized web UIs.

## 5 Minimum Actionable Improvements (P2.6 Candidates)

1.  **Refactor `MessagePart` into Sub-components**
    -   **Change:** Split `ToolPartDisplay`, `TextPartDisplay` (including `SystemReminder`), `ReasoningPartDisplay` into separate files in `packages/ui/src/components/message-parts/`.
    -   **Risk:** Low (refactoring).
    -   **Acceptance:** No visual regression, file size < 200 lines each.

2.  **Standardize `ToolOutput` Component**
    -   **Change:** Promote `TruncatedMarkdown` to a top-level `ToolOutput` component. Add support for "raw mode" (no markdown parsing, just monospace text) for huge logs to improve performance.
    -   **Risk:** Low.
    -   **Acceptance:** `bash`, `grep`, `list` all use this component. Large outputs render instantly.

3.  **Unified I18n Keys for Tools**
    -   **Change:** Extract all tool titles/descriptions in `getToolInfo` to `en.json` / `zh.json`. Ensure no hardcoded strings in `TurnActivity`.
    -   **Risk:** Low.
    -   **Acceptance:** Switching language context changes *all* UI text.

4.  **Enhance `SystemReminder` Visuals**
    -   **Change:** Add specific icons for "Background Task", "Error", "Success". Use a distinct background color (e.g., subtle yellow/blue tint) to separate from standard text messages.
    -   **Risk:** Low (CSS/Style).
    -   **Acceptance:** Users can distinguish a system notification from an AI message at a blur-glance.

5.  **Implement "Smart Scroll" for Active Turns**
    -   **Change:** When a turn is active and printing long output, auto-scroll should be "sticky" but allow user override. Current implementation is basic.
    -   **Risk:** Medium (Scroll interactions are tricky).
    -   **Acceptance:** User scrolls up -> auto-scroll stops. User scrolls to bottom -> auto-scroll resumes.

## Next Stage Naming
**P2.6** (Focus on Component Architecture & Performance)
