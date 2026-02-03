# LLM-assisted Capsule UI/UX Specification (v2.1: Axiom Final)

> **Version**: 2.1 (Production Ready)
> **Status**: APPROVED
> **Philosophy**: "Axiom Truth" —— 视觉上强调物理质感，逻辑上强调可核验性。

本文档定义了 **Axiom Truth Capsule（AI 真理胶囊）** 的用户界面规范。它结合了 "Living Organism" 的动效设计与严格的产品逻辑约束。

---

## 1. 核心原则 (Core Principles)

1.  **非事实声明**: UI 必须处处暗示“这是 AI 的推演，请核验”。标题强制使用 **“AI 建议 (可核验)”**。
2.  **未知可见性**: `unknown` 条目严禁静默丢弃。它们是风险提示的一部分，必须以 **琥珀色 (Amber)** 醒目展示。
3.  **真理锚点**: 每一条决策建议必须附带 **引用来源 (Evidence)**，点击可溯源。

---

## 2. 交互形态 (Interaction Flow)

### 2.1 入口：真理印记 (The Truth Seal)
在 Activity 流中，表现为一个高密度的印记组件。

*   **视觉**: 左侧垂直轴线贯穿，印记吸附在轴线上。
*   **状态色**:
    *   **Success**: `Axiom Blue` (工程蓝) —— 信心充足。
    *   **Degraded**: `Amber` (琥珀色) —— 证据链不完整。
    *   **Failed**: `Red` (红色) —— 推演中断。

### 2.2 展开：蓝图铺开 (Unfolding Blueprint)
点击印记，详情面板在下方**原位展开**（手风琴效果），而非弹窗。背景色微微加深，形成“聚焦感”。

---

## 3. 详情面板结构 (The Panel)

### 3.1 头部 (Header)
*   **Title**: **AI 建议要点** (Serif 字体)。
*   **Subtitle**: "以下内容基于当前上下文推演，请人工核实。" (灰色小字)。
*   **Action**: `[复制蓝图]` 按钮 (Copy Markdown)。

### 3.2 内容区域 (The Body)

分为三个严格的物理区域：

#### A 区：已决之理 (Decisions) —— "The Solid"
*   **Icon**: ✅ (实心蓝)。
*   **Style**: 正常黑色文本。
*   **Evidence**: 文本下方跟随 **Truth Anchor Chips** (见下文)。

#### B 区：未决之疑 (Open Questions) —— "The Fluid"
*   **Icon**: ❓ (空心灰)。
*   **Style**: 灰色文本，带虚线边框，暗示“待填充”。

#### C 区：未知/风险 (Unknowns) —— "The Void"
*   **Visibility**: **默认可见**。如果超过 3 条，可折叠为 "展开剩余 N 条未知项"。
*   **Style**: **琥珀色背景块** (`#FFFBEB`) + 橙色边框。
*   **Content**:
    *   文本: `[原问题描述]`
    *   **Reason**: ⚠️ **无法核验**: `[unknownReasonZh]` (例如: "引用文件不存在")。

---

## 4. 组件规范：真理锚点 (Truth Anchors)

### 4.1 视觉样式
*   不再是简单的 `[Link]` 文字。
*   **组件**: `Chip` (胶囊)。
*   **外观**: 浅蓝背景 (`#EFF6FF`)，深蓝文字，带有一个微小的文件图标。
*   **文本**: `📄 store.ts` (文件名) 或 `📑 RFC-003` (标题)。

### 4.2 交互逻辑 (The Lens)
*   **Hover/Click**: 触发 **"Evidence Lens" (证据透镜)**。
*   **Lens Content**:
    *   **Path**: `packages/server/src/store.ts`
    *   **Version**: `SHA: a1b2c3` (防伪指纹)
    *   **Action**: `[复制路径]` / `[打开文件]`

---

## 5. 文案与状态映射 (Copywriting)

| 后端状态 | UI 标题 | 状态解释文案 | 颜色 |
| :--- | :--- | :--- | :--- |
| `success` | **AI 建议要点 (可核验)** | 共 N 条决策 · M 个待定项 | Blue |
| `degraded` | **AI 建议 (已降级)** | 部分引用无法溯源，请谨慎采纳 | Amber |
| `failed` | **推演中断** | 建议生成失败，请检查日志 | Red |

---

## 6. 数据契约 (Backend Schema)

```typescript
interface CapsulePayload {
  status: 'success' | 'degraded' | 'failed';
  degradedReasonZh?: string; // e.g. "Token limit exceeded"
  
  items: {
    type: 'decision' | 'question';
    status: 'known' | 'unknown';
    text: string;
    unknownReasonZh?: string; // 关键: 为什么 unknown
    evidenceIndices: number[]; // 指向 anchors
  }[];

  anchors: {
    path: string;
    sha256?: string;
    kind: 'file' | 'diff' | 'issue';
  }[];
}
```

---

## 7. 完整示例 (Mockups)

### 示例 A：完美推演 (Happy Path)
> **✅ 已形成的决策**
> *   将 Context Store 迁移至 SQLite
>     *   `[📄 store.ts]` `[📑 RFC-003]`
>
> **❓ 仍待确认的问题**
> *   确认 SQLite 版本锁定策略
>     *   `[⚙️ .env]`

### 示例 B：含未知项 (With Unknowns)
> **✅ 已形成的决策**
> *   (略)...
>
> **⚠️ 存在未知项 (Unknowns)**
> *   [?] 是否需要兼容 IE11
>     *   ⚠️ **无法核验**: 项目文档未提及浏览器兼容性标准。

---

*Spec Updated by Chief Design Officer.*
*Aligned with Axiom Design System v3.3 & Product Logic.*
