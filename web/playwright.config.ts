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
  // Every authenticated test shares the ONE seeded e2e user (test-users.ts)
  // and mutates its server-side ui_preferences row (nav order, balance/
  // privacy toggles, the relocation notice) - running those tests in
  // parallel workers races on that one row (a save from worker A can
  // clobber a concurrent read-modify-write from worker B). Forced fully
  // serial rather than per-file isolation (test.describe.serial), since
  // the race is cross-FILE (nav-reorder.spec.ts and privacy.spec.ts both
  // touch the same row), not just within one file. A distinct e2e user
  // per spec file would allow real parallelism again, but adds a real
  // signup per file for a suite this size that isn't worth it yet - see
  // e2e/README.md.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
    // SCAN_TO_PAY_ENABLED is opt-in (off unless exactly "true", unlike the
    // other Pay flags) - pay-scan.spec.ts needs the server-side gate open
    // to render the "Scan to pay" launcher entry + its server actions.
    // Inert for every other spec (nothing else routes through that gate).
    env: { PORT: String(PORT), SCAN_TO_PAY_ENABLED: "true" },
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
      testMatch: /(unauthenticated|brand-splash)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },

    // Chrome/Chromium desktop - the project's primary supported desktop
    // browser (master prompt §19). storageState here is what actually
    // carries the "setup" project's real login into every test in this
    // project - `dependencies` alone only guarantees run ORDER, it does
    // not apply the saved session on its own.
    {
      name: "chromium-desktop",
      testIgnore: /(unauthenticated|brand-splash)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        storageState: AUTH_STORAGE_STATE_PATH,
        // Headless Chromium ships no real camera; pay-scan.spec.ts needs
        // getUserMedia to resolve so the scanner reaches its "camera on"
        // shell state. These flags feed a synthetic stream and auto-accept
        // the permission prompt. Inert for every other spec - nothing else
        // calls getUserMedia. (Headless Chromium also ships no
        // BarcodeDetector, so pay-scan.spec.ts asserts the shell only, not
        // a live decode - that stays manual device QA.)
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
      dependencies: ["setup"],
    },

    // Chrome on Android (Pixel device profile - real touch/UA emulation,
    // not just a narrow viewport). pay-scan.spec.ts is chromium-desktop
    // only (see its header) - the mobile launcher layout and the fake-
    // camera flags are exercised there; real mobile scanning is manual QA.
    {
      name: "chrome-android",
      testIgnore: /(unauthenticated|brand-splash|pay-scan)\.spec\.ts/,
      use: { ...devices["Pixel 7"], storageState: AUTH_STORAGE_STATE_PATH },
      dependencies: ["setup"],
    },

    // Safari on macOS. Excludes pay-scan.spec.ts: WebKit ignores the
    // Chromium fake-media flags, so getUserMedia can't resolve headlessly.
    {
      name: "webkit-desktop",
      testIgnore: /(unauthenticated|brand-splash|pay-scan)\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 900 },
        storageState: AUTH_STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
    },

    // Mobile Safari (iPhone) - safe-area insets, dynamic toolbar quirks.
    // Excludes pay-scan.spec.ts for the same reason as webkit-desktop.
    {
      name: "mobile-safari",
      testIgnore: /(unauthenticated|brand-splash|pay-scan)\.spec\.ts/,
      use: { ...devices["iPhone 14"], storageState: AUTH_STORAGE_STATE_PATH },
      dependencies: ["setup"],
    },
  ],
});
