# Opencode Design System v3.3: "The Living Organism"
> **Status**: APPROVED / FINAL (定案)  
> **Tech Stack**: SolidJS, Tauri 2, Tailwind, OpenTUI, Motion One.  
> **Core Concept**: The UI must behave like a living biological entity, not a static machine.

> **Engineering Discipline（P3/P4 前置纪律）**：见 `docs/ui/discipline.md`

---

## 1. Core Visual Pillars (核心视觉支柱)

### A. The Duality (二元性)
*   **TUI (CLI)**: **Magic Capsule** (胶囊浮岛). 隐喻: "灵魂之眼".
*   **GUI (App)**: **Living Beam** (生命光柱). 隐喻: "神经连接".

### B. The Texture (双重质感)
*   **Night**: Fractal Noise (4% Opacity) —— 消除数字塑料感。
*   **Day**: Paper Grain (Multiply Mode) —— 模拟纸张纹理。

---

## 2. Design Tokens (设计令牌)

| Semantics | Night Token | Day Token |
| :--- | :--- | :--- |
| **Background** | `--bg-void`: `#050509` | `--bg-paper`: `#FAFAFA` |
| **Surface** | `--bg-surface`: `#0F0F12` | `--bg-ceramic`: `#FFFFFF` |
| **Text** | `--text-main`: `#E2E8F0` | `--ink-primary`: `#111827` |
| **Beam (Think)**| `--beam`: `#FFFFFF` (Tungsten) | `--beam`: `#2563EB` (Blueprint) |
| **Tick (Done)** | `--tick`: `#3B82F6` (Blue Tick)| `--tick`: `#1E40AF` (Deep Blue) |

---

## 3. Component Specifications (组件规范)

### 3.1 TUI: The Magic Capsule
*   **Tech**: OpenTUI (Solid-based).
*   **Soul Dot**: RGB Color interpolation (Cyan -> Dark Cyan).

### 3.2 GUI: The Living Physics (GUI 核心)
*   **Tech**: SolidJS + Motion One.
*   **States**:
    1.  **Thinking (Idle)**: "Solid Pulse" (Slow breathing, Opacity 0.4-1.0).
    2.  **Thinking (Streaming)**: **"Neuro-Link Jitter"** (See Section 5).
    3.  **Done**: **"Liquid Morph"** & **"Spring Snap"**.

---

## 4. Animation Curves (物理手感)

*   **Float Up**: `cubic-bezier(0.16, 1, 0.3, 1)` (Duration: 600ms).
*   **Spring Snap**: `Motion One Spring` (Stiffness: 400, Damping: 25).

---

## 5. Extreme Micro-Interactions (变态级细节)
> **Mandatory for World-Class Feel**

### 5.1 Neuro-Link Jitter (神经震颤)
*   **Trigger**: 每当 LLM 输出一个新的 Token (字符) 时触发。
*   **Effect**: 光柱瞬间膨胀并高亮。
*   **Params**: 
    *   Scale X: `1.5`
    *   Scale Y: `1.1`
    *   Brightness: `Max`
    *   Duration: `50ms` (极快回弹)
*   **Goal**: 让用户感觉到“电流”流过了光柱。

### 5.2 Liquid Morph (液态变形)
*   **Trigger**: 思考结束，转为完成态时。
*   **Logic**: 严禁 DOM 切换。必须对同一个 `div` 进行属性过渡。
*   **Transition**: 
    *   Height: `60px` -> `8px`
    *   Color: `White` -> `Blue`
    *   Shadow: `Glow` -> `None`

### 5.3 Haptic Ripple (触感涟漪)
*   **Trigger**: 变形完成的瞬间 (Snap)。
*   **Visual**: 一个 1px 边框的圆环从中心向外扩散。
*   **Params**:
    *   Scale: `1.0` -> `3.0`
    *   Opacity: `0.8` -> `0`
    *   Duration: `600ms`

---
**Signed off by CDO**

---

## Appendix A. UI 工程纪律摘要（P3/P4）

此文档定义“审美宪法”，但为了确保 P3/P4 期间新增 UI 不会偏离产品化方向，并为后续全面换肤
降低返工成本，我们将执行一份工程纪律。

完整版本：`docs/ui/discipline.md`

必须遵守的 6 条底线：
1. 禁止硬编码颜色/阴影/圆角/间距：必须使用语义 token 或 CSS 语义变量。
2. “人话视图”与“审计视图”分离：用户默认不看工程字段，审计可懒加载展开。
3. Live 状态必须去抖（≥800ms），高频同类事件必须合并叙事，避免闪烁焦虑。
4. 失败是阻断性交互：失败自动展开到错误步骤，成功可折叠。
5. 列表性能红线：禁止每个 item 自己 `setInterval`，计时必须共享时钟 signal。
6. 动效必须支持 `prefers-reduced-motion` 安全降级。
