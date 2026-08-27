import { test, expect } from "./fixtures";

// Master prompt §19's responsive test matrix, automated, for the
// authenticated shell (header/bottom-nav swap, Reports icon, profile
// menu) - the pre-auth equivalent (login page) lives in
// unauthenticated.spec.ts instead, so it runs in the `unauthenticated`
// project (no auth dependency) rather than here, where every test would
// otherwise run under an authenticated session via this file's
// dependency on `setup`.
//
// At every listed width, the page must never horizontally scroll (the
// #1 sign of a responsive-layout regression) and the shell's key
// controls must stay visible/reachable.
const BREAKPOINTS = [
  { name: "small mobile", width: 320, height: 720 },
  { name: "mobile (iPhone-ish)", width: 375, height: 812 },
  { name: "mobile (390)", width: 390, height: 844 },
  { name: "large mobile", width: 428, height: 926 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide desktop", width: 1920, height: 1080 },
];

async function hasNoHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

for (const bp of BREAKPOINTS) {
  test(`Home dashboard shell has no horizontal overflow at ${bp.name} (${bp.width}x${bp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.goto("/");

    expect(await hasNoHorizontalOverflow(page), `horizontal overflow at ${bp.width}px`).toBe(true);

    // Exactly one of the two nav renderings is present in the a11y tree
    // at any given width (the other is display:none, not just visually
    // hidden - see AppShell's own comment) - whichever it is, Home must
    // still be reachable and marked active.
    const nav = page.getByRole("navigation", { name: "Primary" }).first();
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await expect(page.getByLabel("Open reports")).toBeVisible();
    await expect(page.getByLabel("Account menu")).toBeVisible();
  });
}

test("Home dashboard renders correctly with prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByLabel("Account menu")).toBeVisible();
  expect(await hasNoHorizontalOverflow(page)).toBe(true);
});

test("Home dashboard renders correctly under forced-colors (Windows High Contrast) emulation", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  // Not a pixel-perfect contrast audit (that needs a real forced-colors
  // OS/browser environment) - this confirms the page still renders and
  // every control this task added keeps a real accessible name under
  // forced-colors, i.e. nothing depends on icon/color styling alone.
  await expect(page.getByLabel("Open reports")).toBeVisible();
  await expect(page.getByLabel("Account menu")).toBeVisible();
  await expect(page.getByLabel("Hide current balance")).toBeVisible();
  expect(await hasNoHorizontalOverflow(page)).toBe(true);
});
