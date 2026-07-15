import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const IS_REMOTE = Boolean(process.env.E2E_BASE_URL);

export type TopTrack = {
  id: string;
  source_id?: string;
  source_provider?: string;
  title?: string;
  artist?: string;
  play_count?: number;
};

export type AppConfig = {
  allow_user_upload?: boolean;
  allow_user_url?: boolean;
  allow_favorites_sync?: boolean;
  max_favorites?: number;
};

// The suite runs against a backend that already holds analyzed tracks (the
// local dev DB or a deployed environment). Tests discover fixtures at
// runtime instead of hardcoding job ids.
export async function fetchTopTracks(
  request: APIRequestContext,
  baseURL: string,
): Promise<TopTrack[]> {
  const res = await request.get(`${baseURL}/api/top?limit=25`);
  expect(res.ok(), "GET /api/top should succeed").toBeTruthy();
  const body = (await res.json()) as { items?: TopTrack[] };
  return body.items ?? [];
}

export async function fetchAppConfig(
  request: APIRequestContext,
  baseURL: string,
): Promise<AppConfig> {
  const res = await request.get(`${baseURL}/api/app-config`);
  expect(res.ok(), "GET /api/app-config should succeed").toBeTruthy();
  return (await res.json()) as AppConfig;
}

// A deterministic analyzed fixture: the first top-list track. Skips the
// calling test when the backend has no analyzed tracks at all.
export async function getFixtureTrack(
  request: APIRequestContext,
  baseURL: string,
): Promise<TopTrack> {
  const items = await fetchTopTracks(request, baseURL);
  expect(
    items.length,
    "backend must have at least one analyzed track for e2e fixtures",
  ).toBeGreaterThan(0);
  return items[0];
}

// A second, different track (for playlist tests). Prefers one with a title.
export async function getSecondFixtureTrack(
  request: APIRequestContext,
  baseURL: string,
): Promise<TopTrack> {
  const items = await fetchTopTracks(request, baseURL);
  expect(items.length).toBeGreaterThan(1);
  return items[1];
}

// The nth analyzed track (0-based) for tests needing several distinct ids.
export async function getNthFixtureTrack(
  request: APIRequestContext,
  baseURL: string,
  index: number,
): Promise<TopTrack> {
  const items = await fetchTopTracks(request, baseURL);
  expect(
    items.length,
    `backend must have at least ${index + 1} analyzed tracks`,
  ).toBeGreaterThan(index);
  return items[index];
}

export async function waitForTrackLoaded(page: Page) {
  // viz panel reveals only once audio + analysis are both loaded
  await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
    timeout: 45_000,
  });
  await expect(page.locator("#viz-layer canvas").first()).toBeAttached();
}

export async function loadTrackByDeepLink(
  page: Page,
  jobId: string,
  search = "",
) {
  await page.goto(`/listen/${jobId}${search}`);
  await waitForTrackLoaded(page);
}

export async function loadFirstTopTrack(page: Page): Promise<string> {
  await page.goto("/");
  const link = page.locator("#top-songs .top-list-item a").first();
  // the top list waits on /api/top, which can respond slowly while the
  // backend serves the whole parallel suite — outlast the default 10s
  await expect(link).toBeVisible({ timeout: 30_000 });
  const trackId = await link.getAttribute("data-track-id");
  await link.click();
  await waitForTrackLoaded(page);
  return trackId ?? "";
}

// Range/select inputs need native-setter writes so React's onChange fires.
export async function setRangeValue(
  page: Page,
  selector: string,
  value: string,
) {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("#toast")).toContainText(text);
}
