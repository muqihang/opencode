# Task 16 Design (GPT): Product-Grade Activity Timeline (App + TUI)

> 背景：本设计稿是我（GPT）独立产出的 Task 16 UI/UX 方案，用于与你的 UI 代理版本做对比与融合。  
> 约束：不修改 `docs/plans/2026-01-31-task16-evidence-timeline-ui-design.md`（UI 代理产出）。

## 0. TL;DR

我们把 `.opencode/evidence/<sessionId>/events.jsonl` 变成用户可感知的 **Activity（活动）**：

- **App**：右侧 `Activity` 面板（产品级审美 + 可过滤/搜索/分组）+ 聊天流内的 **折叠 Activity Chip**（默认折叠，点击联动打开面板并定位）。
- **TUI**：新增 `/activity`（或 keybind）打开 “Activity 列表/树”，默认安全摘要 + 指针，不暴露原始内容。
- **默认安全**：只显示 `EventV1.summary`（要求 redacted）+ 指针（artifact/manifest key）；“看更多”是显式操作，且有风险提示。
- **MVP**：先覆盖三类高价值事件：`tool.*`、`doc.*`（workbench 派生）、`file.cache_hit`（缓存复用）。

---

## 1. Why：用户为什么需要 Activity

P2/P2b 增强后，系统内部已经能做很多事情（sandbox 执行、routing、workbench 文档派生、cache 复用、gate/merge、子会话 finalizer 等），但用户的感知仍停留在“等回复”。这会造成：

- 用户不知道**正在做什么**（是否卡住、是否在跑工具、是否在解析文档）。
- 用户不知道**为什么慢**（PDF/解压/OCR 这种长链路）。
- 用户不知道**下一步要不要介入**（例如需要审批、或失败需要查看证据指针）。

Activity 的产品目标是：把“后台工程化努力”转化为用户能理解、能信任的工作流可视化。

---

## 2. Goals（必须达到）

1. **GPT Web UI 的直观感（但不打扰）**：默认折叠、轻量提示、需要时一键展开。
2. **可解释性 + 可追溯**：每个条目都能落到 evidence 指针（artifact path / manifest key）。
3. **安全默认**：不默认显示可能泄露的 raw stdout/stderr/文件内容。
4. **低噪声**：默认只突出“对用户有意义”的事件；debug 信息不抢占主视觉层级。
5. **双端一致**：App 与 TUI 语义一致（同一套 event→UI mapping），只是呈现形态不同。

---

## 3. Non-Goals（本阶段不做/不承诺）

- 不做“完整日志阅读器”作为默认体验（那会变成工程工具，不是产品）。
- 不在 v1 做“直接内嵌查看 artifact 原文”（先做到安全指针与复制/定位；后续再加受控查看）。
- 不为了 Activity 大规模重构聊天 UI。

---

## 4. UX 原则（世界级“默认值”）

### 4.1 Progressive Disclosure（渐进式揭示）
默认只让用户看到：**正在发生什么 + 是否成功/失败 + 大概耗时 + 可追溯指针**。细节通过点击/快捷键展开。

### 4.2 Chat First（聊天主叙事优先）
聊天流仍是主叙事，Activity 是“侧边工作台”和“折叠提示条”，而不是把聊天变成日志。

### 4.3 Attention Management（注意力管理）
把“需要用户介入”的状态置顶（审批/失败/运行中），其余放在折叠分组里。

### 4.4 Safe by Default（默认安全）
事件设计本身强调 summary redacted（`EventV1.redaction`），UI 必须尊重这个默认。

---

## 5. 信息架构（IA）

### 5.1 App（推荐形态：右侧 Activity Panel + Inline Chip 联动）

**入口：Session Header 增加 Activity 按钮**
- 常态：`Activity`
- 有新事件：Badge（数字或点）
- 有阻塞：状态变体（黄点/红点）更明显（例如 “Needs attention”）

**主视图：右侧 Activity Panel（工作台风格）**
- Header：`Activity` + 搜索 + Filter + Group by
- “Now” 区域（置顶）：只展示 0–3 条最关键事件（Running / Needs approval / Failed）
- “Recent” 区域：按分组折叠（默认 `Group by: Stage`）

**Inline：聊天流内 Activity Chip（默认折叠）**
- 文案模板（建议极克制、1 行可扫读）：
  - Running：`Activity · Working… · last: Running tool rg · 12s`
  - Done：`Activity · 6 items · Done · last: archive unpacked · 2.3s`
  - Attention：`Activity · Action required · Permission request`
- 行为：点击打开 Activity Panel 并定位到对应时间段/分组。

> 说明：Inline 负责“让用户意识到后台在做事”，Panel 负责“给用户理解与追溯的工具”。

### 5.2 TUI（推荐形态：/activity dialog）

**新增 Slash Command：`/activity`**
- 打开 Dialog：列表/树视图（默认按 Stage 分组）
- 支持：过滤（severity/category）、搜索、打开详情（Enter）

**主界面仅加轻量提示**
- Footer/Sidebar 一行：`Activity: running · 3 new`（不把主聊天刷屏）

---

## 6. 交互模型（Interaction）

### 6.1 分组策略（默认：Stage Blocks）
默认 `Group by: Stage`，提供轻量切换：
- Stage（推荐默认）：Tool / Workbench / Routing / Merge+Gate / Cache
- Turn（按消息回合）
- Session（按 parent/child session）

**理由**：Stage 分组最像“产品活动流”，更少噪声，且天然适配折叠降噪。

### 6.2 事件条目（Event Item）信息结构
每条事件统一结构（App/TUI 同语义）：
- Icon（类别）
- Title（动词句，产品化）
- Status pill：Running / Done / Failed / Skipped / Needs approval
- Meta：timestamp + duration（若可得）+ source（child session / sandbox）
- Safe summary：仅 1 行，计数/指针/结果，不展示原始内容

### 6.3 展开（Details）
展开时固定四个区块（形成“可预测”的阅读体验）：
1) Summary（可读描述）
2) Pointers（artifact/manifest key，可复制，可定位）
3) Data（安全子集：string/number/bool + pointer 字段）
4) Redaction（`applied=true` + `policyVersion`，用户可理解的安全提示）

### 6.4 阻塞态（Action Required / Failed）
阻塞态事件在展开时提供 **Next action**：
- Permission：引导用户去“权限请求处理入口”
- Failure：提供 “Copy pointer” + “Open artifact” 的路径（v1 可先到 copy/locate）

---

## 7. 视觉语言（Visual Language）

### 7.1 App（产品级质感建议）
整体风格：**干净克制 + 高级灰阶 + 小面积强调色**。

- 卡片：轻边框 + hover 提升（避免重阴影）
- 状态色只用于小面积：左侧 2px 竖条 + pill
- 微动效：
  - Running：小圆点呼吸/脉冲
  - 新事件：淡入 + 背景轻高亮 1–2 秒后淡出
  - 折叠：150–200ms easing

### 7.2 TUI（可扫读优先）
让用户一眼读懂：类别、状态、标题、耗时。

示例（概念，不绑定具体实现）：
```text
[RUN] Tool      rg                tool started
[ OK] Workbench PDF               extracted text (2.3s)
[WARN] Cache     file.cache_hit    reused derived outputs
```

---

## 8. 数据来源与映射（EventV1 → UI）

### 8.1 事实：事件模型
我们以 `EventV1` 为唯一输入（来自 `events.jsonl`）：
- `ts`, `severity`, `actor`, `type`, `summary`, `data?`, `redaction`

### 8.2 MVP 映射（优先覆盖）

| Event type | Category | Title（示例） | Default importance |
|---|---|---|---|
| `tool.started` / `tool.completed` | Tool | `Running tool: <tool>` / `Tool finished` | High |
| `doc.unpack_archive` | Workbench | `Unpacking archive` / `Archive unpacked` | High |
| `doc.extract_pdf_text` / `doc.pdf_pages` | Workbench | `Extracting PDF text` / `Extracting PDF pages` | High |
| `doc.ocr_image` | Workbench | `Running OCR` | High |
| `doc.parse_docx` | Workbench | `Parsing DOCX` | High |
| `file.cache_hit` | Cache | `Cache hit` | Medium (但很有价值) |
| `routing.started` | Routing | `Routing request` | Medium |
| `policy.exec_evaluated` | Sandbox | `Sandbox policy evaluated` | Low/Collapsed |

> 注：当前 traceId/spanId 使用情况未知（可选字段）。v1 的“tool span”合成可先按 actor + 顺序配对；如未来补充 toolRunId/spanId，可升级匹配逻辑。

### 8.3 噪声控制（默认过滤）
- 默认只展示：`warn`/`error` + Running + MVP 高价值类型（tool/doc/cache/routing）
- `debug/info` 中低价值类型折叠到 “More…”（App）/“Show all”（TUI）

---

## 9. 数据管线（App/TUI 如何读到 events.jsonl）

当前 UI 层主要消费 “server SSE event stream”（运行态事件），而 evidence timeline 需要读 `events.jsonl`（持久化证据）。

推荐为 Task 16 后续实现增加一个 **只读 evidence API**（路线 B 的必要基础）：

### 9.1 API（建议）
1) `GET /session/:id/evidence/events?cursor=<byteOffset>`
   - 返回：`{ events: EventV1[], nextCursor: number }`
   - 目的：分页/增量拉取（避免每次全量读 JSONL）

2) `GET /session/:id/evidence/manifest`
   - 返回：evidence manifest（用于 pointers 与 artifact 列表）

3) （可选）`GET /session/:id/evidence/stream`（SSE/stream）
   - 目的：实时体验更像 GPT（但 v1 可先 polling+cursor）

### 9.2 安全与权限
- API 只返回 `EventV1` 与 manifest（都是“safe by design”的结构）
- 不在 v1 直接提供任意文件读取；artifact 查看需明确白名单与提示策略（后续做）。

---

## 10. MVP 切割（v1 交付）

### 10.1 App v1
- Activity 按钮入口 + 右侧 Panel
- Inline Activity Chip（默认折叠）+ 联动定位
- 展示：Now（置顶）+ Stage Blocks（折叠）
- 支持：Filter（severity/category）+ Search（summary/actor/type）
- Actions：copy pointer / copy event JSON（调试用）

### 10.2 TUI v1
- `/activity` dialog（列表）
- 详情查看（summary + pointers + redaction）
- 基础过滤（至少 severity）

---

## 11. 验收标准（Acceptance Criteria）

1) 用户能在 UI 上直观看到：
   - 工具执行开始/结束（tool.*）
   - 文档派生（doc.*：pdf/unpack/ocr/docx）
   - 缓存命中（file.cache_hit）
2) 默认不泄露敏感内容：只显示 redacted summary + pointers。
3) 新事件出现时：
   - Inline chip 更新
   - Panel 自动更新（不抖动、不刷屏）
4) 用户能从事件定位到证据：至少能复制 pointer（artifact path / manifest key）。

---

## 12. Open Questions（后续需要定）

1) Tool span 合成：是否补充 `spanId`/`toolRunId` 以支持并发工具执行的精确配对？
2) Artifact 查看策略：v1 仅复制指针，v2 才做受控查看（带警告与权限）是否接受？
3) Performance：events.jsonl 过大时的保留策略（截断/归档）如何做？

