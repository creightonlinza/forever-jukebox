const HOLD_MS = 2000;
const MIN_SCROLL_DURATION_MS = 1200;
const MAX_SCROLL_DURATION_MS = 7000;
const SCROLL_MS_PER_PIXEL = 12;

type MarqueePhase = "idle" | "hold-start" | "scroll-out" | "hold-end" | "scroll-back";

type MarqueeController = {
  refresh: () => void;
  setText: (text: string) => void;
};

const controllers = new WeakMap<HTMLElement, MarqueeController>();

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function createMarqueeController(element: HTMLElement): MarqueeController {
  const canAnimate =
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function";
  let phase: MarqueePhase = "idle";
  let phaseStart = 0;
  let maxScroll = 0;
  let scrollDurationMs = 0;
  let frameId: number | null = null;
  const reducedMotionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  const stop = () => {
    if (frameId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    phase = "idle";
    element.scrollLeft = 0;
    element.classList?.remove?.("is-marquee-active");
  };

  const shouldAnimate = () => {
    if (reducedMotionQuery?.matches) {
      return false;
    }
    const text = element.textContent?.trim() ?? "";
    if (!text) {
      return false;
    }
    const scrollWidth =
      typeof element.scrollWidth === "number" ? element.scrollWidth : 0;
    const clientWidth =
      typeof element.clientWidth === "number" ? element.clientWidth : 0;
    maxScroll = Math.max(0, Math.ceil(scrollWidth - clientWidth));
    if (!Number.isFinite(maxScroll) || clientWidth <= 0 || maxScroll <= 1) {
      return false;
    }
    scrollDurationMs = clamp(
      maxScroll * SCROLL_MS_PER_PIXEL,
      MIN_SCROLL_DURATION_MS,
      MAX_SCROLL_DURATION_MS,
    );
    return true;
  };

  const tick = (timestamp: number) => {
    if (phase === "idle") {
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      stop();
      return;
    }
    frameId = requestAnimationFrame(tick);
    switch (phase) {
      case "hold-start":
        element.scrollLeft = 0;
        if (timestamp - phaseStart >= HOLD_MS) {
          phase = "scroll-out";
          phaseStart = timestamp;
        }
        return;
      case "scroll-out": {
        const progress = Math.min(1, (timestamp - phaseStart) / scrollDurationMs);
        element.scrollLeft = Math.round(maxScroll * progress);
        if (progress >= 1) {
          phase = "hold-end";
          phaseStart = timestamp;
        }
        return;
      }
      case "hold-end":
        element.scrollLeft = maxScroll;
        if (timestamp - phaseStart >= HOLD_MS) {
          phase = "scroll-back";
          phaseStart = timestamp;
        }
        return;
      case "scroll-back": {
        const progress = Math.min(1, (timestamp - phaseStart) / scrollDurationMs);
        element.scrollLeft = Math.round(maxScroll * (1 - progress));
        if (progress >= 1) {
          phase = "hold-start";
          phaseStart = timestamp;
        }
        return;
      }
    }
  };

  const refresh = () => {
    stop();
    if (!canAnimate || !shouldAnimate()) {
      return;
    }
    phase = "hold-start";
    phaseStart = performance.now();
    element.classList?.add?.("is-marquee-active");
    frameId = requestAnimationFrame(tick);
  };

  const onWindowResize = () => {
    refresh();
  };
  if (typeof window.addEventListener === "function") {
    window.addEventListener("resize", onWindowResize);
  }
  if (
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
  ) {
    document.addEventListener("fullscreenchange", onWindowResize);
    document.addEventListener("webkitfullscreenchange", onWindowResize);
  }

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      refresh();
    });
    resizeObserver.observe(element);
  }

  if (reducedMotionQuery) {
    const onReducedMotionChange = () => {
      refresh();
    };
    if (typeof reducedMotionQuery.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    } else if (typeof reducedMotionQuery.addListener === "function") {
      reducedMotionQuery.addListener(onReducedMotionChange);
    }
  }

  return {
    refresh,
    setText(text: string) {
      element.textContent = text;
      refresh();
    },
  };
}

function getMarqueeController(element: HTMLElement): MarqueeController {
  const existing = controllers.get(element);
  if (existing) {
    return existing;
  }
  const created = createMarqueeController(element);
  controllers.set(element, created);
  return created;
}

export function setAutoMarqueeText(element: HTMLElement, text: string) {
  getMarqueeController(element).setText(text);
}
