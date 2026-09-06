import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Automated accessibility coverage (master prompt §13/§20.2) for the
// pages this task actually changed. Scoped to serious/critical impact
// only, and only these pages - this suite doesn't assert the entire
// (much larger) app is violation-free, just that the shell/nav/privacy
// work this task shipped didn't introduce one.
const PAGES_TO_SCAN = [
  { path: "/", name: "Home dashboard" },
  { path: "/settings", name: "Settings index" },
  { path: "/settings/appearance", name: "Appearance and navigation" },
  { path: "/settings/privacy", name: "Privacy" },
  { path: "/settings/profile", name: "Profile & region" },
  { path: "/settings/billing", name: "Billing & Plan" },
];

for (const { path, name } of PAGES_TO_SCAN) {
  test(`${name} (${path}) has no serious/critical automated accessibility violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
  });
}

test("every primary nav destination and the Reports button have accessible names", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  for (const name of ["Home", "Transactions", "Inbox", "Plan"]) {
    await expect(nav.getByRole("link", { name })).toHaveAccessibleName(name);
  }
  await expect(page.getByLabel("Open reports")).toHaveAccessibleName("Open reports");
});

test("the phone More sheet has no serious/critical accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .locator('nav[aria-label="Primary"].fixed')
    .getByRole("button", { name: "More" })
    .click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});

test("200% zoom does not clip or overlap the header or primary nav", async ({ page }) => {
  await page.goto("/");
  // Emulate 200% browser zoom by halving the viewport (master prompt §13/§19).
  await page.setViewportSize({ width: 640, height: 450 });

  await expect(page.getByLabel("Open reports")).toBeVisible();
  await expect(page.getByLabel("Account menu")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
});

test("interactive controls meet the 44x44 CSS-pixel minimum touch target", async ({ page }) => {
  await page.goto("/");

  for (const label of ["Open reports", "Account menu", "Hide current balance"]) {
    const box = await page.getByLabel(label).boundingBox();
    expect(box, `${label} should be present and visible`).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
