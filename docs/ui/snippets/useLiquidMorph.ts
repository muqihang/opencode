import { animate, spring } from "motion";

/**
 * liquidMorph - 液态变形
 * 
 * 核心逻辑：
 * 从 "光柱 (Beam)" 物理坍缩为 "铆钉 (Tick)"。
 * 参考 extreme-polish-native.html 中的 .energy-core.morph-to-tick 样式
 * height: 10px; width: 10px; borderRadius: 50%;
 */
export function liquidMorph(element: HTMLElement, onComplete?: () => void) {
  // 1. Collapse & Change Color
  const morph = animate(element, 
    {
      width: "12px", // 对应 Tick 大小
      height: "12px",
      borderRadius: "50%",
      backgroundColor: "var(--axiom-dark)",
      boxShadow: "none"
    },
    { 
      // 使用 Spring 物理：硬度 400，阻尼 25 (Extreme Polish 参数)
      easing: spring({ stiffness: 400, damping: 25 }) 
    }
  );

  // 2. Optional: Haptic Ripple (视觉涟漪)
  // 参考 extreme-polish-native.html 中的 .ripple-ring 动画
  morph.finished.then(() => {
    if (onComplete) onComplete();
  });
}
