// Browser location for the shell. Each entry keeps its key in history.state;
// an entry without one (first load, tuning URL writes) reads as "default".
type NavigationType = "POP" | "PUSH" | "REPLACE";

function read(type: NavigationType) {
  const state = window.history.state as { key?: string } | null;
  return { pathname: window.location.pathname, key: state?.key || "default", type };
}

const listeners = new Set<() => void>();
let current: ReturnType<typeof read> | null = null;

function update(type: NavigationType) {
  current = read(type);
  listeners.forEach((listener) => listener());
}

window.addEventListener("popstate", () => update("POP"));

export function navigate(to: string, replace?: boolean) {
  const state = { key: Math.random().toString(36).slice(2, 10) };
  try {
    window.history[replace ? "replaceState" : "pushState"](state, "", to);
  } catch {
    // Safari throws past its history rate limit: a push falls back to a full load.
    if (replace) return;
    window.location.assign(to);
  }
  update(replace ? "REPLACE" : "PUSH");
}

export function subscribeLocation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getLocation = () => (current ??= read("POP"));
