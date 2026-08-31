import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitFeedback } from "./feedback";

function lastCall() {
  const [url, init] = (fetch as any).mock.calls[0] as [string, RequestInit];
  return { url, init, body: String(init.body) };
}

describe("submitFeedback", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts the three form fields to the form response endpoint", async () => {
    await submitFeedback("Playback stalls on track change");
    const { url, init, body } = lastCall();

    expect(url).toMatch(/^https:\/\/docs\.google\.com\/forms\/d\/e\/.+\/formResponse$/);
    expect(init.method).toBe("POST");
    const params = new URLSearchParams(body);
    expect(params.get("entry.1981349269")).toBe("Playback stalls on track change");
    expect(params.get("entry.921237093")).toMatch(/^Web /);
    expect(params.get("entry.1749929406")).not.toBeNull();
  });

  it("encodes spaces as + rather than %20", async () => {
    await submitFeedback("two words");
    expect(lastCall().body).toContain("entry.1981349269=two+words");
  });

  it("uses no-cors and leaves the content type to URLSearchParams", async () => {
    await submitFeedback("hi");
    const { init } = lastCall();
    expect(init.mode).toBe("no-cors");
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(URLSearchParams);
  });

  it("survives a page unload while the request is in flight", async () => {
    await submitFeedback("hi");
    expect(lastCall().init.keepalive).toBe(true);
  });

  it("reports success when the opaque request resolves", async () => {
    await expect(submitFeedback("hi")).resolves.toBe(true);
  });

  it("reports failure when the request rejects", async () => {
    (fetch as any).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(submitFeedback("hi")).resolves.toBe(false);
  });

  it("aborts and reports failure once the timeout elapses", async () => {
    vi.useFakeTimers();
    (fetch as any).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = submitFeedback("hi");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toBe(false);
  });
});
