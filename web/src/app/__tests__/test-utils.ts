export function setWindowUrl(url: string) {
  const nextUrl = new URL(url);
  const existing =
    (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {};
  (globalThis as unknown as { window: Window }).window = {
    ...existing,
    location: nextUrl,
    history: {
      replaceState: (_: unknown, __: unknown, next: string) => {
        (globalThis as unknown as { window: { location: URL } }).window.location =
          new URL(next);
      },
      pushState: (_: unknown, __: unknown, next: string) => {
        (globalThis as unknown as { window: { location: URL } }).window.location =
          new URL(next);
      },
    },
  } as unknown as Window;
}

// Puts jsdom at `path` the way a fresh page load does: a POP with no entry key.
export function loadUrl(path: string) {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
