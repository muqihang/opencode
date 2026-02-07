import { createSignal, onMount } from "solid-js";

/**
 * useTypewriter - 流式打印机
 * 
 * 核心逻辑：
 * 1. 逐字输出 (Character by character)
 * 2. 触发回调 (onChar) - 用于驱动外部的 Jitter
 */
export function useTypewriter(text: string, speed = 30, onChar?: () => void) {
  const [displayed, setDisplayed] = createSignal("");
  const [isTyping, setIsTyping] = createSignal(false);

  onMount(async () => {
    setIsTyping(true);
    let current = "";
    
    for (let i = 0; i < text.length; i++) {
      current += text[i];
      setDisplayed(current);
      
      // Fire the neuro-link trigger
      if (onChar) onChar();

      // Randomize speed slightly for human feel
      const jitter = Math.random() * 10; 
      await new Promise(r => setTimeout(r, speed + jitter));
    }
    
    setIsTyping(false);
  });

  return { displayed, isTyping };
}
