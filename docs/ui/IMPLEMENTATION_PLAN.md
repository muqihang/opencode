# Implementation Plan: Project Ethereal (SolidJS + Extreme Polish)
> **Objective**: 100% Fidelity implementation using SolidJS, Tauri, and Motion One.

---

## Phase 1: The Theme Engine
*   **Global CSS**: 定义 Night/Day 变量 (`--beam`, `--tick`, `--effect-noise`).
*   **Setup**: Install `motion` (Motion One).

---

## Phase 2: GUI Implementation (The Living Organism)

### 2.1 The Living Beam Component
*   **Component**: `LivingBeam.tsx`
*   **Props**: `isStreaming: boolean`, `streamTrigger: Accessor<any>` (Triggered on new token).
*   **Logic (Neuro-Link Implementation)**:
    ```tsx
    import { animate } from "motion";
    import { createEffect, on } from "solid-js";

    export function LivingBeam(props) {
      let ref: HTMLDivElement;
      
      // 1. Idle Breathing (Base State)
      // 使用 Motion One 的 timeline 保持呼吸
      
      // 2. Neuro-Link Jitter (The "Extreme" Detail)
      createEffect(on(props.streamTrigger, () => {
        // Stop breathing animation temporarily if needed
        // Fire rapid impulse
        animate(ref, 
          { transform: ["scale(1)", "scale(1.5, 1.1)", "scale(1)"], filter: ["brightness(1)", "brightness(2)", "brightness(1)"] },
          { duration: 0.05 } // 50ms reaction
        );
      }));

      return <div ref={ref!} class="beam-base" />;
    }
    ```

### 2.2 The Liquid Morph Transition
*   **Logic**:
    *   不卸载 `LivingBeam` 组件。
    *   通过改变 CSS Class 或直接用 Motion One 动画化 `height` 和 `backgroundColor`。
    *   *Critical*: 确保 layout 属性 (`layout` prop in Framer, or manual FLIP in Motion One) 开启，以保证平滑过渡。

### 2.3 The Ripple Feedback
*   **Component**: `HapticRipple.tsx`
*   **Logic**: 
    *   仅在 `status` 变为 `Done` 时挂载。
    *   自动播放一次性动画然后卸载 (Self-cleanup)。

---

## Phase 3: TUI Implementation (Solid + OpenTUI)
*   **Context Island**: 使用 Box 模拟胶囊。
*   **Soul Dot**: 实现 RGB 颜色循环。

---

## Phase 4: Integration
*   **Stream Binding**: 将 LLM 的输出流 (`stdout` or API stream) 连接到 GUI 的 `streamTrigger` 信号。这是实现“震颤”的关键。

---

**Execution Priority**:
1.  **GUI Core**: Implement `LivingBeam` with Jitter logic (The "Wow" factor).
2.  **Transitions**: Implement Liquid Morph.
3.  **Rest**: TUI & Theme.