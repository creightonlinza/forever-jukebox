import { useEffect, type RefObject } from "react";
import { setAutoMarqueeText } from "../marquee";

// Wraps the imperative marquee controller (WeakMap of per-element
// controllers in marquee.ts). Idempotent, so StrictMode double-effects are
// safe; the WeakMap releases the controller when the node goes away.
export function useMarquee(ref: RefObject<HTMLElement | null>, text: string) {
  useEffect(() => {
    const element = ref.current;
    if (element) {
      setAutoMarqueeText(element, text);
    }
  }, [ref, text]);
}
