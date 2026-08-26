import { test, expect } from "./fixtures";
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

test("login page has no serious/critical automated accessibility violations", async ({ page }) => {
  await page.goto("/login");

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});

test("login page - visual regression (desktop)", { tag: "@visual" }, async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("login-desktop.png", { fullPage: true });
});

test("login page - visual regression (mobile viewport)", { tag: "@visual" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("login-mobile.png", { fullPage: true });
});
