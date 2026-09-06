import { test, expect } from "./fixtures";

// Visual-regression coverage (master prompt §20.5) for the shell/nav/
// dashboard/settings surfaces this task touched. Runs against the seeded
// e2e user's empty-state dashboard (no transactions/budget yet) - that
// empty state is itself a legitimate, fully deterministic screen worth
// a baseline, and avoids snapshots that would otherwise be full of
// timestamp-dependent transaction rows.
//
// Baselines are per-project (Playwright suffixes snapshot filenames with
// the project name automatically), so chromium-desktop/chrome-android/
// webkit-desktop/mobile-safari each get their own reference image - a
// real, intentional font/rendering difference between browsers is
// expected, not something these snapshots should try to paper over.

test.beforeEach(async ({ page }) => {
  // Reset to a known, un-masked, notice-dismissed state so every visual
  // baseline is deterministic regardless of what earlier specs left
  // behind.
  await page.goto("/settings/privacy");
  const hideBalanceCheckbox = page.getByRole("checkbox", { name: /Hide balance when OneLedger opens/ });
  if (await hideBalanceCheckbox.isChecked()) await hideBalanceCheckbox.click();
  const privacyModeCheckbox = page.getByRole("checkbox", { name: /Full financial privacy mode/ });
  if (await privacyModeCheckbox.isChecked()) await privacyModeCheckbox.click();
});

test("Home dashboard (empty state)", { tag: "@visual" }, async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No transactions yet")).toBeVisible();
  await expect(page).toHaveScreenshot("home-empty.png", { fullPage: true });
});

test("Home dashboard - balance hidden", { tag: "@visual" }, async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Hide current balance").click();
  await expect(page.getByLabel("Show current balance")).toBeVisible();
  await expect(page).toHaveScreenshot("home-balance-hidden.png", { fullPage: true });
});

test("Home dashboard - full privacy mode", { tag: "@visual" }, async ({ page }) => {
  await page.goto("/settings/privacy");
  await page.getByRole("checkbox", { name: /Full financial privacy mode/ }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.goto("/");
  await expect(page.getByLabel("Amount hidden").first()).toBeVisible();
  await expect(page).toHaveScreenshot("home-privacy-mode.png", { fullPage: true });
});

test("Settings index", { tag: "@visual" }, async ({ page }) => {
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Profile & Preferences" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("settings-index.png", { fullPage: true });
});

test("Settings - Appearance and navigation", { tag: "@visual" }, async ({ page }) => {
  await page.goto("/settings/appearance");
  await expect(
    page.getByRole("heading", { name: "Appearance and navigation" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("settings-appearance.png", { fullPage: true });
});

test("Settings - Privacy and security", { tag: "@visual" }, async ({ page }) => {
  await page.goto("/settings/privacy");
  await expect(page).toHaveScreenshot("settings-privacy.png", { fullPage: true });
});
