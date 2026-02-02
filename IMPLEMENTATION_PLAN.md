# Implementation Plan: Project Ethereal (SolidJS Edition)
> **Objective**: 100% Fidelity implementation using SolidJS, Tauri, and Motion One.

---

## Phase 1: The Theme Engine (Foundation)
*目标：在 Tailwind 中建立双重质感系统。*

### 1.1 CSS Variables Strategy
*   **File**: `packages/ui/src/global.css`
*   **Action**: 定义 CSS 变量以支持 `data-theme`.
    ```css
    :root {
      --bg-void: #050509;
      --beam-color: #FFFFFF;
      --effect-noise: url('/noise-dark.svg');
    }
    [data-theme="light"] {
      --bg-void: #FAFAFA;
      --beam-color: #2563EB;
      --effect-noise: url('/noise-light.svg');
    }
    ```

### 1.2 Motion One Setup
*   **Action**: `npm install motion` (in `packages/ui` and `packages/desktop`).
*   **Usage**: 用于替代 CSS Keyframes 以获得弹簧物理效果。

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
*   **Task**: 在 Tauri 的 Rust 后端或 JS 前端监听系统主题变化，自动切换 `data-theme` 属性。

### 4.2 Asset Generation
*   **Task**: 生成 `noise-dark.svg` (opacity 4%) 和 `noise-light.svg` (opacity 15%) 文件并放入 `public` 目录。

---

**Execution Priority**:
1.  **GUI Theme Engine** (CSS Vars)
2.  **GUI Components** (Beam, Tick, Axis using Motion One)
3.  **TUI Components** (OpenTUI Layout)
