import { animate } from "motion";
import { onMount, onCleanup, createEffect, on } from "solid-js";

/**
 * useLivingBeam - The Physics of Thinking
 * 
 * 核心逻辑：
 * 1. Idle: 低频呼吸 (Breathe) - 模拟 extreme-polish-native.html 中的光柱呼吸
 * 2. Active: 神经震颤 (Jitter) - 响应 Token 流 (模拟 extreme-polish-native.html 中的点击效果)
 */
export function useLivingBeam(ref: HTMLElement, trigger: () => void) {
  let breatheAnim: any;

  // 1. Base State: Idle Breathing (有机呼吸)
  // 参考 extreme-polish-native.html 中的 .energy-core 初始阴影
  const startBreathing = () => {
    breatheAnim = animate(ref, 
      { 
        opacity: [0.6, 1, 0.6], 
        height: ["100%", "110%", "100%"] // 垂直微动
      },
      { duration: 2.5, repeat: Infinity, easing: "ease-in-out" }
    );
  };

  onMount(() => startBreathing());
  onCleanup(() => breatheAnim?.stop());

  // 2. Neuro-Link Jitter (神经震颤)
  // 参考 extreme-polish-native.html 中的 .energy-core.jitter 样式
  // transform: scaleY(1.15) scaleX(1.5); box-shadow: 0 0 30px...
  createEffect(on(trigger, () => {
    if (!ref) return;
    
    // Fire Impulse (50ms reaction)
    animate(ref, 
      { 
        width: ["3px", "5px", "3px"], // 模拟 scaleX(1.5)
        filter: ["brightness(1)", "brightness(1.5)", "brightness(1)"],
        boxShadow: ["0 0 15px var(--axiom-blue)", "0 0 30px var(--axiom-blue)", "0 0 15px var(--axiom-blue)"]
      },
      { duration: 0.05 }
    );
  }));
}
