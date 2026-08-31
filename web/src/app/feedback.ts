// In-app feedback posts straight to a Google Form: no backend, no auth, no
// accounts. The same form receives the Android app's reports, so the version
// field is prefixed to keep the two platforms apart in the response sheet.
const FORM_ID = "1FAIpQLSfFuWOCsqy6_U2eSJu316aFR_O9_-d80yDGzjfmFpfCYvVb6Q";
const ENDPOINT = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`;

const ENTRY = {
  feedback: "entry.1981349269",
  appVersion: "entry.921237093",
  device: "entry.1749929406",
  host: "entry.2053321578",
} as const;

const TIMEOUT_MS = 30_000;

function deviceSummary(): string {
  const parts: string[] = [];
  if (typeof navigator !== "undefined") {
    parts.push(navigator.userAgent);
  }
  if (typeof screen !== "undefined") {
    parts.push(`${screen.width}×${screen.height}`);
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    parts.push(navigator.language);
  }
  return parts.join(" | ");
}

// The app is self-hosted by others too, so reports arrive from deployments
// whose code may have drifted; the origin identifies which one sent this.
function hostSummary(): string {
  return typeof location === "undefined" ? "" : location.origin;
}

// Google Forms sends no CORS headers, so the response is opaque: a resolved
// fetch means the request reached Google, not that the row was recorded.
// Genuine network failure (offline, DNS, timeout) still rejects.
export async function submitFeedback(text: string): Promise<boolean> {
  const body = new URLSearchParams({
    [ENTRY.feedback]: text,
    [ENTRY.appVersion]: `Web ${__APP_VERSION__}`,
    [ENTRY.device]: deviceSummary(),
    [ENTRY.host]: hostSummary(),
  });

  // AbortSignal.timeout is unavailable on the legacy targets the bundle
  // supports; the AbortController polyfill covers this path.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Content-Type is left to URLSearchParams: a hand-set header is not
    // CORS-safelisted and would be rejected under no-cors.
    await fetch(ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      body,
      // The dialog closes on Send, so the tab may be closed while the request
      // is still in flight; the body is far below the keepalive size limit.
      keepalive: true,
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
