import { defineConfig, devices } from "@playwright/test";

// Base URL resolution:
// - default: the local dev stack (./dev.sh → vite on 5173, api on 8000)
// - E2E_BASE_URL: point at a deployed environment instead (the URL is
//   intentionally never committed; pass it via the environment).
const remoteBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: remoteBaseUrl ?? "http://localhost:5173",
    trace: "retain-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Local runs need the full stack (web + api + worker). reuseExistingServer
  // means an already-running ./dev.sh is picked up; otherwise Playwright
  // boots it (first boot can take a while for venv setup).
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: "bash -c 'cd .. && exec ./dev.sh'",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 240_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
