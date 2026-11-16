// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type HistoryModule = typeof import("./history");

// A fresh module reads the URL the way a page load does.
async function freshHistory(path: string, state: unknown = null): Promise<HistoryModule> {
  window.history.replaceState(state, "", path);
  vi.resetModules();
  return import("./history");
}

function nextPopState() {
  return new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => resolve(), { once: true });
  });
}

describe("history", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the initial load as POP with the default key", async () => {
    const { getLocation } = await freshHistory("/faq?x=1");
    expect(getLocation()).toEqual({ pathname: "/faq", key: "default", type: "POP" });
    expect(getLocation()).toBe(getLocation());
  });

  it("reads the entry key from history.state on load", async () => {
    const { getLocation } = await freshHistory("/search", { key: "abc12345" });
    expect(getLocation().key).toBe("abc12345");
  });

  it("pushes a new entry with a unique key", async () => {
    const { getLocation, navigate } = await freshHistory("/");
    const length = window.history.length;
    navigate("/search");
    const first = getLocation();
    expect(first.type).toBe("PUSH");
    expect(first.pathname).toBe("/search");
    expect(window.history.length).toBe(length + 1);
    expect(window.history.state).toEqual({ key: first.key });
    navigate("/faq");
    expect(getLocation().key).not.toBe(first.key);
    expect(getLocation().key).toMatch(/^[a-z0-9]{1,8}$/);
  });

  it("replaces the current entry with a new key", async () => {
    const { getLocation, navigate } = await freshHistory("/listen");
    const length = window.history.length;
    navigate("/", true);
    expect(getLocation()).toMatchObject({ pathname: "/", type: "REPLACE" });
    expect(getLocation().key).not.toBe("default");
    expect(window.history.length).toBe(length);
  });

  it("pushes a duplicate entry when navigating to the current URL", async () => {
    const { getLocation, navigate } = await freshHistory("/faq");
    const length = window.history.length;
    navigate("/faq");
    expect(window.history.length).toBe(length + 1);
    expect(getLocation()).toMatchObject({ pathname: "/faq", type: "PUSH" });
  });

  it("writes search and hash to the URL and keeps the pathname encoded", async () => {
    const { getLocation, navigate } = await freshHistory("/");
    navigate("/listen/a%20b?jb=1&d=2,8#top");
    expect(window.location.search).toBe("?jb=1&d=2,8");
    expect(window.location.hash).toBe("#top");
    expect(getLocation().pathname).toBe("/listen/a%20b");
    navigate("/listen/c d", true);
    expect(getLocation().pathname).toBe("/listen/c%20d");
  });

  it("restores the entry key on back and reads wiped state as default", async () => {
    const { getLocation, navigate } = await freshHistory("/");
    navigate("/search");
    const searchKey = getLocation().key;
    navigate("/faq");
    let popped = nextPopState();
    window.history.back();
    await popped;
    expect(getLocation()).toEqual({ pathname: "/search", key: searchKey, type: "POP" });

    window.history.replaceState({}, "", "/search?thresh=40");
    navigate("/faq");
    popped = nextPopState();
    window.history.back();
    await popped;
    expect(getLocation()).toEqual({ pathname: "/search", key: "default", type: "POP" });
  });

  it("notifies subscribers until they unsubscribe", async () => {
    const { navigate, subscribeLocation } = await freshHistory("/");
    const listener = vi.fn();
    const unsubscribe = subscribeLocation(listener);
    navigate("/search");
    navigate("/faq", true);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    navigate("/");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("leaves the location unchanged when replaceState throws", async () => {
    const { getLocation, navigate } = await freshHistory("/faq");
    const before = getLocation();
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("rate limited", "SecurityError");
    });
    expect(() => navigate("/", true)).not.toThrow();
    expect(getLocation()).toBe(before);
    expect(window.location.pathname).toBe("/faq");
  });
});
