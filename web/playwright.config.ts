import { defineConfig, devices } from "@playwright/test";
import { AUTH_STORAGE_STATE_PATH } from "./e2e/test-users";

// e2e/visual-regression suite for the application-shell/navigation/
// dashboard-privacy modernization (see AGENTS/CLAUDE.md task history).
//
// This suite talks to a REAL, disposable local Supabase stack
// (`supabase start`, matching supabase/config.toml) - never the linked
// production project, exactly like supabase/migrations/tests/
// run_migration_tests.sh's own "every database created here is
// disposable" rule. e2e/global-setup.ts creates a throwaway test user
// against whatever SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY point at; if
// those look production-shaped, setup refuses to run (see that file).
//
// Port 3417 matches this project's own documented local dev port (see
// supabase/config.toml's additional_redirect_urls comment and
// .env.local's SITE_URL) - not Playwright's or Next's default, so a
// developer's already-running `next dev` on the usual port is never
// confused with this suite's own server.
const PORT = 3417;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  timeout: 30_000,

  expect: {
    // Visual-regression tolerance: a few pixels of anti-aliasing/font
    // hinting difference across machines is expected; a real layout
    // regression is not. See master prompt §20.5.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: "npm run build && npm run start -- -p 3417",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT) },
  },

  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    // Runs with no auth dependency at all - the unauthenticated shell
    // (login/signup) never needs the local-Supabase test user, so this
    // project can run standalone even when nothing but a dev server is
    // available.
    {
      name: "unauthenticated",
      testMatch: /unauthenticated\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },

    // Chrome/Chromium desktop - the project's primary supported desktop
    // browser (master prompt §19). storageState here is what actually
    // carries the "setup" project's real login into every test in this
    // project - `dependencies` alone only guarantees run ORDER, it does
    // not apply the saved session on its own.
    {
      name: "chromium-desktop",
      testIgnore: /unauthenticated\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        storageState: AUTH_STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
    },

    // Chrome on Android (Pixel device profile - real touch/UA emulation,
    // not just a narrow viewport).
    {
      name: "chrome-android",
      testIgnore: /unauthenticated\.spec\.ts/,
      use: { ...devices["Pixel 7"], storageState: AUTH_STORAGE_STATE_PATH },
      dependencies: ["setup"],
    },

    // Safari on macOS.
    {
      name: "webkit-desktop",
      testIgnore: /unauthenticated\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 900 },
        storageState: AUTH_STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
    },

    // Mobile Safari (iPhone) - safe-area insets, dynamic toolbar quirks.
    {
      name: "mobile-safari",
      testIgnore: /unauthenticated\.spec\.ts/,
      use: { ...devices["iPhone 14"], storageState: AUTH_STORAGE_STATE_PATH },
      dependencies: ["setup"],
    },
  ],
});
