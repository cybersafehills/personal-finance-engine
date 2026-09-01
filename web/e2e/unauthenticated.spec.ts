import { expect, test } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Runs with no session at all (see playwright.config.ts's "unauthenticated"
// project - no dependency on auth.setup.ts) - covers the pre-auth shell,
// which master prompt §24's definition-of-done calls out explicitly
// ("Reports and Profile actions appear correctly... existing auth...
// workflows remain functional").

test("the login page renders with no application shell chrome", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  // The unified shell header/nav must be entirely absent pre-auth - see
  // AppShell's `{userEmail && (...)}` gating and the commit that
  // introduced it ("hide app nav/header on unauthenticated auth pages").
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByLabel("Account menu")).toHaveCount(0);
  await expect(page.getByLabel("Open reports")).toHaveCount(0);
});

test("the signup page renders with no application shell chrome", async ({ page }) => {
  await page.goto("/signup");

  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByLabel("Account menu")).toHaveCount(0);
});

test("the email verification page is public and provides recovery paths", async ({ page }) => {
  await page.goto("/verify-email?status=expired");

  await expect(page.getByRole("heading", { name: "Check your email" }))
    .toBeVisible();
  await expect(page.getByText(/verification link has expired/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to sign up" }))
    .toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
});

test("an incomplete confirmation callback returns to verification recovery", async ({ page }) => {
  await page.goto("/auth/callback");

  await expect(page).toHaveURL(/\/verify-email\?status=missing$/);
  await expect(page.getByText(/verification link is incomplete/i))
    .toBeVisible();
});

test("email verification page has no serious/critical automated accessibility violations", async ({ page }) => {
  await page.goto("/verify-email?status=expired");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});

test("login page has no serious/critical automated accessibility violations", async ({ page }) => {
  await page.goto("/login");

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});

test(
  "login page - visual regression (desktop)",
  { tag: "@visual" },
  async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page).toHaveScreenshot("login-desktop.png", {
      fullPage: true,
    });
  },
);

test(
  "login page - visual regression (mobile viewport)",
  { tag: "@visual" },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page).toHaveScreenshot("login-mobile.png", { fullPage: true });
  },
);

async function hasNoHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1
  );
}

// Master prompt §19's responsive test matrix, automated, for the pre-auth
// shell - see responsive-matrix.spec.ts for the authenticated equivalent
// (kept in a separate file so its tests run in the right project - see
// that file's own comment).
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

for (const bp of BREAKPOINTS) {
  test(`login page has no horizontal overflow at ${bp.name} (${bp.width}x${bp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(
      await hasNoHorizontalOverflow(page),
      `horizontal overflow at ${bp.width}px`,
    ).toBe(true);
  });
}

test("login page renders correctly with prefers-reduced-motion and forced-colors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await hasNoHorizontalOverflow(page)).toBe(true);
});
