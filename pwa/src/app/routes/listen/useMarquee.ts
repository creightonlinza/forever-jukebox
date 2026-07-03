import { useCallback, useEffect, useState } from "react";
import { setAutoMarqueeText } from "./marquee";

// Wraps the imperative marquee controller (WeakMap of per-element controllers
// in marquee.ts) and returns a ref callback for the title node.
//
// Unlike the web app — where the title lives in a dedicated component that
// mounts/unmounts — the PWA renders the title <div>s conditionally inside the
// single Listen component. A plain ref object wouldn't re-run the effect when
// the node attaches (its identity never changes), so the text would only be
// applied on a later text change. Tracking the node in state makes the effect
// fire on mount, unmount, and text change alike.
export function useMarquee(text: string) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (element) {
      setAutoMarqueeText(element, text);
    }
  }, [element, text]);
  return useCallback((node: HTMLElement | null) => {
    setElement(node);
  }, []);
}
