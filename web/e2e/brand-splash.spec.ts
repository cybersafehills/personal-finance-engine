import { test, expect } from "./fixtures";

/**
 * Dedicated coverage for the branded app-opening screen
 * (components/brand/BrandSplashScreen.tsx). Runs in the "unauthenticated"
 * Playwright project (see playwright.config.ts) - the splash sits above
 * the auth boundary, so /login is a fine, dependency-free place to test
 * it. e2e/fixtures.ts sets `oneledger_splash_off=1` for every spec by
 * default; this file clears it so the real overlay renders.
 */

const SPLASH = ".oneledger-splash";

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("appears on a fresh load, centred, then removes itself from the DOM", async ({
  page,
}) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  // Present in the first paint (server-rendered), covering the viewport.
  const splash = page.locator(SPLASH);
  await expect(splash).toBeVisible();
  const box = await splash.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).toMatchObject({ x: 0, y: 0 });
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);

  const logo = page.locator(`${SPLASH} .oneledger-splash__logo`);
  await expect(logo).toBeVisible();
  const logoBox = (await logo.boundingBox())!;
  const logoCenterX = logoBox.x + logoBox.width / 2;
  const logoCenterY = logoBox.y + logoBox.height / 2;
  // Optically centred (allow generous slack for safe-area padding).
  expect(Math.abs(logoCenterX - viewport.width / 2)).toBeLessThan(8);
  expect(Math.abs(logoCenterY - viewport.height / 2)).toBeLessThan(8);
  expect(logoBox.width).toBeGreaterThanOrEqual(64);
  expect(logoBox.width).toBeLessThanOrEqual(112);

  // Exits on its own and is fully detached (not merely transparent).
  await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 4000 });

  // The route underneath is the real destination.
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("does not replay on internal navigation", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 4000 });

  await page.getByRole("link", { name: "Create one" }).click();
  await expect(page).toHaveURL(/\/signup$/);

  // Give it well past MIN_VISIBLE_MS to (not) reappear.
  await page.waitForTimeout(1200);
  await expect(page.locator(SPLASH)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("does not intercept input once it has gone", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 4000 });

  // A click that would have landed on the overlay now reaches the page.
  await page.getByRole("link", { name: "Create one" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("exits within the hard cap even when the client is slow to initialise", async ({
  page,
}) => {
  // Simulate a slow device: heavy CPU throttle so hydration is delayed.
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 8 });

  const start = Date.now();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator(SPLASH)).toBeVisible();

  // Removed within HARD_CAP_MS (2000) + exit (320) + throttled-JS slack.
  await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 6000 });
  expect(Date.now() - start).toBeLessThan(6000);

  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("respects prefers-reduced-motion: static logo, still clears", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const logo = page.locator(`${SPLASH} .oneledger-splash__logo`);
  await expect(logo).toBeVisible();
  // No entrance animation is applied under reduced motion.
  const animationName = await logo.evaluate(
    (el) => getComputedStyle(el).animationName,
  );
  expect(animationName).toBe("none");

  await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("no horizontal overflow or scrollbar while the splash is up", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator(SPLASH)).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});
