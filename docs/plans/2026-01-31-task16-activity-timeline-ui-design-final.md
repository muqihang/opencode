# Task 16 Design (Final): World‑Class, Shippable Activity Timeline (App + TUI)

> 本文档是对三份输入方案的“融合升华版”，目标是 **世界级体验 + 可落地交付**。  
> 输入方案来源：
> - UI v2：`docs/plans/2026-01-31-task16-evidence-timeline-ui-design.md`
> - UI v3：`docs/plans/2026-01-31-task16-evidence-timeline-ui-design-revised.md`
> - GPT：`docs/plans/2026-01-31-task16-activity-timeline-ui-design-gpt.md`
>
> 重要说明：本方案 **产品化命名统一使用 Activity**（工程层仍叫 evidence），默认不泄露敏感内容。

---

## 1. Vision（愿景）

把“后台工程行为”从不可见变成可感知的 **Activity Feed（活动流）**，让用户获得类似 GPT Web UI 的直观感：

- 用户知道：系统 **正在做什么**、**做到哪一步**、**是否卡住**、**是否需要我介入**。
- 用户能追溯：每个活动都能落到 evidence 的指针（artifact/manifest），而不是“信任我”。
- 用户不被打扰：默认折叠、默认降噪，聊天仍是主叙事。

---

## 2. Ground Truth（基于事实的输入）

### 2.1 Evidence 数据存在且稳定
Evidence 事件写入：
- `.opencode/evidence/<sessionId>/events.jsonl`（JSONL）
- `.opencode/evidence/<sessionId>/manifest.json`（工件索引）

事件 schema（安全渲染友好）：
- `packages/opencode/src/protocol/event.ts`：`EventV1` 强调 `summary` 已 redacted，可用于 UI timeline。

### 2.2 已存在的高价值事件类型（MVP 可立即展示）
已确认至少包括（示例）：
- `tool.started` / `tool.completed`
- `doc.*`（PDF/解压/OCR/DOCX 等工作台派生）
- `routing.started`
- `file.cache_hit`
- `policy.exec_evaluated` 等（可折叠为“More…”）

---

## 3. 三份方案的取舍（采纳精华，避免“美但不可交付”）

### 3.1 我们保留的“世界级”设计精华
来自 UI v2/v3：
- **三层深度模型**（v2 的 Pulse/Stream/Deep Dive）：折叠提示 → 展开 timeline → 深度检查。
- **Thread + Node 的时间线视觉语言**：垂直 spine + 节点卡片（v2 的 TimelineNode、v3 的 Atom）。
- **Artifact 组件化（Chip/Card）**：工件不是“链接”，而是可复制/可定位的“物件”（v2/v3）。
- **微交互原则**：Running 的轻脉冲、新事件淡入、hover 强化层级（v2/v3）。
- **语义合成（Semantic Grouping）**：把“离散事件”合成用户能理解的“动作”（v3 的 Molecule/Engine 思路）。

来自 GPT 方案：
- **产品信息架构**：App “Activity Panel + Inline Chip 联动”、TUI “/activity”。
- **默认安全 + 默认降噪**：只展示 redacted summary + 指针；debug 事件折叠。
- **可落地的数据管线**：建议服务端提供 evidence read API（cursor 增量）。
- **MVP 切割与验收标准**：先保证 tool/doc/cache 三类可用，再逐步升级。

### 3.2 我们明确不采纳/需要改造的点
为保证可落地与一致性，本方案做如下调整：
- **不以 hover 作为核心入口**：hover 在触屏/键盘场景不可用。核心交互必须 click/keyboard 可达。
- **不引入 React 专用动效方案**：UI v3 提到的 framer-motion（React）不直接采纳；v1 先用 CSS 过渡与小动效实现“高级感”。
- **不默认预取/展示原始输出内容**：UI v3 建议 pre-fetch logs/file content，这与“默认安全”冲突。v1 只给指针，用户显式操作才看更多（且需要提示/策略）。

---

## 4. 最终交互模型（Final UX Model）

我们统一为 **“3 深度 + 2 入口”**：

### 4.1 深度 1：Inline Activity Chip（默认折叠）
**目的**：像 GPT 一样让用户“知道系统在忙”，但不污染聊天流。

形态：
- 一条极克制的胶囊条（Chip），位于聊天流内（可 sticky 在底部或出现在最新消息附近）。
- 显示：状态（Working / Done / Needs attention）+ last action + duration/relative time + 数量。

点击行为：
- 打开 Activity Panel（或 Activity Dialog）并定位到对应时间段/分组。

> 重要：v1 的 Inline Chip 可以先做“Session‑scoped”（整个 session 最近活动），不强行绑定到某一条消息 turn；后续再做 turn 级关联（见 §9）。

### 4.2 深度 2：Activity Stream（可扫读的时间线）
**目的**：用户能快速扫读“做了哪些动作、每步耗时、成功/失败、产出了哪些证据指针”。

形态：
- 垂直 Thread（spine）+ Node 卡片
- 默认按 **Stage Blocks** 分组折叠（Tool / Workbench / Routing / Merge+Gate / Cache）
- 顶部有 **Now** 区域（置顶）：
  - Running / Failed / Needs approval 0–3 条
  - 任何需要用户介入的事件必须出现在这里

### 4.3 深度 3：Inspect（深度检查）
**目的**：不破坏聊天滚动稳定性地查看细节（UI v3 的 “no layout shift” 思路）。

原则：
- 点击 Node 不在列表里做大幅高度扩展（避免滚动跳动）。
- 以右侧详情面板 / popover / dialog 打开详情（选择哪种由实现约束决定）。

详情内容固定四段（可预期、可扫读）：
1) Summary（产品化描述 + 状态）
2) Pointers（artifact path / manifest key / sha256，可复制）
3) Data（安全子集）
4) Redaction（`applied` + `policyVersion`）

---

## 5. App 设计（SolidJS + Tailwind，商业化）

### 5.1 入口（Entry）
- Session Header 增加 `Activity` 按钮
  - 新事件 badge（点/数字）
  - 阻塞态变体（Needs attention）
- 聊天流内渲染 Inline Activity Chip（默认折叠）

### 5.2 展示形态（Panel vs Dialog）
本方案允许两种实现落地方式，按工程成本选择：

**A. 推荐：右侧 Activity Panel（更像工作台/更商业）**
- 视觉上与 review/terminal 等工作区并列
- 可长期打开，适合“边聊边看活动”

**B. 备选：Activity Dialog（更快落地）**
- 复用现有 Dialog 系统
- inline chip / header button 都打开 dialog

> 无论 A 或 B，内容结构一致（Now + Stage Blocks + Inspect）。

### 5.3 视觉语言（“Luminous Matte” 的可落地版本）
目标：高级、克制、信息密度可控。

- Surface：深浅分层，避免廉价透明（v3 的“matte”原则）
- 分隔：hairline（极细边）+ subtle shadow，避免“格子感”
- 状态色：只用于小面积（左侧 2px 竖条 + status pill）
- 动效：
  - Running：小圆点轻 pulse
  - 新事件：fade-in + 1–2 秒轻高亮淡出
  - 展开/关闭：150–200ms easing

---

## 6. TUI 设计（OpenTUI，密度与速度）

### 6.1 新命令
- 新增 `/activity`（产品化命名）
- 保留 `/timeline`（现有“跳转到消息”）

### 6.2 列表/树视图
默认按 Stage 分组折叠：
- Tool
- Workbench
- Routing
- Merge+Gate
- Cache

行格式（概念示例）：
```text
[RUN] Tool      rg                tool started
[ OK] Workbench PDF               extracted text (2.3s)
[WARN] Cache     file.cache_hit    reused derived outputs
```

### 6.3 详情查看
Enter 打开详情对话框（Summary / Pointers / Data / Redaction），支持复制指针。

---

## 7. 语义合成引擎（Chronology Engine：让“事件”变成“动作”）

核心思想：UI 绝不直接裸渲染事件列表；必须通过一个纯函数把事件转成 ActivityItem（动作）。

### 7.1 输入输出
- Input：`EventV1[]`（按 ts 排序）
- Output：`ActivityItem[]`（已分组/已降噪/可渲染）

`ActivityItem`（概念字段）：
- `id`
- `tsStart` / `tsEnd?`
- `category`（Tool/Workbench/Routing/Cache/…）
- `status`（running/done/failed/needs_attention）
- `title`（产品化动词句）
- `summary`（安全摘要）
- `pointers[]`（artifact path / manifest key / sha）
- `children[]`（可选：把多个原子事件合成一个分子）

### 7.2 MVP 合成规则（必须）
- `tool.started` + `tool.completed` → 1 个 ToolExecution item（填 duration/status）
- `doc.*` → 直接映射到 Workbench item（title 统一产品化）
- `file.cache_hit` → Cache item

### 7.3 v1.5+ 降噪/去重（可选增强）
- “短时间重复读同一文件/同一动作” → collapse 成 `x3`
- debug/info 事件默认归入 “More…”

---

## 8. 数据管线（必须可落地：不要让 App/TUI 直接读磁盘）

UI v2 提到 polling `.opencode/.../events.jsonl` 的想法在“浏览器环境”不成立；最终方案必须通过服务端 API 提供读取能力。

### 8.1 建议 API（Read‑only）
1) `GET /session/:id/evidence/events?cursor=<byteOffset>`
   - 返回：`{ events: EventV1[], nextCursor: number }`
   - 用 cursor 做增量拉取，避免每次全量读 JSONL

2) `GET /session/:id/evidence/manifest`
   - 用于 pointers 与 artifact 列表

3) （可选）`GET /session/:id/evidence/stream`（SSE/stream）
   - 让 Activity 更“实时”，但 v1 可先轮询 + cursor

### 8.2 安全边界
- v1 不提供“任意文件读取”的 evidence API
- 只读 events/manifest（结构本身已设计为可安全展示）
- artifact 查看后续单独设计白名单 + 风险提示

---

## 9. Inline 与 Turn 关联（如何从“Session‑scoped”升级到“Turn‑scoped”）

### 9.1 v1（可落地）
Inline Chip 先做 session 维度：展示“最近活动与状态”，不强行绑定消息。

### 9.2 v2（更像 GPT Web UI）
引入关联字段（二选一）：
- 在事件 data 里补充 `traceId`/`spanId` 的系统化注入，并在每个用户 turn 开始生成 traceId；工具/派生/路由复用同一 traceId。
- 或在事件 data 里显式写入 `turnId/messageId`（成本更高，需要贯穿调用链）。

完成后即可把 Activity Stream 插入到每个 Turn 中（UI v2 的 Pulse/Stream 模型即可原样落地）。

---

## 10. MVP 范围（v1 必交付）

### 10.1 App v1
- Activity 入口（header button）
- Inline Activity Chip（默认折叠，联动打开）
- Activity Stream（Now + Stage Blocks）
- Inspect（查看 event JSON + pointers + redaction）
- Filter（severity/category）+ Search（summary/type/actor）

### 10.2 TUI v1
- `/activity` dialog
- Stage 分组折叠
- Inspect（summary + pointers）

---

## 11. 验收标准（Acceptance Criteria）

1) 用户能看到并理解三类关键活动：
   - Tool 执行（tool.*）
   - 文档派生（doc.*：pdf/unpack/ocr/docx 等）
   - 缓存命中（file.cache_hit）
2) 默认不展示敏感原文：只显示 redacted summary + pointers
3) Running/Failed/Needs attention 会置顶（Now）
4) 能复制/定位 pointers（至少 copy）
5) 在大量事件下仍可用（分页/增量加载，不一次渲染全部）

---

## 12. Open Questions（实现前需最终拍板）

1) App 形态：右侧 Panel（推荐） vs Dialog（更快）——可先 Dialog v1，后续升级 Panel。
2) Turn 关联：是否在 P2.2 引入 traceId/turnId 注入以实现“按消息插入 timeline”。
3) Artifact 查看：v1 只做 pointers，v2 再做受控查看（带风险提示与权限策略）。

---

## 13. P2（产品升华）建议：有生命力的心跳 + 可视化溯源

> 目的：在不牺牲“可落地/可验收/默认安全”的前提下，把 v1 的 Activity 从 90 分工程方案升级为“100 分产品艺术品”。

### 13.1 Living Pulse（Agent “生命体征”）

#### 13.1.1 采纳结论
**采纳，作为 P2。**  
理由：这是“低侵入、高体验增益”的增强；实现主要在 UI 层，不需要重构协议；同时对建立用户信任非常有效。

#### 13.1.2 设计落地（App 优先，TUI 轻量化）
- App 的 Pulse 载体建议统一为两处（保持一致的“生命体征语言”）：
  1) Session Header 的 `Activity` 按钮旁小点（或 badge）
  2) Inline Activity Chip 左侧的状态点
- Pulse 节奏与状态映射（示例，非绑定实现）：
  - **Thinking / Routing**：缓慢呼吸（Breathing），暗示“深层推理/规划中”
  - **Executing / Batch**：轻快闪烁（Flicker），暗示“高吞吐执行中”
  - **Retrying / Stalled**：不规则律动（Arrhythmia）或轻微色相偏移（蓝→微紫），暗示“遇到阻力但在自愈”
  - **Idle**：隐藏或静止

#### 13.1.3 关键约束（必须满足）
- **可访问性**：遵守 `prefers-reduced-motion`；在减少动效模式下退化为静态状态点 + 文案（不做 pulse）。
- **不误导**：Pulse 只是“健康度/活跃度”的直觉提示，不替代明确的文字状态（Running/Failed/Needs attention 仍必须可读）。
- **数据来源（v1 可落地）**：优先用 Activity Stream 的 `Now` 状态推导；如有更实时的 session/status 信号，可叠加增强。

### 13.2 Visual Provenance（因果关系的视觉连接）

#### 13.2.1 采纳结论
**采纳，作为 P2，但必须“有前置条件”。**  
理由：这个增强极大提升“可解释性/反幻觉感”，但如果使用“时间戳猜测”的弱关联，容易画出错误因果线，反而损害信任。因此必须先建立可靠关联 ID。

#### 13.2.2 必要前置：Turn ↔ Activity 的可靠关联
建议优先使用 `EventV1.traceId`（协议已支持）：
- 每个用户 turn 开始生成 traceId
- 同一 turn 内的 routing/tool/workbench/cache 事件复用同一 traceId
- UI 端据此把 ActivityItem 绑定到具体 turn（或 turn group）

> 只有在“明确可证明”的关联存在时，才允许画连线或联动高亮。

#### 13.2.3 UI 落地形态（从易到难）
1) **基础联动高亮（优先）**：hover/focus ActivityItem → 高亮对应消息块；反向亦然  
   - 触屏设备使用 click/tap 触发与取消（不依赖 hover）
2) **Jump/定位（强可用）**：ActivityItem 展开详情提供 “Jump to message” 与 “Copy traceId”
3) **Bezier 连线（锦上添花）**：在 overlay 层绘制极细曲线/光带连接两侧区域  
   - 必须保证性能：滚动/resize 时节流（rAF），不造成卡顿  
   - 若定位不在可视区，只做“指向提示”或自动滚动到可视再画线

#### 13.2.4 安全约束
- 视觉连线只是“关联提示”，不自动展示原文内容
- Inspect 仍遵守默认安全策略：summary + pointers + redaction
