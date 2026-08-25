import { describe, expect, it } from "vitest";
import { isAndroid } from "../platform";

describe("isAndroid", () => {
  it("matches Android user agents", () => {
    expect(
      isAndroid(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(true);
  });

  it("rejects non-Android user agents", () => {
    expect(
      isAndroid(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(
      isAndroid(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(
      isAndroid(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});
