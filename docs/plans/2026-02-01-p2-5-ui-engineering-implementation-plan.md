# P2.5-UI工程（会话执行可视化，产品叙事版）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 在 App/TUI 中把“同一会话内的沙盒执行过程”做成 **GPT 风格：执行时自动出现、完成后自动折叠** 的中文人话时间线，并补齐 **子任务/子会话同 tab 切换** 与 **oh-my 后台任务完成卡片** 的产品体验，同时保留审计视图（raw events）。

**Architecture (high-level):**
- **Data:** 以 Server evidence API (`session.evidenceEvents`) 为事实来源，按 `data.messageId` 做 turn 级绑定；以 `session.children`/sync session list 做子会话视图数据源。
- **Logic:** 升级 `ChronologyEngine` 为“产品叙事版”：Span 合成（tool/routing）、降噪（policy/sandbox）、提取 pointers，并产出适合 i18n 的语义结构。
- **UI (App):** 每个 `SessionTurn` 注入 `Turn Live Capsule + Expandable Timeline`；Session header 增加“子任务”入口；Activity 仍保留但默认显示人话视图并可切换审计。
- **UI (TUI):** `/activity` 文案与分类中文化，并引入基础“人话映射”（不追求与 App 完全一致，但要 PM 可读）。
- **oh-my:** 不修改其 agent 协作语义；在 UI 层识别 `<system-reminder>` 的后台任务通知并卡片化（中文展示 + 行为按钮 + 可导航到子会话）。

**Product UX Constraints (must meet):**
- **Capsule placement:** Live Capsule 必须固定在 **User Message 之后**（Void Between Turns），避免跟随 assistant 输出导致位置跳动。
- **Visual throttling:** Live Capsule 的“主状态文案”更新必须稳态（建议 800–1200ms 最短停留），仅在 `failed/needs_attention` 或 `running→done` 等“大状态跳变”时允许立刻更新。
- **Failure is blocking:** 若 turn 内出现 `failed/needs_attention`，默认 **自动展开** timeline（不要让错误被折叠掩盖）。
- **Audit is lazy:** raw JSON/审计详情必须懒渲染（用户打开 Inspect 才渲染），避免 DOM/内存爆炸。
- **No empty chrome:** 没有任何 activity 时，turn 内不出现 capsule（纯聊天不需要“无活动”条）。
- **Subtasks visible:** 父会话有运行中的子会话时，turn capsule/summary 必须能反映 “并行子任务 ×N”（至少 session 级）。

**Tech Stack:** SolidJS, Tailwind, Bun, Zod, OpenTUI (TUI), OpenAPI SDK v2 (`@opencode-ai/sdk/v2`).

**Hard Rules / Safety:**
- 任何不确定的框架/API 用法（SolidJS reactivity、Dialog/Popover、OpenTUI 组件、Tailwind token 等）必须使用 Context7 MCP 查询官方文档再落地（避免“凭记忆写错”）。
- 避免 Playwright e2e（在该环境可能因 CPU 信息报错）；App 验证以 `bun run typecheck` + `bun test src` 为准。
- 不清理 worktree、不 rebase、不 reset；如必须删除文件，先征求用户确认（高风险操作）。

**Localization (where to edit):**
- App i18n: `packages/app/src/i18n/en.ts`, `packages/app/src/i18n/zh.ts`, `packages/app/src/i18n/zht.ts`（必要时同步其它语言先做英文占位）
- UI i18n（给 `@opencode-ai/ui` 组件用）：`packages/ui/src/i18n/en.ts`, `packages/ui/src/i18n/zh.ts`, `packages/ui/src/i18n/zht.ts`

---

## Task 0: Create isolated worktree + baseline verification

**Files:** (none)

**Step 1: Create worktree**
- Create worktree: `.worktrees/p2-5-ui`
- Branch: `p2-5-ui` (from `feature/opencode-custom`)

**Step 2: Install deps**
Run (repo root):  
`BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun install`

**Step 3: Run baselines**
Run:
- `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
- `cd ../app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck`
- `cd ../app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src`

Expected: PASS.

**Step 4: Commit**
No commit (baseline).

---

## Task 1: Upgrade Chronology engine to “narrative-ready” (routing span + noise control)

**Files:**
- Modify: `packages/app/src/lib/chronology/engine.ts`
- Modify: `packages/app/src/lib/chronology/types.ts`
- Modify: `packages/app/src/lib/chronology/engine.test.ts`

**Intent:** 当前 `synthesize()` 把很多事件落到 `other`，且 `routing.started/completed` 不能合成导致 0ms；需要让引擎产出更稳定的 `ActivityItem` 语义，UI 才能“人话化”。

**Step 1: Write failing tests (RED)**
Add tests in `packages/app/src/lib/chronology/engine.test.ts`:

1) `routing.started` + `routing.completed` 合成 1 条 `category: "routing"`，status done，duration > 0（按 ts）。

2) `sandbox.backend_selected` / `policy.exec_evaluated` 默认仍被产出，但应标记为 `category: "other"` 且可被 UI 过滤（本步先不改类型，仅保证引擎不把它们伪装成 tool/routing）。

3) 重要的“工程里程碑”事件（即使不是 tool/doc）不应被当作噪音吞掉：例如
   - `worktree.merge_*`
   - `evidence.*`
   - `gate.*`
   这类事件仍可以先归入 `other`，但必须保证：
   - item 的 `summary` 保留（redacted）
   - UI 层能识别并把它们作为“用户可见”的系统动作展示（见 Task 5 的过滤策略）

Example scaffold:
```ts
test("groups routing.started + routing.completed into one routing activity", () => {
  const events: EventV1[] = [
    { specVersion:"event/1.0", ts:"2026-02-01T00:00:00.000Z", sessionId:"ses", severity:"info",
      actor:"routing", type:"routing.started", summary:"routing started", redaction:{applied:true, policyVersion:"v1"},
      data:{ messageId:"message_1" }, traceId:"t" },
    { specVersion:"event/1.0", ts:"2026-02-01T00:00:01.000Z", sessionId:"ses", severity:"info",
      actor:"routing", type:"routing.completed", summary:"routing completed", redaction:{applied:true, policyVersion:"v1"},
      data:{ messageId:"message_1" }, traceId:"t" },
  ]
  const items = synthesize(events)
  expect(items).toHaveLength(1)
  expect(items[0]?.category).toBe("routing")
  expect(items[0]?.status).toBe("done")
  expect(items[0]?.tsStart).toBe(events[0]!.ts)
  expect(items[0]?.tsEnd).toBe(events[1]!.ts)
})
```

**Step 2: Run tests to verify fail**
Run: `cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src/lib/chronology/engine.test.ts`  
Expected: FAIL（routing 未合成）。

**Step 3: Minimal implementation (GREEN)**
In `packages/app/src/lib/chronology/engine.ts`:
- 为 routing 引入与 tool 类似的“open span queue”：
  - `routing.started` 入队（key 推荐：`${traceId ?? "no-trace"}:routing`）
  - `routing.completed` 出队合成 item
- 合成后的 item：
  - `category: "routing"`
  - `title` 先用中性英文占位也可（最终会被 UI 人话层覆盖）
  - `summary` 使用 end.summary（或 start.summary+end.summary）
- 修复 `ActivityCategory`：确保 `"routing"` 在实际输出里出现。

**Step 4: Run tests to verify pass**
Same command; Expected: PASS.

**Step 5: Commit**
`git add packages/app/src/lib/chronology/engine.ts packages/app/src/lib/chronology/types.ts packages/app/src/lib/chronology/engine.test.ts`  
`git commit -m "feat(app): synthesize routing spans for narrative timeline"`

---

## Task 2: Add “turn-scoped” selectors (itemsByMessageId + summaries)

**Files:**
- Modify: `packages/app/src/hooks/use-activity.ts`
- (Optional) Create: `packages/app/src/lib/chronology/selectors.ts`
- Test: `packages/app/src/lib/chronology/selectors.test.ts` (preferred, pure)

**Goal:** App 需要在每个 turn 内拿到“只属于该 turn 的活动”，并生成折叠摘要（counts + last action + running/attention）。

**Step 1: Write failing tests (RED)**
Create `packages/app/src/lib/chronology/selectors.test.ts` testing:
- `groupByMessageId(items)` 把 items 按 `messageId` 分桶
- `summarizeTurn(items)` 输出 counts：routing/tool/workbench/cache/other，runningCount，failedCount

Keep selectors pure (no Solid). Example:
```ts
expect(summarizeTurn([{category:"tool", status:"done", ...}, {category:"workbench", status:"done", ...}])).toEqual(
  expect.objectContaining({ tool: 1, workbench: 1, running: 0 })
)
```

**Step 2: Run test (should fail)**
Run: `cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src/lib/chronology/selectors.test.ts`

**Step 3: Implement selectors**
Create `selectors.ts` exporting:
- `groupActivitiesByMessageId(items: ActivityItem[]): Map<string, ActivityItem[]>`
- `summarizeTurn(items: ActivityItem[]): { counts...; last?: ActivityItem; status: "idle|running|needs_attention|done" }`
- `formatTurnSummary(t, summary)`（只生成语义数据；最终中文文案在 UI 层完成）
- `shouldUpdateVisualHeadline(prev: { kind: string; status: string }, next: { kind: string; status: string }, elapsedMs: number): boolean`
  - 纯函数，用于 Live Capsule 的“视觉节流”决策（避免频闪）
  - 推荐策略：最短 900ms；但 `failed/needs_attention` 或 `running→done` 立即更新

**Step 4: Run test (PASS)**

**Step 5: Wire into `useActivity`**
In `packages/app/src/hooks/use-activity.ts`:
- Expose:
  - `activitiesByMessageId` (memo)
  - `turnSummary(messageId)` helper
  - Keep existing `activities()` for session-wide panel

**Step 6: Commit**
`git add packages/app/src/lib/chronology/selectors.ts packages/app/src/lib/chronology/selectors.test.ts packages/app/src/hooks/use-activity.ts`  
`git commit -m "feat(app): add turn-scoped activity selectors"`

---

## Task 3: Add `SessionTurn` addon slot (required for stable capsule placement)

**Files:**
- Modify: `packages/ui/src/components/session-turn.tsx`

**Goal:** 让 Live Capsule 属于 “Void Between Turns”：固定在 **用户消息之后** 的稳定区域，避免外部拼接导致跳动。

**Step 1: Add optional prop**
In `SessionTurn` props add:
- `renderTurnAddon?: (ctx: { sessionID: string; messageID: string; working: boolean }) => JSX.Element`

**Step 2: Render it in sticky area**
Place it:
- After user message content
- Before the existing trigger button (the one that shows spinner/status/duration)

**Step 3: Keep this task UI-only**
- 此任务只做 `@opencode-ai/ui` 的 slot 能力，不做 App wiring（App wiring 在 Task 4 一次性完成，避免半成品状态）。

**Step 4: Verify (smoke)**
- Ensure layout doesn’t break
- Ensure focus/keyboard navigation still works

**Step 5: Commit**
`git add packages/ui/src/components/session-turn.tsx`  
`git commit -m "feat(ui): add SessionTurn addon slot for per-turn execution timeline"`

---

## Task 4: Implement Turn Live Capsule + inline Timeline (App components)

**Files:**
- Create: `packages/app/src/components/activity/turn-activity.tsx`
- Modify: `packages/app/src/pages/session.tsx`
- (Optional) Modify: `packages/app/src/components/activity/activity-card.tsx` (re-use styles)

**Goal:** 把“执行过程”从右上角弹窗，升级为 **每条用户消息 turn 内联** 的 GPT 风格体验（执行时出现，完成后折叠；失败自动展开）。

**Step 1: Define behavior (acceptance in-code comments is OK)**
必须满足：
- 没有任何活动：不显示 capsule（纯聊天 turn 不出现空条）
- 执行中：显示 capsule（稳定更新，不频闪）
- 执行完成：自动折叠为 1 行摘要（用户可点击展开）
- 执行失败 / 需要介入：自动展开（默认 open），并强可见
- 动作过多：默认只展示前 5 + 后 2，中间折叠（避免信息瀑布）
- Timeline 展开区域必须可滚动（`max-h` + `overflow-y-auto`，建议 `max-h: 40vh`）

**Step 2: Implement `TurnActivity` component**
In `turn-activity.tsx`:
- Props (suggested):
  - `messageId: string`
  - `items: () => ActivityItem[]` (already filtered to this messageId)
  - `summary: () => TurnSummary`
  - `subtasks?: () => { running: number; total: number }` (optional, for “并行子任务 ×N”)
  - `expanded: () => boolean`
  - `setExpanded: (next: boolean) => void`
- UI:
  - Collapsed capsule: 中文人话（不要暴露 raw type），并显示 `并行子任务 ×N`（若有）
  - Expanded timeline: list nodes (can reuse `ActivityCard`, but make it visually lighter than the audit panel)
  - Provide “查看审计”入口（打开 Activity dialog 并定位 messageId）

**Step 3: Implement visual throttling (stable headline)**
- Use `shouldUpdateVisualHeadline(...)` from Task 2:
  - Keep display headline stable for ~900ms
  - Allow immediate update on failed/needs_attention or running→done

**Step 4: Implement auto-expand on failure**
- If summary indicates failed/needs_attention and user hasn’t explicitly collapsed it, force expanded.

**Step 5: Wire into SessionTurn slot**
In `packages/app/src/pages/session.tsx`:
- Add a separate store for activity expansion (do **not** reuse `store.expanded` which controls assistant message visibility):
  - e.g. `store.activityExpanded[messageId]`
- Pass `renderTurnAddon` into `SessionTurn` (Task 3) rendering `<TurnActivity ... />`:
  - Provide items via `activity.activitiesByMessageId.get(message.id) ?? []`
  - Provide summary via `activity.turnSummary(message.id)`
  - Provide subtasks counts from sync data (session-level)

**Step 6: Manual verification**
Run App dev + server，发一条会触发工具/解析的 prompt（例如 sleep + bash）：
- 执行时 capsule 出现并实时更新（至少 running → done）
- 文案稳定（不频闪）
- 完成后折叠；点击可展开
- 失败时自动展开

**Step 7: Commit**
`git add packages/app/src/components/activity/turn-activity.tsx packages/app/src/pages/session.tsx`  
`git commit -m "feat(app): add per-turn live capsule + inline activity timeline"`

---

## Task 5: Productize Activity Panel (Chinese, scroll, inspect) + hide noise by default

**Files:**
- Modify: `packages/app/src/components/activity/activity-stream.tsx`
- Modify: `packages/app/src/components/activity/activity-panel.tsx`
- Modify: `packages/app/src/components/activity/activity-card.tsx`
- Modify: `packages/app/src/pages/session.tsx` (dialog title / toggle)
- Modify: `packages/app/src/lib/chronology/engine.ts` (optional: mark noise)

**Goal:** 保留 Activity（工程入口），但默认给“人话视图”，审计视图作为二级入口。

**Step 1: i18n pass (no tests)**
- Replace hard-coded strings: `Now/Recent/No activity yet/Activity/Running/Done/Jump`
- Use `useLanguage()` or `useI18n()` and add keys as needed.

**Step 2: Scroll + details**
- Ensure the panel body is scrollable (`max-h` + `overflow-y-auto`)
- Add per-item “详情”操作：
  - Click card → open Dialog/Drawer showing:
    - 人话摘要
    - pointers（copy）
    - redaction
    - raw event JSON（折叠，且必须懒渲染：只有在 Inspect 打开时才挂载到 DOM）

**Step 3: Noise filtering toggle**
- Default: hide **low-value system noise** unless user toggles “显示系统事件（审计）”
  - Hide by default:
    - `sandbox.*`
    - `policy.*`
  - Keep by default (even if `category: other`):
    - `worktree.*`（合并/写入里程碑）
    - `evidence.*`（证据包/工件产出）
    - `gate.*`（质量门禁/检查）
  - Always show if severity is `warn|error` (regardless of type)

**Step 4: Verify**
- Running/Done items appear
- No “policy.exec_evaluated” in默认视图

**Step 5: Commit**
`git add packages/app/src/components/activity packages/app/src/pages/session.tsx`  
`git commit -m "feat(app): make Activity panel human-readable (zh) + inspect + noise toggle"`

---

## Task 6: Add “子任务/子会话” entry + same-tab navigation (App)

**Files:**
- Modify: `packages/app/src/components/session/session-header.tsx`
- Modify: `packages/app/src/pages/session.tsx`
- (Optional) Create: `packages/app/src/components/session/subtasks-dialog.tsx`

**Step 1: Implement children computation**
Use sync data (preferred, no extra API):
- children = `sync.data.session.filter(s => s.parentID === currentSessionId)`
- status from `sync.data.session_status[child.id]`

**Step 2: Add header button**
- Icon + badge (`runningCount/total`)
- Click opens dialog listing children
- Each row: title + status + “打开”
- “打开” → `navigate` to child session route (same tab)
- If current session is child (`parentID` exists), header shows “返回父会话”按钮

**Step 3: Verify**
- Parent session shows subtasks button when children exist
- Clicking navigates to child session
- Breadcrumb/back works

**Step 4: Commit**
`git add packages/app/src/components/session/session-header.tsx packages/app/src/pages/session.tsx`  
`git commit -m "feat(app): add subtasks entry + same-tab child session navigation"`

---

## Task 7: Render oh-my background-task reminders as a premium Chinese UI card (no behavior break)

**Files:**
- Modify: `packages/ui/src/components/message-part.tsx`
- (Optional) Create: `packages/ui/src/components/system-reminder-background-task.tsx`

**Goal:** 保留 `<system-reminder>` 原文（给 agent 协作），但对用户显示为卡片。

**Step 1: Write parser (pure helper, memoized usage)**
Create a helper file (recommended) to keep parsing out of the render loop:
- Create: `packages/ui/src/components/system-reminder-background-task.tsx`
  - export `parseBackgroundTaskReminder(text: string): Parsed | undefined`
  - keep it pure (no DOM, no Solid)

In `packages/ui/src/components/message-part.tsx`:
- Detect text that includes `<system-reminder>` and `[BACKGROUND TASK ...]` or `[ALL BACKGROUND TASKS COMPLETE]`
- Extract:
  - status (completed/cancelled/all-complete)
  - id
  - description
  - duration
  - remainingCount
  - command `background_output(task_id="...")` if present
  - Important: parsing must be driven by a `createMemo(() => parse(...))` keyed by the final rendered text, not done repeatedly per render tick.

**Step 2: Render card**
Replace the Markdown rendering for that text-part with:
- Title（中文）：后台子任务已完成 / 后台子任务已取消 / 所有后台子任务已完成
- Fields（小字）：ID、耗时、描述、错误（如有）
- Buttons：
  - `复制结果拉取命令`（copy `background_output(...)`）
  - `打开子会话`（如果可定位）
    - Locate child session by searching `data.store.session`:
      - `parentID === currentSessionId`
      - title starts with `Background:` and includes description
    - Navigate via `data.navigateToSession?.(child.id)`
- Secondary: “查看原文（审计）”折叠区显示原始 reminder（只读）

**Step 3: Manual verify**
在装有 oh-my 的环境触发 background task：
- 原来纯文本提醒 → 卡片
- copy 命令可用
- 能打开对应子会话（或至少打开“子任务列表”）

**Step 4: Commit**
`git add packages/ui/src/components/message-part.tsx packages/ui/src/components/system-reminder-background-task.tsx`  
`git commit -m "feat(ui): render background-task system reminders as zh UI cards"`

---

## Task 8: TUI `/activity` 中文化（最小可读升级）

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/dialog-activity.tsx`

**Goal:** 至少让 PM 能看懂（中文/人话），并把抽象字段放进 detail。

**Step 1: Replace hard-coded labels**
- Stage names: Tool/Workbench/Routing/Cache/Other → 中文（执行/文件处理/规划/缓存/其他）
- Detail labels: Type/Actor/Time/Severity/Summary/Redaction/Pointers/Data keys → 中文
- Dialog title: Activity → 活动

**Step 2: Basic narrative mapping**
For list rows:
- Title use `e.summary`（已 redacted）但对 `tool.*` 可前缀 “执行：”
- Description: show a short human hint, not raw type (e.g. `tool.started` → `开始`, `tool.completed` → `完成`)

**Step 3: Verify**
Run TUI locally, open `/activity`, ensure readability.

**Step 4: Commit**
`git add packages/opencode/src/cli/cmd/tui/routes/session/dialog-activity.tsx`  
`git commit -m "feat(tui): localize /activity to zh with readable labels"`

---

## Task 9: Final verification (no e2e)

**Step 1: opencode tests**
`cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

**Step 2: app checks**
- `cd ../app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck`
- `cd ../app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src`

**Step 3: Manual smoke**
- Start server (no password for dev) + app dev
- Run a prompt that triggers tool + sleep + (optional) doc ingestion
- Confirm:
  - turn capsule appears during execution, collapses after
  - timeline expands/collapses and scrolls
  - subtasks entry works
  - background reminder card renders (if oh-my enabled)

Recommended dev commands (manual smoke):
- Start server (opencode repo root):
  - `cd packages/opencode && OPENCODE_SERVER_PASSWORD= opencode serve --hostname 127.0.0.1 --port 4096`
  - If you see auth errors in the browser: ensure password is empty for dev, or update app to support basic auth.
- Start app:
  - `cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run dev`
  - Open `http://localhost:3000/` and set server URL `http://127.0.0.1:4096` in settings if needed.

**Step 4: Commit (if any fixups)**
Only if small fixups were made.

---

## Where Gemini helps (explicit handoff points)

Gemini is best used **after Task 3/4/5 are functionally correct**, for:
- 中文微文案打磨（更商业、更自然、更少工程腔）
- 视觉层级：字重/间距/卡片 hover/边框/对比度
- 动效细节：pulse/entry/expand easing（保持 motion-reduce 可访问性）

Do **not** ask Gemini to restructure data flow or SDK contracts; keep Gemini in the “polish layer”.
