# P2.5-UI工程：会话执行可视化（产品叙事版）设计稿

> 目标：把 P2/P2b 已经打通的“证据链 / 沙盒执行 / 子会话协作”从**工程可用**升级到**产品可读、可感知、可控**。  
> 命名：本阶段统一叫 **P2.5-UI工程**（不再沿用 “Task 16”），但实现会复用/增强既有 Activity/Chronology/TurnTrace 基座。
>
> 关联资料（不修改，只引用）：
> - `docs/plans/2026-01-31-task16-activity-timeline-ui-design-final.md`
> - `docs/plans/2026-01-31-task16-evidence-timeline-ui-design.md`
> - `docs/plans/2026-01-31-task16-evidence-timeline-ui-design-revised.md`
>
> 当前实现基线（已合并进 `feature/opencode-custom`）：
> - Evidence API：`GET /session/:id/evidence/events` + `/manifest`
> - App：Activity Dialog + Chronology engine（v1）+ provenance（traceId/messageId）+ Pulse/Glow/Hues（P2/P3 抛光）
> - TUI：`/activity`（v1）

---

## 0. 背景与问题（为什么必须做 P2.5）

P2/P2b 的工程能力已经具备：
- 同一会话内：沙盒执行、工具、workbench 文档解析、Python 脚本、cache、gate/merge、evidence 持久化。
- 跨会话：主会话 orchestrator → 多个子会话代理并行（OpenCode/oh-my-opencode）。

但当前用户感知仍处于“工程日志视角”，典型痛点：
- UI 展示的事件名过于抽象（`policy.exec_evaluated`、`sandbox.backend_selected`…），非工程用户无法理解。
- Activity 入口偏“调试面板”，不是 GPT Web UI 那种“执行中自然出现、完成后折叠”的主叙事体验。
- App 里缺少“子任务/子会话”的显性入口与可切换能力（TUI 已能切换，App 不可）。
- oh-my 的后台任务完成提醒目前是纯文本 `<system-reminder>`，需要产品级卡片化与中文翻译展示，同时不破坏 agent 协作语义。

**结论**：P2.5 的价值不在“增加更多事件”，而在 **把证据变成叙事**：让产品经理/普通用户也能看懂、相信、介入。

---

## 1. 总目标（Product Goals）

### 1.1 体验目标（像 GPT Web UI，但更可审计）

**每条用户消息（turn）有自己的执行可视化：**
- 执行时：自动出现一条“人话胶囊条”（Live Capsule / Heartbeat）。
- 执行完：自动折叠为一句“已完成摘要”，用户可点开查看过程（Timeline）。
- 默认不打扰聊天主叙事；默认折叠；默认安全（redacted）。

### 1.2 信息目标（人话 + 可追溯 + 可控）

对用户展示：
- “正在做什么 / 做到哪一步 / 是否卡住 / 是否需要我介入”
- “产出了哪些结果 / 指针在哪里”

对工程与 AI（深层）保留：
- 原始 event 类型、actor、redaction 信息、pointers、JSON（Audit View）。

### 1.3 协作目标（两种协作同时可视化）

必须同时覆盖：
1) **同一会话内**的沙盒执行过程（工具、脚本、workbench 派生、cache、gate/merge…）。
2) **跨会话窗口**的协作（主会话 → 子会话代理），App 必须能：
   - 看见正在并行的子任务
   - 跳转/切换到某个子会话（同一个 tab）
   - 在主会话中获得“子任务完成”卡片式提醒（可点击进入）

---

## 2. 设计原则（World-Class Default）

1) **Chat First**：聊天是主叙事，执行过程是“可展开的证据层”。  
2) **Progressive Disclosure**：默认只显示“人话摘要 + 状态 + 关键指针”，细节点击展开。  
3) **Safe by Default**：默认仅使用 redacted summary；原文/大段输出永不默认展示。  
4) **Noise Budget**：系统事件不是价值；默认只展示对用户有意义的动作，其余折叠进“更多（审计）”。  
5) **Causality Visible**：用户能从“这句话”追溯到“由哪个动作产出”（message↔activity 可视映射）。  

---

## 3. 信息架构（IA）：三层深度 + 双入口

### 3.1 深度 L1：Turn Live Capsule（执行时自动出现）

位置：每个 `SessionTurn` 内（用户消息与 assistant 输出之间/附近），只在该 turn 执行期间出现；完成后折叠为 1 行摘要。

展示（中文、人话）示例：
- `正在规划解决方案…`
- `正在执行命令：检查仓库状态…`
- `正在解析附件：PDF 提取文本…`
- `正在并行处理子任务：查资料 / 跑测试 / 改 UI…`
- `可能卡住：正在重试（第 2 次）…`

完成后折叠示例：
- `已完成：规划 · 命令×4 · 附件解析×1 · 子任务×2（查看过程）`

### 3.2 深度 L2：Turn Timeline（点击展开）

在同一个 turn 内展开，不跳页面：
- 按“动作”展示，不按 raw event 展示。
- 支持展开单条动作查看详情（见 L3）。
- 必须可滚动（不会出现“面板无法滑动”）。

### 3.3 深度 L3：Inspect / Audit（深度检查）

对每个动作提供 “审计”入口（Drawer/Popover）：
- 显示：安全字段（title/summary/duration/status）+ 指针（artifact/manifest/path/sha）
- 可选显示：原始 event JSON（折叠、复制为主）
- 强调：redaction 已应用（给用户信任感）

### 3.4 双入口（Session 级）

除了 turn 内联之外，还保留 session 级入口：
- 右上角 `Activity` 可保留，但默认展示“产品视图（人话）”，并提供 “切换到审计视图”。
- 新增 `子任务`（子会话）入口：更显眼但不抢戏，展示数量/状态；点击打开子会话列表（同 tab 跳转）。

---

## 4. 数据与关联（Ground Truth）

### 4.1 evidence 事件来源（事实）

- `.opencode/evidence/<sessionId>/events.jsonl`（通过 server API 读取）
- `EventV1` 字段：`ts/severity/actor/type/summary/redaction/data?/traceId?`

### 4.2 Turn 关联（已具备）

`TurnTraceContext` 已在 prompt loop 中以 **最后一条 user message id** 作为 turn key：
- `data.messageId = <lastUserMessageId>`
- `traceId = traceIdForMessageId(<lastUserMessageId>)`

因此：**可以 turn-scoped 地过滤事件**，实现“一条消息一条过程”。

### 4.3 子会话关联（已具备）

Server 已提供：
- `GET /session/:id/children` → `Session.Info[]`

App 可以基于 parent session 直接拉 children 并导航切换。

---

## 5. 语义合成（Narrative Chronology Engine）

P2.5 的核心不是 UI 组件，而是把 raw event 合成“动作”（ActivityItem）的规则升级为“产品叙事版”：

### 5.1 输出结构（概念）

`NarrativeItem`（面向产品渲染）：
- `turnMessageId`（必填）：用于绑定到某个 turn
- `kind`：`plan | tool | workbench | cache | gate | merge | sandbox | background | other`
- `status`：`running | done | failed | needs_attention`
- `titleZh`：中文动词句（可扫读）
- `summaryZh`：安全摘要（不等同于 raw summary，可重写）
- `durationMs?`
- `pointers[]`：安全指针（artifact/manifest/path/sha）
- `debug`：保留 raw fields（仅审计视图显示）

### 5.2 事件映射（MVP）

必须覆盖并“人话化”：
- `tool.started/completed` → `正在运行工具：bash/rg/...`
- `doc.*` → `正在解析文件：PDF/解压/OCR/DOCX…`
- `file.cache_hit` → `已复用缓存结果（加速）`
- `routing.*` → `正在选择执行方案/模型（规划）`
- `worktree.merge_* / evidence.* / gate.*` → `正在合并结果/检查质量/生成证据包`

默认降噪（归入“更多/审计”）：
- `sandbox.backend_selected`
- `policy.exec_evaluated`
- 其他低价值 info/debug

### 5.3 合成（Span）规则

- `tool.started + tool.completed` 合成一个动作（duration、成功/失败、可重试）
- `routing.started + routing.completed` 合成一个动作（目前 v1 会拆成两条，需要修复）
- `doc.*` 允许合并成“附件处理”分组（同一 turn 内的多步派生可折叠）

---

## 6. App 端：子任务/子会话体验（同 tab）

### 6.1 Session Header：新增“子任务”入口

- 入口比 Activity 更显眼（但不占主视觉）：
  - 形态：icon + badge（进行中/总数）
  - 提示：`子任务 2/3`、`子任务（无）`

### 6.2 子会话列表（Drawer/Panel）

列表项展示：
- 子会话标题（可编辑/可读）
- 状态：运行中 / 已完成 / 失败（若可得）
- 最近更新时间 / 耗时

交互：
- 点击进入子会话（同 tab 导航到子 session id）
- breadcrumb：`父会话 / 子任务 #n`，一键返回

### 6.3 主会话内的子任务汇总（叙事融合）

在 turn capsule / timeline 中合并显示：
- `并行子任务 ×N`
- 子任务完成时，摘要更新（并可点开查看哪个完成）

---

## 7. oh-my 背景任务提醒：从纯文本到“产品卡片”

### 7.1 现状（事实）

oh-my 通过 `client.session.prompt()` 注入 `<system-reminder>…</system-reminder>` 文本（示例：`[BACKGROUND TASK COMPLETED]` / `background_output(task_id="...")`）。

### 7.2 目标

同一条消息/turn 中把它渲染成：
- 中文标题：`后台子任务已完成`
- 信息：描述、耗时、剩余任务数
- 主要按钮：`查看子会话`
- 次按钮：`复制 background_output 命令` / `插入到输入框`
- 保留“查看原文（审计）”入口，避免破坏 agent 协作的原始语义

### 7.3 兼容性策略（必须）

- **不依赖 oh-my**：没装就没有该卡片来源，但 App 仍能通过 `session.children` 查看子会话。
- **装了 oh-my**：该卡片出现，并能更快引导用户查看子会话/收集输出。

> 可选增强（后续）：让 oh-my 在 reminder 中包含 `childSessionId`，以便 UI 卡片精准跳转；不影响现有文本语义。

---

## 8. 国际化（中文优先，英文保底）

本阶段要求默认中文可读（产品经理能看懂）：
- UI 文案（Now/Recent/Running/Done/Jump…）必须 i18n 化
- Activity item 的 title/summary 必须通过“叙事映射层”输出中文
- Audit view 可保留英文 event type（作为技术字段）

Gemini 介入点（推荐）：
- 中文微文案与语气（更“商业化”而不幼稚）
- 信息密度与层级（卡片标题/副标题/标签的字重与长度）

---

## 9. 验收标准（Acceptance）

1) **Turn 级体验成立**：执行时自动出现 capsule，完成后自动折叠；用户能展开看到过程。  
2) **人话可读**：默认视图不出现 `policy.exec_evaluated` 这类抽象事件名；产品经理可扫读理解。  
3) **可追溯**：每条动作至少能复制指针（artifact/manifest/path/sha）。  
4) **子会话可用**：App 能看见子会话列表，能同 tab 切换，能回到父会话。  
5) **后台任务卡片**：oh-my reminder 在 App 中渲染为卡片（中文），可一键复制命令并导航子会话。  
6) **性能**：大量事件下不崩、不抖、可滚动（cursor 增量加载，不一次渲染全量）。  

---

## 10. 范围控制（P2.5 不做什么）

- 不把“审计日志”当默认体验（保留，但隐藏）。  
- 不引入重型动效框架；优先 CSS + 现有 Tailwind/token。  
- 不强行在 v1 做“任意 artifact 原文查看”（先复制指针 + 可选受控查看）。  

