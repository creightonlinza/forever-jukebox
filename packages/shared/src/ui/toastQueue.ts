export type ToastQueueItem<T> = T & {
  id: number;
  exiting: boolean;
  // Items sharing a key update in place instead of stacking.
  key?: string;
};

export type ToastQueueOptions = {
  durationMs: number;
  exitMs: number;
  max: number;
};

export type ToastQueue<T extends object> = {
  show: (item: T, key?: string) => void;
  subscribe: (listener: () => void) => () => void;
  getItems: () => ToastQueueItem<T>[];
  clear: () => void;
};

const DEFAULT_OPTIONS: ToastQueueOptions = {
  durationMs: 2000,
  exitMs: 200,
  max: 3,
};

// Callers must pass items of a consistent shape (same keys on every call)
// for the duplicate check to be reliable.
function sameContent<T extends object>(existing: T, item: T): boolean {
  return Object.keys(item).every(
    (field) =>
      existing[field as keyof T] === item[field as keyof T],
  );
}

// Framework-agnostic toast stack shared by the web and pwa apps: up to `max`
// items stack oldest-first, the oldest is dropped for a new one, and removal
// happens in two phases (`exiting`, then removed after `exitMs`) so the UI
// can animate the exit.
export function createToastQueue<T extends object>(
  options: Partial<ToastQueueOptions> = {},
): ToastQueue<T> {
  const { durationMs, exitMs, max } = { ...DEFAULT_OPTIONS, ...options };
  let nextId = 1;
  let items: ToastQueueItem<T>[] = [];
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  // Clearing any previous timer per id keeps drop-oldest safe: the pending
  // hide is cancelled before the removal is scheduled.
  const schedule = (id: number, delay: number, fn: () => void) => {
    const prev = timers.get(id);
    if (prev !== undefined) {
      clearTimeout(prev);
    }
    timers.set(id, setTimeout(fn, delay));
  };

  const remove = (id: number) => {
    timers.delete(id);
    items = items.filter((t) => t.id !== id);
    notify();
  };

  const beginExit = (id: number) => {
    items = items.map((t) => (t.id === id ? { ...t, exiting: true } : t));
    notify();
    schedule(id, exitMs, () => remove(id));
  };

  const show = (item: T, key?: string) => {
    const active = items.filter((t) => !t.exiting);
    const keyed = key ? active.find((t) => t.key === key) : undefined;
    if (keyed) {
      // Keyed item (e.g. a held velocity key emitting a changing readout):
      // update it in place instead of stacking.
      items = items.map((t) => (t.id === keyed.id ? { ...t, ...item } : t));
      notify();
      schedule(keyed.id, durationMs, () => beginExit(keyed.id));
      return;
    }
    const newest = active[active.length - 1];
    if (newest && sameContent(newest, item)) {
      // Identical consecutive item: refresh its timer instead of stacking
      // a duplicate.
      schedule(newest.id, durationMs, () => beginExit(newest.id));
      return;
    }
    if (active.length >= max) {
      beginExit(active[0].id);
    }
    const id = nextId++;
    items = [...items, { ...item, id, key, exiting: false }];
    notify();
    schedule(id, durationMs, () => beginExit(id));
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const clear = () => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    items = [];
    notify();
  };

  return { show, subscribe, getItems: () => items, clear };
}
