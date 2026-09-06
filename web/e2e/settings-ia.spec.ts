import { expect, test } from "./fixtures";

// The Settings information architecture (master prompt sections 22-30 /
// section 110): seven named groups, each a clear destination, no
// duplicated Security entry, no standalone "Shared accounts".
test("Settings home shows the seven named groups", async ({ page }) => {
  await page.goto("/settings");

  for (const group of [
    "Profile & Preferences",
    "Accounts & Connections",
    "Spaces & Members",
    "Reports & Notifications",
    "Security & Privacy",
    "Billing & Plan",
  ]) {
    await expect(page.getByRole("heading", { name: group })).toBeVisible();
  }

  // The old flat list's confusing entries are gone.
  await expect(
    page.getByRole("heading", { name: "Shared accounts" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Privacy and security" }),
  ).toHaveCount(0);
});

test("Profile & region is editable from Settings", async ({ page }) => {
  await page.goto("/settings");
  await page.locator('main a[href="/settings/profile"]').click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(
    page.getByRole("heading", { name: "Profile & region" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /save changes/i })).toBeVisible();
});

test("Billing & Plan has a home and is honest about the free plan", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.locator('main a[href="/settings/billing"]').click();
  await expect(page).toHaveURL(/\/settings\/billing$/);
  await expect(
    page.getByText("This Space is on the Free plan"),
  ).toBeVisible();
});

test("Security and Privacy are one group with two distinct pages", async ({
  page,
}) => {
  await page.goto("/settings");
  const group = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Security & Privacy" }) });
  await expect(group.locator('a[href="/settings/security"]')).toBeVisible();
  await expect(group.locator('a[href="/settings/privacy"]')).toBeVisible();
});
