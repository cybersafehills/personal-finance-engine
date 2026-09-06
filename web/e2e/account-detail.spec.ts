import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// The account as a first-class object (master prompt section 16/24):
// /settings/accounts/[id] with Overview / Transactions / Connections /
// Rules / Access / Settings sections. Shares the one seeded e2e user,
// which has a workspace but no financial account.
async function ensureAnAccountExists(page: Page): Promise<void> {
  await page.goto("/settings/accounts");
  const hasAccount = await page
    .getByRole("button", { name: "Rename" })
    .first()
    .isVisible()
    .catch(() => false);
  if (hasAccount) return;
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("E2E detail account");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("button", { name: "Rename" }).first(),
  ).toBeVisible();
}

test("an account opens a tabbed detail page and the sections switch", async ({
  page,
}) => {
  await ensureAnAccountExists(page);

  await page.goto("/settings/accounts");
  await page.locator('main a[href^="/settings/accounts/"]').first().click();
  await expect(page).toHaveURL(/\/settings\/accounts\/[0-9a-f-]{36}$/);

  const nav = page.getByRole("navigation", { name: "Account sections" });
  for (const label of ["Overview", "Transactions", "Connections", "Rules", "Settings"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }

  // Overview is the default and shows the summary tiles.
  await expect(page.getByText("Connections", { exact: true }).first()).toBeVisible();

  // Switch to Settings and confirm the management controls are there.
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\?tab=settings$/);
  await expect(page.getByRole("button", { name: "Save name" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Archive account" }),
  ).toBeVisible();

  // Transactions section renders its (empty) list without error.
  await nav.getByRole("link", { name: "Transactions" }).click();
  await expect(page).toHaveURL(/\?tab=transactions$/);
});
