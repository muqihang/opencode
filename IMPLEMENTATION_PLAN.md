# Implementation Plan: Project Ethereal (SolidJS Edition)
> **Objective**: 100% Fidelity implementation using SolidJS, Tauri, and Motion One.

---

## Phase 1: The Theme Engine (Foundation)
*目标：在 Tailwind 中建立双重质感系统。*

### 1.1 CSS Variables Strategy
*   **Reality Check (Stack-Aligned)**:
    *   OpenCode 现有主题引擎通过 `packages/ui/src/theme/loader.ts` 注入 CSS，并设置 `html[data-theme="<themeId>"]`。
    *   Light/Dark（Day/Night）不是通过 `data-theme="light"` 切换，而是由同一个 Theme 的 `@media (prefers-color-scheme: dark)` 切换 variant。

*   **Primary File**: `packages/ui/src/theme/themes/<themeId>.json`
    *   **Action**: 用 theme JSON 的 `overrides` 注入新语义变量（例如 `bg-void`, `beam`, `tick`），避免在 UI 层到处写分支。

*   **Fallback File (Optional)**: `packages/ui/src/styles/theme.css`
    *   **Action**: 如果需要“未加载主题也可用”的兜底变量，可以在这里提供 fallback（但应优先走 theme engine）。

*   **Example (Theme Overrides)**: 定义 `--bg-void` / `--beam` / `--tick`（注意 overrides key **不带** `--` 前缀）
    ```json
    {
      "name": "Axiom",
      "id": "axiom",
      "light": {
        "seeds": {
          "neutral": "#F8F7F7",
          "primary": "#2563EB",
          "success": "#16A34A",
          "warning": "#F59E0B",
          "error": "#EF4444",
          "info": "#6366F1",
          "interactive": "#2563EB",
          "diffAdd": "#22C55E",
          "diffDelete": "#EF4444"
        },
        "overrides": {
          "bg-paper": "#FAFAFA",
          "beam": "#2563EB",
          "tick": "#1E40AF"
        }
      },
      "dark": {
        "seeds": {
          "neutral": "#0B0B10",
          "primary": "#93C5FD",
          "success": "#86EFAC",
          "warning": "#FCD34D",
          "error": "#FCA5A5",
          "info": "#A5B4FC",
          "interactive": "#93C5FD",
          "diffAdd": "#86EFAC",
          "diffDelete": "#FCA5A5"
        },
        "overrides": {
          "bg-void": "#050509",
          "beam": "#FFFFFF",
          "tick": "#3B82F6"
        }
      }
    }
    ```

### 1.2 Motion One Setup
*   **原则**: 默认优先 CSS keyframes / transition；只有“Spring Snap”这类物理动效需要时才引入 Motion One。
*   **Action (bun workspace)**:
    *   如果组件在 `packages/app` 使用：在 `packages/app` 添加依赖（而不是到处都装）。
    *   示例：`bun add motion --cwd packages/app`
*   **Usage**: 用于弹簧物理（spring）与更一致的入场/吸附手感；不强制替代全部 CSS keyframes。

---

## Phase 2: GUI Implementation (SolidJS + Tauri)

### 2.1 The Physics Beam (Thinking State)
*   **Component**: `ThinkingBeam.tsx`
*   **Logic**: 使用 Solid 的 `onMount` 或 `ref` 配合 Motion One。
    ```tsx
    import { animate } from "motion";
    import { onMount } from "solid-js";

    export function ThinkingBeam() {
      let ref: HTMLDivElement;
      
      onMount(() => {
        animate(ref, 
          { opacity: [0.4, 1, 0.4], boxShadow: ["0 0 5px...", "0 0 25px..."] },
          { duration: 2.5, repeat: Infinity, easing: "ease-in-out" }
        );
      });

      return <div ref={ref!} class="w-[3px] h-[60px] bg-[var(--beam-color)] rounded-full" />;
    }
    ```

### 2.2 The History Tick (Done State)
*   **Component**: `HistoryTick.tsx`
*   **Logic**: 使用 Spring 物理进行入场。
    ```tsx
    import { animate, spring } from "motion";
    
    onMount(() => {
      animate(ref, 
        { transform: ["scale(0)", "scale(1)"] }, 
        { easing: spring({ stiffness: 300, damping: 20 }) }
      );
    });
    ```

### 2.3 The Central Axis Layout
*   **Component**: `TimelineLayout.tsx`
*   **Structure**:
    *   `<div class="fixed inset-0 z-0 bg-[var(--gui-line)] w-[1px] left-1/2 -translate-x-1/2" />` (The Axis)
    *   `<div class="relative z-10 flex flex-col items-center">` (The Feed)

---

## Phase 3: TUI Implementation (Solid + OpenTUI)

### 3.1 The Context Island
*   **Challenge**: OpenTUI (终端) 没有 CSS `border-radius`。
*   **Solution**: 使用字符模拟圆角胶囊。
*   **Render Logic**:
    ```tsx
    // 伪代码 (取决于 OpenTUI API)
    <Box borderStyle="round" borderColor="cyan">
      <Text>OC</Text>
      <Text>~/project</Text>
      <Text color="cyan">●</Text> {/* Soul Dot */}
    </Box>
    ```

### 3.2 The Soul Dot Animation
*   **Logic**: 由于终端不支持复杂的 `box-shadow` 动画，我们将通过**颜色循环**来模拟呼吸。
    *   使用 Solid 的 `createSignal` 定时切换颜色亮度 (Cyan -> Dark Cyan -> Cyan)。

---

## Phase 4: Integration & Polish

### 4.1 Theme Sync
*   **Task**:
    *   监听系统主题变化（light/dark），切换 color-scheme（或让 theme 的 `@media (prefers-color-scheme: dark)` 自动生效）。
    *   `data-theme` 仅用于主题 ID（例如 `oc-1` / `axiom`），不用于 light/dark。

### 4.2 Asset Generation
*   **Task**:
    *   生成 `noise-dark.svg`（~4%）和 `noise-light.svg`（Day 模式可更高，但必须保证可读性）
    *   放入 `packages/app/public/`（或 `packages/ui/src/assets/` 后通过 app 引用），并以 overlay 的方式使用：
        *   `pointer-events: none`
        *   `prefers-reduced-motion` 下不需要变化（静态即可）

---

**Execution Priority**:
1.  **GUI Theme Engine** (CSS Vars)
2.  **GUI Components** (Beam, Tick, Axis using Motion One)
3.  **TUI Components** (OpenTUI Layout)
