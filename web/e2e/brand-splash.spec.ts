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
  await client.send("Emulation.setCPUThrottlingRate", { rate: 6 });

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator(SPLASH)).toBeVisible();

  // The exit timers are anchored to hydration, so worst case is
  // (slow hydration) + HARD_CAP_MS (2000) + exit (320). It must still
  // clear on its own well within the spec's intent - never trapped.
  await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 12_000 });

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

test("critical CSS is inlined in <head> and sizes the overlay on the first frame", async ({
  page,
}) => {
  // Regression guard: if the splash's positioning/sizing rules ship only
  // in the app's async render-blocking stylesheet, a slow load paints a
  // blank frame and a collapsed 0x0 overlay before it arrives. They must
  // be in an inline <head> <style>.
  const res = await page.goto("/login", { waitUntil: "commit" });
  const html = (await res!.text()).split("</head>")[0];
  expect(html).toContain("<style");
  expect(html).toMatch(/\.oneledger-splash\s*\{[^}]*position:\s*fixed/);
  expect(html).toContain("@keyframes oneledger-splash-logo-in");
  // The mark is inlined too - no separate request that could leave the
  // white field empty for a beat on a slow link.
  expect(html).toContain("data:image/png;base64");

  // And it actually takes effect: the overlay fills the viewport, never
  // shrink-wraps its logo.
  const splash = page.locator(SPLASH);
  await expect(splash).toBeVisible();
  const box = (await splash.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(vp.height - 1);
});

test("iOS PWA launch images are wired up and publicly served", async ({
  page,
  request,
}) => {
  // Without apple-touch-startup-image links an installed iOS PWA shows a
  // black launch screen for the whole cold start.
  const res = await page.goto("/login", { waitUntil: "commit" });
  const head = (await res!.text()).split("</head>")[0];
  const links = head.match(/rel="apple-touch-startup-image"/g) ?? [];
  expect(links.length).toBeGreaterThanOrEqual(10);

  // iOS Safari only honours those links when the LEGACY capable tag is
  // present; Next 16 emits only the modern `mobile-web-app-capable`, so
  // app/layout.tsx adds this one explicitly. Its absence = black launch.
  expect(head).toMatch(
    /<meta name="apple-mobile-web-app-capable" content="yes"\/?>/,
  );

  // The images live under /brand/** and MUST NOT be gated by proxy.ts -
  // a 307 to /login here = black launch screen for logged-out visitors.
  const href = head.match(
    /href="(\/brand\/oneledger\/startup\/[^"]+\.png)"/,
  )?.[1];
  expect(href).toBeTruthy();
  const img = await request.get(href!, { maxRedirects: 0 });
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toContain("image/png");
});

test("no horizontal overflow or scrollbar while the splash is up", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator(SPLASH)).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});
